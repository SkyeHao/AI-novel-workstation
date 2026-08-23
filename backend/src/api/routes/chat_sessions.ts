/**
 * 多 Agent 群聊（ChatSession）API 路由。
 * 复用 agent.ts 的 SSE 模式（hijack + 心跳 + send）；事件按 chat_session 的事件表推送。
 */
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import {
  ChatSession,
  ChatSessionError,
  type ChatSessionEvent,
  type ChatMember,
} from "../../workflow/chat_session.js";
import { getAgentRole } from "../../assets/agent_roles.js";
import { getClientForTask } from "../state.js";
import { InteractionLogger } from "../../llm/interaction_logger.js";
import { saveInteraction } from "../../storage/interaction_store.js";

/** 内存中的群聊会话注册表（持久化与恢复见工单 07） */
const _sessions = new Map<string, ChatSession>();

function roleToMember(roleId: string): ChatMember {
  const role = getAgentRole(roleId);
  if (!role) throw new ChatSessionError(`角色不存在: ${roleId}`);
  return {
    id: role.id,
    kind: "agent",
    name: role.name,
    description: role.description,
    category: role.category,
    systemPrompt: role.systemPrompt,
    sharedContextKeys: role.contextConfig?.sharedContextKeys,
  };
}

export async function chatSessionsRoutes(app: FastifyInstance): Promise<void> {
  // ---- 开始群聊 ----
  app.post<{
    Body: {
      projectId?: string;
      topic?: string;
      memberIds?: string[];
      staticContext?: Record<string, string>;
      maxRounds?: number;
    };
  }>("/start", async (req, reply) => {
    const body = req.body ?? {};
    const projectId = String(body.projectId ?? "");
    const topic = String(body.topic ?? "").trim();
    const memberIds = Array.isArray(body.memberIds) ? body.memberIds : [];
    if (!projectId || !topic) return reply.code(400).send({ error: "projectId 与 topic 不能为空" });
    if (memberIds.length === 0) return reply.code(400).send({ error: "请至少选择一个参与角色" });

    let members: ChatMember[];
    try {
      members = memberIds.map(roleToMember);
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }

    const sessionId = randomUUID();
    let client;
    try {
      const logger = new InteractionLogger((it) => {
        try {
          saveInteraction("chat", it, {
            task_type: "text",
            session_id: `chat:${sessionId}`,
            project_id: projectId,
          });
        } catch (err) {
          console.warn(`保存群聊交互记录失败: ${err instanceof Error ? err.message : String(err)}`);
        }
      });
      client = getClientForTask("text", logger);
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }

    const session = new ChatSession({
      id: sessionId,
      projectId,
      topic,
      members,
      staticContext: body.staticContext ?? {},
      llm: client,
      maxRounds: body.maxRounds ?? 1,
    });
    _sessions.set(sessionId, session);
    try {
      session.start().catch(() => {});
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) });
    }

    return { sessionId, status: session.getStatus(), members, topic };
  });

  // ---- 会话详情（含完整记录；刷新 / 恢复用） ----
  app.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const session = _sessions.get(req.params.id);
    if (!session) return reply.code(404).send({ error: "讨论会话不存在" });
    return session.getSnapshot();
  });

  // ---- 作者发言 ----
  app.post<{ Params: { id: string }; Body: { content?: string } }>("/:id/message", async (req, reply) => {
    const session = _sessions.get(req.params.id);
    if (!session) return reply.code(404).send({ error: "讨论会话不存在" });
    try {
      const message = await session.sendUserMessage(String(req.body?.content ?? ""));
      return { success: true, message };
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ---- 手动终止 ----
  app.post<{ Params: { id: string } }>("/:id/stop", async (req, reply) => {
    const session = _sessions.get(req.params.id);
    if (!session) return reply.code(404).send({ error: "讨论会话不存在" });
    try {
      session.stop();
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
    return { success: true, status: session.getStatus() };
  });

  // ---- SSE 实时事件流 ----
  app.get<{ Params: { id: string } }>("/:id/stream", async (req, reply) => {
    const session = _sessions.get(req.params.id);
    if (!session) return reply.code(404).send({ error: "讨论会话不存在" });

    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    reply.raw.on("error", () => {});

    const send = (event: string, data: unknown): void => {
      try {
        reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      } catch {
        /* 连接已关闭，忽略 */
      }
    };
    const heartbeat = setInterval(() => {
      try {
        reply.raw.write(": ping\n\n");
      } catch {
        /* 忽略 */
      }
    }, 15000);

    let closed = false;
    let unsubscribe: () => void = () => {};
    const close = (): void => {
      if (closed) return;
      closed = true;
      unsubscribe();
      clearInterval(heartbeat);
      try {
        reply.raw.end();
      } catch {
        /* 忽略 */
      }
    };
    reply.raw.on("close", close);

    const emit = (event: ChatSessionEvent): void => {
      if (closed) return;
      send(event.type, event.data);
      // 会话终态事件到达后关闭流，前端据此收尾
      if (event.type === "done" || event.type === "error") close();
    };

    // 断线重连 / 刷新时回放历史，前端按消息 id 去重
    for (const m of session.getMessages()) {
      send("chat_message", m);
    }
    send("system", {
      message: `已连接会话，当前状态：${session.getStatus()}`,
      status: session.getStatus(),
    });
    // 已结束会话补发终态事件，让前端一次拉齐
    if (session.getStatus() === "completed") {
      send("done", { status: "completed" });
      close();
      return;
    }
    if (session.getStatus() === "terminated") {
      send("done", { status: "terminated" });
      close();
      return;
    }

    unsubscribe = session.subscribe(emit);
  });
}
