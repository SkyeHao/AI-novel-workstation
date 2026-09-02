/** 统一 Agent 窗口路由（T3/T4/T7）。
 * 单持续对话线 + 状态重组；SSE 推送 step/chunk/thinking/ask；ask 由 /answer 异步续答。
 * 多会话：每本书可有多个会话，持久化于项目目录 memory/sessions/ 下。 */
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { getProjectStore, getClientForState } from "../state.js";
import { MemoryStore } from "../../storage/memory_store.js";
import { SettingsStore } from "../../storage/settings_store.js";
import { AgentSessionStore, DEFAULT_SESSION_ID } from "../../storage/agent_session_store.js";
import { ProjectAgent } from "../../workflow/ideation.js";
import { InteractionLogger } from "../../llm/interaction_logger.js";
import { saveInteraction } from "../../storage/interaction_store.js";
import { AskResolver, AgentAbortError, type AskQuestion } from "../../agent/react.js";
import { DEFAULT_STATES, getStateNode, legacyStatusToNew } from "../../storage/states.js";

/** ask 等待器：按 项目+会话 隔离 */
const _askResolvers = new Map<string, AskResolver>();
/** 会话级进行中的 turn（防并发覆盖导致 ask/回答错位） */
const _activeTurns = new Set<string>();
/** 会话级进行中的 turn 的中断控制器（供 /turn/stop 触发 abort） */
const _turnControllers = new Map<string, AbortController>();

function askKey(projectId: string, sessionId: string): string {
  return `${projectId}::${sessionId || "default"}`;
}

export async function agentRoutes(app: FastifyInstance): Promise<void> {
  const store = () => getProjectStore();
  const sessionStore = () => new AgentSessionStore(store());

  function buildAgent(projectId: string, logger: InteractionLogger, toolCallMode?: string, stateKey?: string): ProjectAgent {
    const project = store().get(projectId);
    const key = stateKey || legacyStatusToNew(project.status);
    const client = getClientForState(key, logger);
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
  app.get<{ Querystring: { project_id?: string; session_id?: string } }>("/context", async (req, reply) => {
    const projectId = String(req.query.project_id ?? "");
    const sessionId = String(req.query.session_id ?? "");
    if (!projectId) return reply.code(400).send({ error: "project_id 不能为空" });
    try {
      const projStore = store();
      const project = projStore.get(projectId);
      const enabled = project.states_enabled && project.states_enabled.length > 0 ? project.states_enabled : DEFAULT_STATES.map((s) => s.key);
      const states = DEFAULT_STATES.map((s) => ({ ...s, enabled_in_project: enabled.includes(s.key) }));
      // 展示与会话一致的状态：runTurn 优先用会话级 state（meta.state），
      // 指定会话时这里也优先取会话状态，避免 chips 显示项目级状态而 agent 却按会话状态工作
      let currentStateKey = project.status;
      if (sessionId) {
        try {
          const meta = sessionStore().get(projectId, sessionId);
          if (meta?.state) currentStateKey = meta.state;
        } catch {
          /* 会话不存在则回退项目级状态 */
        }
      }
      const current = getStateNode(currentStateKey);
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
      const sStore = sessionStore();
      const sessions = sStore.list(projectId).map((s) => ({ ...s, phase: sStore.getPhaseState(projectId, s.id)?.phase ?? "idle" }));
      return { project_id: projectId, sessions };
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
    const sessionId = String(req.query.session_id ?? DEFAULT_SESSION_ID);
    if (!projectId) return reply.code(400).send({ error: "project_id 不能为空" });
    const sStore = sessionStore();
    const resolver = _askResolvers.get(askKey(projectId, sessionId));
    if (resolver && resolver.hasPending) return { has_pending: true, question: resolver.peek() };
    // 进程重启后内存 resolver 丢失：从持久化状态恢复"停在等待作者回答"
    const phaseState = sStore.getPhaseState(projectId, sessionId);
    if (phaseState && phaseState.phase === "awaiting_ask" && phaseState.ask) {
      return { has_pending: true, question: phaseState.ask };
    }
    return { has_pending: false, question: null };
  });

  // ---- 单轮对话（非流式） ----
  app.post<{ Body: { project_id?: string; message?: string; tool_call_mode?: string; session_id?: string } }>("/turn", async (req, reply) => {
    const projectId = String(req.body?.project_id ?? "");
    const message = String(req.body?.message ?? "");
    const sessionId = String(req.body?.session_id ?? "");
    if (!projectId) return reply.code(400).send({ error: "project_id 不能为空" });
    if (!message) return reply.code(400).send({ error: "message 不能为空" });
    const turnId = randomUUID();
    const logger = new InteractionLogger((it) => {
      try {
        saveInteraction("agent", it, { task_type: "text", session_id: sessionId || projectId, turn_id: turnId, user_message: message, project_id: projectId });
      } catch (err) {
        console.warn(`保存 Agent 交互记录失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    });
    let agent;
    try {
      const meta = sessionStore().get(projectId, sessionId || DEFAULT_SESSION_ID);
      agent = buildAgent(projectId, logger, req.body?.tool_call_mode, meta?.state);
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
    const turnId = randomUUID();
    const logger = new InteractionLogger((it) => {
      try {
        saveInteraction("agent", it, { task_type: "text", session_id: sessionId || projectId, turn_id: turnId, user_message: message, project_id: projectId });
      } catch (err) {
        console.warn(`保存 Agent 交互记录失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    });
    let agent: ProjectAgent;
    try {
      const meta = sessionStore().get(projectId, sessionId || DEFAULT_SESSION_ID);
      agent = buildAgent(projectId, logger, req.body?.tool_call_mode, meta?.state);
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }

    const turnKey = askKey(projectId, sessionId || "default");
    if (_activeTurns.has(turnKey)) {
      return reply.code(409).send({ error: "该会话已有进行中的任务，请等待完成后重试，或刷新页面查看最新状态" });
    }
    _activeTurns.add(turnKey);

    // 会话进入流式生成阶段（持久化，供刷新/重启恢复）
    sessionStore().setPhaseState(projectId, sessionId || DEFAULT_SESSION_ID, { phase: "streaming" });
    // 本轮中断控制器：/turn/stop 或客户端断连可触发
    const controller = new AbortController();
    _turnControllers.set(turnKey, controller);

    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    // 客户端断开时避免未处理错误；后续 write 失败静默忽略
    reply.raw.on("error", () => {});
    let turnFinished = false;
    // 客户端断连兜底：本轮仍在进行且非等待作者回答时，中断生成释放资源
    reply.raw.on("close", () => {
      if (turnFinished || controller.signal.aborted) return;
      if (_askResolvers.get(turnKey)?.hasPending) return;
      controller.abort();
    });
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
    const askResolver = new AskResolver((q: AskQuestion) => {
      send("ask", q);
      // 把"等待作者回答"持久化：即使进程重启，前端仍能恢复 ask 卡片
      sessionStore().setPhaseState(projectId, sessionId || DEFAULT_SESSION_ID, { phase: "awaiting_ask", ask: q });
    });
    _askResolvers.set(turnKey, askResolver);

    try {
      const meta = sessionStore().get(projectId, sessionId || DEFAULT_SESSION_ID);
      const result = await agent.runTurn(projectId, message, {
        on_step: (step) => send("step", step),
        on_stream: (text) => send("chunk", text),
        on_thinking: (text) => send("thinking", text),
      }, { session_id: sessionId || undefined, logger, askResolver, state: meta?.state ?? undefined, signal: controller.signal });
      if (result.aborted) {
        send("aborted", { ...result, message: "生成已被中断，已保留已有进度，可继续输入消息" });
      } else {
        send("done", result);
      }
    } catch (err) {
      const isAbort =
        controller.signal.aborted ||
        err instanceof AgentAbortError ||
        (err instanceof Error && (err.name === "AbortError" || err.name === "DOMException"));
      if (isAbort) {
        send("aborted", { reply: "", is_done: false, success: false, aborted: true, error: "生成已被中断" });
      } else {
        send("error", { error: err instanceof Error ? err.message : String(err) });
      }
    } finally {
      turnFinished = true;
      clearInterval(heartbeat);
      _askResolvers.delete(turnKey);
      _activeTurns.delete(turnKey);
      _turnControllers.delete(turnKey);
      sessionStore().setPhaseState(projectId, sessionId || DEFAULT_SESSION_ID, { phase: "idle" });
      try {
        reply.raw.end();
      } catch {
        /* 忽略 */
      }
    }
  });

  // ---- 停止进行中的 turn（中断生成） ----
  app.post<{ Body: { project_id?: string; session_id?: string } }>("/turn/stop", async (req, reply) => {
    const projectId = String(req.body?.project_id ?? "");
    const sessionId = String(req.body?.session_id ?? DEFAULT_SESSION_ID);
    if (!projectId) return reply.code(400).send({ error: "project_id 不能为空" });
    const turnKey = askKey(projectId, sessionId);
    const controller = _turnControllers.get(turnKey);
    const resolver = _askResolvers.get(turnKey);
    if (controller) controller.abort();
    // 若正停在 ask_user 等待作者回答，仅 abort 无法解除 ask 等待，需同时释放 resolver
    if (resolver?.hasPending) resolver.abort();
    // 结束"等待作者回答"持久化相位
    const phaseState = sessionStore().getPhaseState(projectId, sessionId);
    if (phaseState?.phase === "awaiting_ask") {
      sessionStore().setPhaseState(projectId, sessionId, { phase: "idle" });
    }
    return { success: true, aborted: true, message: "已发送中断指令，Agent 停止生成" };
  });

  // ---- 回答 ask_user 提问（让等待中的 Agent 继续） ----
  app.post<{ Body: { project_id?: string; answer?: string; session_id?: string } }>("/answer", async (req, reply) => {
    const projectId = String(req.body?.project_id ?? "");
    const answer = String(req.body?.answer ?? "");
    const sessionId = String(req.body?.session_id ?? DEFAULT_SESSION_ID);
    const sStore = sessionStore();
    const resolver = _askResolvers.get(askKey(projectId, sessionId));
    if (resolver && resolver.hasPending) {
      resolver.submitAnswer(answer);
      sStore.setPhaseState(projectId, sessionId, { phase: "streaming" });
      return { success: true, resumed: true, message: "回答已提交，Agent 继续生成" };
    }
    // 降级：Agent 进程已重启，内存等待器丢失。这里不再直接落盘"作者的选择"，
    // 否则前端续跑时会在历史里重复出现。保持 awaiting_ask 相位（未续跑前 ask 卡片仍可恢复），
    // 返回 restart 标志，由前端把回答作为新 turn 通过 SSE 重新发起，Agent 基于历史继续推进。
    const phaseState = sStore.getPhaseState(projectId, sessionId);
    if (phaseState && phaseState.phase === "awaiting_ask") {
      return {
        success: true,
        resumed: false,
        restart: true,
        message: "Agent 已中断，回答已受理，正在重新发起生成",
      };
    }
    return reply.code(400).send({ success: false, message: "当前没有等待回答的问题" });
  });

  // ---- 切换状态（T1 单锚点） ----
  // ---- 切换状态（T1 单锚点：项目级 + 会话级同步） ----
  app.post<{ Body: { project_id?: string; state?: string; work_unit?: string; session_id?: string } }>("/switch-state", async (req, reply) => {
    const projectId = String(req.body?.project_id ?? "");
    const state = String(req.body?.state ?? "");
    const sessionId = String(req.body?.session_id ?? "");
    if (!projectId || !state) return reply.code(400).send({ error: "project_id 与 state 不能为空" });
    try {
      const node = getStateNode(state);
      const projStore = store();
      const project = projStore.get(projectId);
      project.status = node.key;
      if (req.body?.work_unit !== undefined) project.work_unit = req.body.work_unit;
      projStore.save(project);
      // 同步会话级状态锚点：runTurn 优先使用会话 state（meta.state），
      // 若只改项目级状态，会话仍按旧节点工作，导致前端手动切换看起来不生效
      if (sessionId) {
        try { sessionStore().touch(projectId, sessionId, { state: node.key }); } catch { /* 会话不存在时忽略 */ }
      }
      return { current_state: node.key, label: node.label, work_unit: project.work_unit };
    } catch (err) {
      return reply.code(404).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });
}
