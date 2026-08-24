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
import { getClientForTask, getProjectStore } from "../state.js";
import { InteractionLogger } from "../../llm/interaction_logger.js";
import { saveInteraction } from "../../storage/interaction_store.js";
import { TransformersEmbeddingService, type EmbeddingService } from "../../vector/embedding.js";
import { QdrantVectorStore, type VectorStore } from "../../vector/store.js";
import { FileChatStore } from "../../storage/chat_store.js";
import type { ChatSessionSnapshot } from "../../workflow/chat_session.js";
import type { LLMClient } from "../../llm/client.js";
import { applyChatSessionPlan, CHAT_APPLY_TARGETS, type ChatApplyTarget } from "../../workflow/chat_apply.js";

/** 内存中的群聊会话注册表（持久化与恢复见工单 07） */
const _sessions = new Map<string, ChatSession>();

/**
 * 向量服务懒加载单例（工单 06）：Qdrant / Embedding 模型不可用时由 ChatSession
 * 自动降级为关键词 + 随机，不阻塞讨论主流程；服务层保留运行时切换接口。
 */
let _vectorBundle: { embedding: EmbeddingService; store: VectorStore } | null = null;

function getVectorBundle(): { embedding: EmbeddingService; store: VectorStore } | null {
  if (!_vectorBundle) {
    try {
      _vectorBundle = {
        embedding: new TransformersEmbeddingService(),
        store: new QdrantVectorStore(),
      };
    } catch {
      _vectorBundle = null;
    }
  }
  return _vectorBundle;
}

/** 讨论记录文件存储（工单 07）：懒加载单例，路径由当前项目目录解析。 */
let _chatStore: FileChatStore | null = null;
function getChatStore(): FileChatStore {
  if (!_chatStore) _chatStore = new FileChatStore(getProjectStore());
  return _chatStore;
}

/** 磁盘恢复：内存未命中时按会话 id 跨项目查找快照（刷新 / 重启后可续看）。 */
function loadFromDisk(sessionId: string): ChatSessionSnapshot | null {
  const store = getChatStore();
  for (const project of getProjectStore().list()) {
    const snapshot = store.load(project.id, sessionId);
    if (snapshot) return snapshot;
  }
  return null;
}

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
      // 工单 07：讨论记录 / 共识 / 最终方案按书落盘
      chatStore: getChatStore(),
      // 工单 06：注入本地 Embedding + Qdrant；不可用时降级，不阻断
      vector: getVectorBundle() ? { embedding: _vectorBundle!.embedding, store: _vectorBundle!.store } : undefined,
    });
    _sessions.set(sessionId, session);
    // 会话创建后停在 idle：由作者第一条消息激活，标题仅作会话名
    return { sessionId, status: session.getStatus(), members, topic };
  });

  // ---- 会话列表（按书；含共识 / 最终方案，恢复入口） ----
  app.get<{ Querystring: { projectId?: string } }>("/", async (req, reply) => {
    const projectId = String(req.query?.projectId ?? "");
    if (!projectId) return reply.code(400).send({ error: "projectId 不能为空" });
    return { sessions: getChatStore().list(projectId) };
  });

  // ---- 会话详情（含完整记录；刷新 / 恢复用） ----
  app.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const session = _sessions.get(req.params.id);
    if (session) return session.getSnapshot();
    // 工单 07：内存未命中回退磁盘（重启后仍可查看历史）
    const snapshot = loadFromDisk(req.params.id);
    if (!snapshot) return reply.code(404).send({ error: "讨论会话不存在" });
    return snapshot;
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

  // ---- 删除会话（内存 + 磁盘彻底移除） ----
  app.delete<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const sessionId = req.params.id;
    const session = _sessions.get(sessionId);
    if (session) {
      // 中止调度 + 停止落盘，避免异步收尾把已删除会话重新写回磁盘
      session.dispose();
      _sessions.delete(sessionId);
    }
    // 磁盘删除：跨项目查找（与 loadFromDisk 一致）
    let deleted = false;
    for (const project of getProjectStore().list()) {
      if (getChatStore().delete(project.id, sessionId)) {
        deleted = true;
        break;
      }
    }
    if (!deleted && !session) {
      return reply.code(404).send({ error: "讨论会话不存在" });
    }
    return { success: true };
  });

  // ---- 应用最终方案（工单 08）：保存文档 / 应用大纲 / 应用人设 ----
  app.post<{ Params: { id: string }; Body: { target?: string } }>("/:id/apply", async (req, reply) => {
    const session = _sessions.get(req.params.id);
    const snapshot = session ? session.getSnapshot() : loadFromDisk(req.params.id);
    if (!snapshot) return reply.code(404).send({ error: "讨论会话不存在" });
    if (snapshot.status !== "completed" || !snapshot.summary || !snapshot.summary.trim()) {
      return reply.code(400).send({ error: "会话尚未完成，无最终方案可应用" });
    }
    const target = String(req.body?.target ?? "") as ChatApplyTarget;
    if (!CHAT_APPLY_TARGETS.includes(target)) {
      return reply.code(400).send({ error: "未知应用目标: " + target + "（可选：document / outline / characters）" });
    }

    let client: LLMClient;
    try {
      const logger = new InteractionLogger((it) => {
        try {
          saveInteraction("chat_apply", it, {
            task_type: "text",
            session_id: "chat:" + snapshot.id,
            project_id: snapshot.projectId,
          });
        } catch (err) {
          console.warn("保存群聊应用交互记录失败: " + (err instanceof Error ? err.message : String(err)));
        }
      });
      client = getClientForTask("text", logger);
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }

    try {
      const result = await applyChatSessionPlan({
        projectId: snapshot.projectId,
        sessionId: snapshot.id,
        topic: snapshot.topic,
        summary: snapshot.summary,
        target,
        llm: client,
        projectStore: getProjectStore(),
      });
      return result;
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ---- SSE 实时事件流 ----
  app.get<{ Params: { id: string } }>("/:id/stream", async (req, reply) => {
    const session = _sessions.get(req.params.id);
    // 工单 07：内存未命中时从磁盘恢复终态会话（历史回放后补发 done）
    const snapshot = session ? undefined : loadFromDisk(req.params.id);
    if (!session && !snapshot) return reply.code(404).send({ error: "讨论会话不存在" });

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
    const messages = session ? session.getMessages() : (snapshot?.messages ?? []);
    const status = session ? session.getStatus() : (snapshot?.status ?? "terminated");
    for (const m of messages) {
      send("chat_message", m);
    }
    send("system", {
      message: `已连接会话，当前状态：${status}`,
      status,
    });
    // 已结束会话补发终态事件，让前端一次拉齐
    if (status === "completed") {
      send("done", { status: "completed", summary: snapshot?.summary });
      close();
      return;
    }
    if (status === "terminated") {
      send("done", { status: "terminated" });
      close();
      return;
    }

    if (!session) {
      send("error", { error: "会话未在内存中运行，无法继续订阅" });
      close();
      return;
    }
    unsubscribe = session.subscribe(emit);
  });
}
