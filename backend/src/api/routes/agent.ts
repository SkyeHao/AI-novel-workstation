/** 统一 Agent 窗口路由（T3/T4/T7）。
 * 单持续对话线 + 状态重组；SSE 推送 step/chunk/thinking/ask；ask 由 /answer 异步续答。
 * 多会话：每本书可有多个会话，持久化于项目目录 memory/sessions/ 下。 */
import type { FastifyInstance } from "fastify";
import { getProjectStore, getClientForState } from "../state.js";
import { MemoryStore } from "../../storage/memory_store.js";
import { SettingsStore } from "../../storage/settings_store.js";
import { AgentSessionStore } from "../../storage/agent_session_store.js";
import { ProjectAgent } from "../../workflow/ideation.js";
import { InteractionLogger } from "../../llm/interaction_logger.js";
import { AskResolver, type AskQuestion } from "../../agent/react.js";
import { DEFAULT_STATES, getStateNode, legacyStatusToNew } from "../../storage/states.js";

/** ask 等待器：按 项目+会话 隔离 */
const _askResolvers = new Map<string, AskResolver>();
/** 会话级进行中的 turn（防并发覆盖导致 ask/回答错位） */
const _activeTurns = new Set<string>();

function askKey(projectId: string, sessionId: string): string {
  return `${projectId}::${sessionId || "default"}`;
}

export async function agentRoutes(app: FastifyInstance): Promise<void> {
  const store = () => getProjectStore();
  const sessionStore = () => new AgentSessionStore(store());

  function buildAgent(projectId: string, logger: InteractionLogger, toolCallMode?: string): ProjectAgent {
    const project = store().get(projectId);
    const stateKey = legacyStatusToNew(project.status);
    const client = getClientForState(stateKey, logger);
    return new ProjectAgent({
      client,
      projectStore: store(),
      memoryStore: new MemoryStore(store()),
      settingsStore: new SettingsStore(store()),
      sessionStore: sessionStore(),
      toolCallMode: (toolCallMode as "native" | "jsonfc" | "dsml" | "auto" | undefined) ?? "jsonfc",
    });
  }

  // ---- 上下文快照（Agent 页初始化） ----
  app.get<{ Querystring: { project_id?: string } }>("/context", async (req, reply) => {
    const projectId = String(req.query.project_id ?? "");
    if (!projectId) return reply.code(400).send({ error: "project_id 不能为空" });
    try {
      const projStore = store();
      const project = projStore.get(projectId);
      const enabled = project.states_enabled && project.states_enabled.length > 0 ? project.states_enabled : DEFAULT_STATES.map((s) => s.key);
      const states = DEFAULT_STATES.map((s) => ({ ...s, enabled_in_project: enabled.includes(s.key) }));
      const current = getStateNode(project.status);
      const memory = new MemoryStore(projStore);
      const settings = new SettingsStore(projStore);
      const prereq = {
        worldview: settings.exists(projectId, "worldview"),
        characters: settings.exists(projectId, "characters"),
        outline: settings.exists(projectId, "outline"),
        style: settings.exists(projectId, "style"),
      };
      return {
        project_id: projectId,
        project_name: project.name,
        current_state: current.key,
        current_label: current.label,
        states,
        work_unit: project.work_unit,
        memory_stats: memory.stats(projectId),
        prereq,
        core_elements: (await import("../../workflow/core_elements.js")).loadCoreElements(projStore.project_root(projectId)),
      };
    } catch (err) {
      return reply.code(404).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ---- 会话列表 ----
  app.get<{ Querystring: { project_id?: string } }>("/sessions", async (req, reply) => {
    const projectId = String(req.query.project_id ?? "");
    if (!projectId) return reply.code(400).send({ error: "project_id 不能为空" });
    try {
      store().get(projectId); // 校验项目存在
      return { project_id: projectId, sessions: sessionStore().list(projectId) };
    } catch (err) {
      return reply.code(404).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ---- 新建会话 ----
  app.post<{ Body: { project_id?: string; title?: string; state?: string } }>("/sessions", async (req, reply) => {
    const projectId = String(req.body?.project_id ?? "");
    if (!projectId) return reply.code(400).send({ error: "project_id 不能为空" });
    try {
      const project = store().get(projectId);
      const state = String(req.body?.state ?? legacyStatusToNew(project.status));
      const meta = sessionStore().create(projectId, { title: req.body?.title, state });
      return meta;
    } catch (err) {
      return reply.code(404).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ---- 重命名会话 ----
  app.patch<{ Params: { id: string }; Body: { project_id?: string; title?: string } }>("/sessions/:id", async (req, reply) => {
    const projectId = String(req.body?.project_id ?? "");
    const sessionId = req.params.id;
    const title = String(req.body?.title ?? "");
    if (!projectId || !title) return reply.code(400).send({ error: "project_id 与 title 不能为空" });
    const meta = sessionStore().rename(projectId, sessionId, title);
    if (!meta) return reply.code(404).send({ error: "会话不存在" });
    return meta;
  });

  // ---- 删除会话 ----
  app.delete<{ Params: { id: string }; Querystring: { project_id?: string } }>("/sessions/:id", async (req, reply) => {
    const projectId = String(req.query.project_id ?? "");
    const sessionId = req.params.id;
    if (!projectId) return reply.code(400).send({ error: "project_id 不能为空" });
    const ok = sessionStore().remove(projectId, sessionId);
    if (!ok) return reply.code(404).send({ error: "会话不存在" });
    _askResolvers.delete(askKey(projectId, sessionId));
    return { success: true };
  });

  // ---- 会话消息（恢复对话） ----
  app.get<{ Params: { id: string }; Querystring: { project_id?: string } }>("/sessions/:id/messages", async (req, reply) => {
    const projectId = String(req.query.project_id ?? "");
    const sessionId = req.params.id;
    if (!projectId) return reply.code(400).send({ error: "project_id 不能为空" });
    const meta = sessionStore().get(projectId, sessionId);
    if (!meta) return reply.code(404).send({ error: "会话不存在" });
    return { session_id: sessionId, messages: sessionStore().loadMessages(projectId, sessionId) };
  });

  // ---- 查询等待中的 ask（断连恢复） ----
  app.get<{ Querystring: { project_id?: string; session_id?: string } }>("/pending-ask", async (req, reply) => {
    const projectId = String(req.query.project_id ?? "");
    const sessionId = String(req.query.session_id ?? "default");
    if (!projectId) return reply.code(400).send({ error: "project_id 不能为空" });
    const resolver = _askResolvers.get(askKey(projectId, sessionId));
    if (!resolver || !resolver.hasPending) return { has_pending: false, question: null };
    return { has_pending: true, question: resolver.peek() };
  });

  // ---- 单轮对话（非流式） ----
  app.post<{ Body: { project_id?: string; message?: string; tool_call_mode?: string; session_id?: string } }>("/turn", async (req, reply) => {
    const projectId = String(req.body?.project_id ?? "");
    const message = String(req.body?.message ?? "");
    const sessionId = String(req.body?.session_id ?? "");
    if (!projectId) return reply.code(400).send({ error: "project_id 不能为空" });
    if (!message) return reply.code(400).send({ error: "message 不能为空" });
    const logger = new InteractionLogger();
    let agent;
    try {
      agent = buildAgent(projectId, logger, req.body?.tool_call_mode);
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
    try {
      const result = await agent.runTurn(projectId, message, {}, { session_id: sessionId || undefined, logger });
      return result;
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : String(err), success: false });
    }
  });

  // ---- 单轮对话（SSE 流式） ----
  app.post<{ Body: { project_id?: string; message?: string; tool_call_mode?: string; session_id?: string } }>("/turn/stream", async (req, reply) => {
    const projectId = String(req.body?.project_id ?? "");
    const message = String(req.body?.message ?? "");
    const sessionId = String(req.body?.session_id ?? "");
    if (!projectId || !message) {
      return reply.code(400).send({ error: "project_id 与 message 不能为空" });
    }
    const logger = new InteractionLogger();
    let agent: ProjectAgent;
    try {
      agent = buildAgent(projectId, logger, req.body?.tool_call_mode);
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }

    const turnKey = askKey(projectId, sessionId || "default");
    if (_activeTurns.has(turnKey)) {
      return reply.code(409).send({ error: "该会话已有进行中的任务，请等待完成后重试，或刷新页面查看最新状态" });
    }
    _activeTurns.add(turnKey);

    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    // 客户端断开时避免未处理错误；后续 write 失败静默忽略
    reply.raw.on("error", () => {});
    const send = (event: string, data: unknown): void => {
      try {
        reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      } catch {
        /* 连接已关闭，忽略 */
      }
    };
    // ask_user 长等待时维持连接，避免中间代理/网关断连
    const heartbeat = setInterval(() => {
      try {
        reply.raw.write(": ping\n\n");
      } catch {
        /* 忽略 */
      }
    }, 15000);

    // 关键：与 /answer、/pending-ask 共享同一个 AskResolver，作者回答才能送达 agent
    const askResolver = new AskResolver((q: AskQuestion) => send("ask", q));
    _askResolvers.set(turnKey, askResolver);

    try {
      const result = await agent.runTurn(projectId, message, {
        on_step: (step) => send("step", step),
        on_stream: (text) => send("chunk", text),
        on_thinking: (text) => send("thinking", text),
      }, { session_id: sessionId || undefined, logger, askResolver });
      send("done", result);
    } catch (err) {
      send("error", { error: err instanceof Error ? err.message : String(err) });
    } finally {
      clearInterval(heartbeat);
      _askResolvers.delete(turnKey);
      _activeTurns.delete(turnKey);
      try {
        reply.raw.end();
      } catch {
        /* 忽略 */
      }
    }
  });

  // ---- 回答 ask_user 提问（让等待中的 Agent 继续） ----
  app.post<{ Body: { project_id?: string; answer?: string; session_id?: string } }>("/answer", async (req, reply) => {
    const projectId = String(req.body?.project_id ?? "");
    const answer = String(req.body?.answer ?? "");
    const sessionId = String(req.body?.session_id ?? "default");
    const resolver = _askResolvers.get(askKey(projectId, sessionId));
    if (!resolver || !resolver.hasPending) {
      return reply.code(400).send({ success: false, message: "当前没有等待回答的问题" });
    }
    resolver.submitAnswer(answer);
    return { success: true, message: "回答已提交" };
  });

  // ---- 切换状态（T1 单锚点） ----
  app.post<{ Body: { project_id?: string; state?: string; work_unit?: string } }>("/switch-state", async (req, reply) => {
    const projectId = String(req.body?.project_id ?? "");
    const state = String(req.body?.state ?? "");
    if (!projectId || !state) return reply.code(400).send({ error: "project_id 与 state 不能为空" });
    try {
      const node = getStateNode(state);
      const projStore = store();
      const project = projStore.get(projectId);
      project.status = node.key;
      if (req.body?.work_unit !== undefined) project.work_unit = req.body.work_unit;
      projStore.save(project);
      return { current_state: node.key, label: node.label, work_unit: project.work_unit };
    } catch (err) {
      return reply.code(404).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });
}
