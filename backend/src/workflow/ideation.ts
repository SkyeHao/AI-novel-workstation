/** 统一创作 Agent（T3 单持续对话线 + T7 编排，替代旧 stage1 独立会话）。
 * 会话历史按书持久化于 memory/agent_chat.jsonl；每轮按当前小说级状态经 ContextOrchestrator 重组上下文。 */
import * as fs from "node:fs";
import * as path from "node:path";
import type { LLMClient } from "../llm/client.js";
import { InteractionLogger, type LLMInteraction } from "../llm/interaction_logger.js";
import { ChatMessage, Role, chatMessageFromDict } from "../llm/models.js";
import type { ProjectStore, Project } from "../storage/project_store.js";
import type { MemoryStore } from "../storage/memory_store.js";
import { createRetriever, type MemoryRetriever } from "../storage/retriever.js";
import type { SettingsStore } from "../storage/settings_store.js";
import { AgentSessionStore } from "../storage/agent_session_store.js";
import { legacyStatusToNew, getStateNode } from "../storage/states.js";
import { ContextOrchestrator } from "../agent/orchestrator.js";
import { ASK_ABORTED_SENTINEL, AgentAbortError, AskResolver, ReActAgent, type AgentStep, type AskQuestion, type ToolCallMode } from "../agent/react.js";
import { ToolManager } from "../tools/manager.js";
import { SaveDocumentTool, ReadDocumentTool, type DocumentToolContext } from "../tools/document_tools.js";
import { WebSearchTool } from "../tools/web_search.js";
import { AskUserTool } from "../tools/ask_user.js";
import { MemorySearchTool, ReadCurrentStateTool, SwitchStateTool, ListStatesTool, type NovelToolContext } from "../tools/novel_tools.js";
import { QueryDynamicTool, type DynamicQueryContext } from "../tools/dynamic_query_tool.js";
import { DynamicSettingsStore } from "../storage/dynamic_settings.js";
import { CORE_ELEMENTS_GUIDE, IDEATION_END_TOKEN, IDEATION_SYSTEM_PROMPT, TOOL_FORMAT_JSONFC, TOOL_FORMAT_NATIVE, VISION_DOC_GUIDE } from "./prompts.js";
import { NODE_PROMPTS } from "./node_prompts.js";
import { getNodePrompt } from "../storage/node_prompt_store.js";

export interface AgentTurnResult {
  reply: string;
  is_done: boolean;
  steps: AgentStep[];
  interactions: LLMInteraction[];
  success: boolean;
  error: string;
  aborted?: boolean;
}

export interface AgentRunCallbacks {
  on_step?: (step: AgentStep) => void | Promise<void>;
  on_stream?: (text: string) => void | Promise<void>;
  on_thinking?: (text: string) => void | Promise<void>;
  on_ask?: (q: AskQuestion) => void;
}

const AGENT_CHAT_FILE = "agent_chat.jsonl";

/** 中断重发标记（方案 B）：中断时追加到历史末尾，模型据此忽略半成品、基于已有进度续接 */
const INTERRUPT_MARKER =
  "上一轮生成被作者手动中断。已保留中断前完成的工具执行结果与回复；未完成的半截内容请忽略。请基于以上已有进度，直接响应作者接下来的新指令。";

/** 平台别名 → 展示名（与前端 PLATFORM_LABELS 保持一致） */
const PLATFORM_LABELS: Record<string, string> = {
  fanqie: "番茄",
};

function displayPlatform(platform: string): string {
  if (!platform) return "（待定）";
  return PLATFORM_LABELS[platform] ?? platform;
}

/** 判断字符串是否为裸/空 JSON 对象（{"": ""}、{}、[]），此类内容对用户不可读 */
function isBareJsonObject(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  let value: unknown;
  try {
    value = JSON.parse(t);
  } catch {
    return false;
  }
  if (Array.isArray(value)) return value.length === 0;
  if (value && typeof value === "object") {
    const vals = Object.values(value as Record<string, unknown>);
    if (vals.length === 0) return true;
    return vals.every((x) => x === null || x === undefined || String(x).trim() === "");
  }
  return false;
}

export class ProjectAgent {
  private _client: LLMClient;
  private _projectStore: ProjectStore;
  private _memory: MemoryStore;
  private _retriever: MemoryRetriever;
  private _settingsStore: SettingsStore;
  private _toolCallMode: ToolCallMode;
  private _sessionStore: AgentSessionStore | null;

  constructor(opts: {
    client: LLMClient;
    projectStore: ProjectStore;
    memoryStore: MemoryStore;
    settingsStore: SettingsStore;
    toolCallMode?: ToolCallMode;
    sessionStore?: AgentSessionStore;
  }) {
    this._client = opts.client;
    this._projectStore = opts.projectStore;
    this._memory = opts.memoryStore;
    this._retriever = createRetriever(opts.memoryStore);
    this._settingsStore = opts.settingsStore;
    this._toolCallMode = opts.toolCallMode ?? "jsonfc";
    this._sessionStore = opts.sessionStore ?? null;
  }

  getClient(): LLMClient {
    return this._client;
  }

  getCurrentState(project: Project): string {
    return legacyStatusToNew(getStateNodeSafe(project));
  }

  // ------------------------------------------------------------------
  // 对话历史持久化（按书）
  // ------------------------------------------------------------------

  historyPath(projectId: string): string {
    return this._projectStore.resolve(projectId, `memory/${AGENT_CHAT_FILE}`);
  }

  loadHistory(projectId: string): Array<Record<string, unknown>> {
    const p = this.historyPath(projectId);
    if (!fs.existsSync(p)) return [];
    const out: Array<Record<string, unknown>> = [];
    const lines = fs.readFileSync(p, "utf-8").split(/\r?\n/);
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        out.push(JSON.parse(line) as Record<string, unknown>);
      } catch {
        /* 忽略损坏行 */
      }
    }
    return out;
  }

  saveHistory(projectId: string, messages: Array<Record<string, unknown>>): void {
    const p = this.historyPath(projectId);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, messages.map((m) => JSON.stringify(m)).join("\n") + (messages.length ? "\n" : ""), "utf-8");
  }

  /** 统一持久化：多会话写会话文件，否则写旧单线 agent_chat.jsonl */
  private _persistHistory(
    projectId: string,
    sessionId: string | undefined,
    persisted: Array<Record<string, unknown>>,
    stateKey: string
  ): void {
    // 落盘兜底：assistant 消息若为裸/空 JSON（{"": ""}、{}、[]），替换为可读占位，避免历史残留不可读内容
    const sanitized = persisted.map((m) => {
      if (m.role === "assistant" && typeof m.content === "string" && isBareJsonObject(m.content)) {
        return { ...m, content: "（本轮输出未完成，请继续发送消息）" };
      }
      return m;
    });
    if (sessionId && this._sessionStore) {
      this._sessionStore.saveMessages(projectId, sessionId, sanitized);
      this._sessionStore.touch(projectId, sessionId, { state: stateKey, message_count: sanitized.length });
    } else {
      this.saveHistory(projectId, sanitized);
    }
  }

  /** 持久化前把最后一轮 assistant 回复清洗为纯文本：
   * react.ts 的 done 分支把原始协议 JSON（{"thought","tool_call","done"}）写入 agent.messages，
   * 而前端实时收到的是提取后的 turn.reply。落盘时若最后一条是 assistant 且无工具调用，
   * 用 turn.reply 覆盖其 content，保证历史文件干净、各消费者读到最终回复文本。 */
  private _cleanFinalAssistantReply(messages: ChatMessage[], reply: string): void {
    if (!reply || !reply.trim()) return;
    const last = messages[messages.length - 1];
    if (last && last.role === Role.ASSISTANT && !last.function_call) {
      last.content = reply;
    }
  }

  // ------------------------------------------------------------------
  // 工具面（T4）
  // ------------------------------------------------------------------

  private _buildToolManager(
    project: Project,
    onAsk: AskResolver,
    stateAnchor: { current: string },
    sessionId?: string
  ): ToolManager {
    // 切换状态：同步更新内存锚点、项目级状态与会话状态，保证提示词/工具权限/工作台一致
    const applyState = (key: string): string => {
      const node = getStateNode(key);
      stateAnchor.current = node.key;
      const updated = this._projectStore.update(project.id, { status: node.key });
      project.status = updated.status;
      if (sessionId && this._sessionStore) {
        this._sessionStore.touch(project.id, sessionId, { state: node.key });
      }
      return node.key;
    };
    const ctx: NovelToolContext = {
      projectId: project.id,
      projectStore: this._projectStore,
      memory: this._memory,
      retriever: this._retriever,
      getCurrentState: () => stateAnchor.current,
      switchState: applyState,
      getWorkUnit: () => (project as Project & { work_unit?: string }).work_unit ?? "",
      getEnabledStates: () => {
        const enabled = (project as Project & { states_enabled?: string[] }).states_enabled;
        return enabled && enabled.length > 0 ? enabled : [];
      },
    };
    const tm = new ToolManager();
    const docCtx: DocumentToolContext = {
      projectId: project.id,
      projectStore: this._projectStore,
      memory: this._memory,
      settingsStore: this._settingsStore,
      client: this._client,
      getCurrentState: () => stateAnchor.current,
      getWorkUnit: () => (project as Project & { work_unit?: string }).work_unit ?? "",
    };
    const dynCtx: DynamicQueryContext = {
      projectId: project.id,
      dynamicStore: new DynamicSettingsStore(this._projectStore),
      getCurrentState: () => stateAnchor.current,
    };
    tm.register(new SaveDocumentTool(docCtx));
    tm.register(new ReadDocumentTool(docCtx));
    tm.register(new WebSearchTool());
    tm.register(new AskUserTool((question, options, multiple, allowCustom) => onAsk.ask(question, options, multiple, allowCustom)));
    tm.register(new ReadCurrentStateTool(ctx));
    tm.register(new ListStatesTool(ctx));
    tm.register(new SwitchStateTool(ctx));
    tm.register(new MemorySearchTool(ctx));
    tm.register(new QueryDynamicTool(dynCtx));
    return tm;
  }

  // ------------------------------------------------------------------
  // 一轮对话
  // ------------------------------------------------------------------

  async runTurn(
    projectId: string,
    userMessage: string,
    callbacks: AgentRunCallbacks = {},
    opts: { session_id?: string; state?: string; logger?: InteractionLogger; askResolver?: AskResolver; signal?: AbortSignal } = {}
  ): Promise<AgentTurnResult> {
    const project = this._projectStore.get(projectId);
    const stateKey = opts.state ?? this.getCurrentState(project);
    const stateNode = getStateNode(stateKey);
    // 会话内可变状态锚点：工具权限与 switch_state 都以它为准，与系统提示词保持一致
    const stateAnchor: { current: string } = { current: stateKey };

    // 优先使用路由传入的 logger（client 的交互都记录在它上面）；否则新建兜底
    const interactionLogger = opts.logger ?? new InteractionLogger();
    const client = this._client;
    const askResolver = opts.askResolver ?? new AskResolver(callbacks.on_ask ?? null);
    const toolManager = this._buildToolManager(project, askResolver, stateAnchor, opts.session_id);

    const toolFormat = this._toolCallMode === "jsonfc" ? TOOL_FORMAT_JSONFC : TOOL_FORMAT_NATIVE;
    const nodePromptBuilder = NODE_PROMPTS[stateKey];
    // 优先使用用户在提示词管理中自定义的节点提示词（创作引擎可编辑）
    const customDetail = getNodePrompt(stateKey);
    const nodeSystemPrompt = customDetail?.isCustom ? customDetail.prompt : (nodePromptBuilder ? nodePromptBuilder({ node: stateNode, projectId }) : "");
    const systemPrompt =
      (nodeSystemPrompt ? nodeSystemPrompt.trim() + "\n\n" : "") +
      IDEATION_SYSTEM_PROMPT.replace("{project_name}", project.name)
        .replace("{genre}", project.genre || "（待定）")
        .replace("{platform}", displayPlatform(project.platform))
        .replace("{target_words}", project.target_words ? String(project.target_words) : "（待定）")
        .replace("{idea}", project.idea || "（待定）")
        .replace("{tools}", toolManager.toPrompt())
        .replace("{tool_format}", toolFormat)
        .replace("{vision_doc_guide}", VISION_DOC_GUIDE)
        .replace("{core_elements_guide}", CORE_ELEMENTS_GUIDE)
        .replace("{end_token}", IDEATION_END_TOKEN);

    const stateHint = `\n\n## 当前创作状态\n当前小说级状态：${stateNode.label}（key=${stateNode.key}）。状态上下文规则：${stateNode.context_assembly_ref}。\n你可以用 read_current_state / list_states / switch_state 查看或切换状态。\n若作者请求的任务属于其他创作节点（如生成人物卡片属于 characters、写正文属于 writing），请先用 switch_state 切换到对应节点再继续，不要在当前节点硬做其他节点的产出；切换不会丢失当前进度。`;

   // 历史 + 系统（多会话：从会话文件读取；否则兼容旧单线 agent_chat.jsonl）
    const history = opts.session_id && this._sessionStore ? this._sessionStore.loadMessages(projectId, opts.session_id) : this.loadHistory(projectId);
    const messages: ChatMessage[] = [
      new ChatMessage(Role.SYSTEM, systemPrompt + stateHint),
      ...history.map((m) => chatMessageFromDict(m)),
    ];

    // T7 编排：按状态注入 记忆召回/分层摘要/设定片段 + token 压缩
    const orchestrator = new ContextOrchestrator(
      client,
      this._memory,
      this._retriever,
      (pid: string, settingType: string) => (this._settingsStore.exists(pid, settingType) ? this._settingsStore.get(pid, settingType) : null)
    );
    let agent: ReActAgent;
    agent = new ReActAgent({
      client,
      tool_manager: toolManager,
      system_prompt: systemPrompt,
     max_iterations: 12,
     max_output_tokens: 4000,
      // jsonfc 依赖严格 JSON 协议：降低温度提高输出稳定性，避免畸形 JSON 造成反复重试/卡住
      temperature: this._toolCallMode === "jsonfc" ? 0.2 : 0.7,
     tool_call_mode: this._toolCallMode,
     ask_resolver: askResolver,
     end_token: IDEATION_END_TOKEN,
      on_ask_pending: () => {
        // ask 挂起等待作者回答时也落盘当前进度，避免刷新/重启后对话丢失
        const persisted = agent.messages.slice(1).map((m) => m.toDict());
        this._persistHistory(projectId, opts.session_id, persisted, stateKey);
      },
    });
    // 先落盘「历史 + 本次用户消息」：即使编排/流式中断、LLM 失败，用户消息也不会丢（成功后整体覆盖）
    const pendingPersist: Array<Record<string, unknown>> = [...history, { role: "user", content: userMessage, timestamp: new Date().toISOString() }];
    this._persistHistory(projectId, opts.session_id, pendingPersist, stateKey);

    const start = Date.now();
    let turn: Awaited<ReturnType<ReActAgent["run_turn"]>>;
    try {
      // 编排（记忆召回/摘要/压缩）也可能被中断：编排结果进入 agent.messages
      agent.messages = await orchestrator.process(
        messages,
        {
          project_id: projectId,
          state: stateKey,
          user_message: userMessage,
        },
        opts.signal
      );
      turn = await agent.run_turn(
        userMessage,
        {
          on_step: callbacks.on_step,
          on_stream: callbacks.on_stream,
          on_thinking: callbacks.on_thinking,
          on_ask: callbacks.on_ask,
        },
        opts.signal
      );
    } catch (err) {
      // 失败/中断也保存已累积消息（至少保留用户输入），避免对话丢失
      let persisted = agent.messages.slice(1).map((m) => m.toDict());
      // 中断可能发生在编排或推送用户消息之前：agent.messages 未含本次用户消息时用 pendingPersist 兜底
      if (persisted.length === 0) persisted = pendingPersist;
      const aborted =
        Boolean(opts.signal?.aborted) ||
        err instanceof AgentAbortError ||
        (err instanceof Error && (err.name === "AbortError" || err.name === "DOMException"));
      // 方案 B：中断时保留已完成进度，并追加显式中断标记，供重发时模型续接
      if (aborted && persisted.length > 0) {
        persisted = [...persisted, { role: "system", content: INTERRUPT_MARKER, timestamp: new Date().toISOString() }];
      }
      this._persistHistory(projectId, opts.session_id, persisted, stateKey);
      return {
        reply: "",
        is_done: false,
        steps: [],
        interactions: interactionLogger.get_all(),
        success: false,
        aborted,
        error: aborted ? "生成已被中断" : (err instanceof Error ? err.message : String(err)),
      };
    }

    // 持久化：保存除系统外的历史（下一轮重建系统提示）
    // 先把最后一轮回复清洗为纯文本，避免落盘原始协议 JSON
    this._cleanFinalAssistantReply(agent.messages, turn.reply);
    const persisted: Array<Record<string, unknown>> = agent.messages.slice(1).map((m) => m.toDict());
    this._persistHistory(projectId, opts.session_id, persisted, stateKey);

    const elapsed = Date.now() - start;
    const interactions = interactionLogger.get_all();
    // 路由层已通过 commit 回调实时落盘时不再重复批量保存，避免重复记录
    if (!interactionLogger.has_commit()) {
      for (const it of interactions) {
        try {
          const { saveInteraction } = await import("../storage/interaction_store.js");
          saveInteraction("agent", it, { task_type: "text", session_id: opts.session_id ?? projectId, user_message: userMessage });
        } catch (err) {
          console.warn(`保存 Agent 交互记录失败: ${err}`);
        }
      }
    }

    return {
      reply: turn.reply,
      is_done: turn.is_done,
      steps: turn.steps,
      interactions,
      success: true,
      error: "",
    };
  }
}

function getStateNodeSafe(project: Project): string {
  return project.status ?? "ideation";
}


