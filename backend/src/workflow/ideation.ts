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
import { AskResolver, ReActAgent, type AgentStep, type AskQuestion, type ToolCallMode } from "../agent/react.js";
import { ToolManager } from "../tools/manager.js";
import { FileReadTool } from "../tools/file_read.js";
import { FileWriteTool } from "../tools/file_write.js";
import { WebSearchTool } from "../tools/web_search.js";
import { AskUserTool } from "../tools/ask_user.js";
import { MemorySearchTool, ReadCurrentStateTool, SwitchStateTool, ListStatesTool, type NovelToolContext } from "../tools/novel_tools.js";
import { IDEATION_END_TOKEN, IDEATION_SYSTEM_PROMPT, TOOL_FORMAT_JSONFC, TOOL_FORMAT_NATIVE } from "./prompts.js";

export interface AgentTurnResult {
  reply: string;
  is_done: boolean;
  steps: AgentStep[];
  interactions: LLMInteraction[];
  success: boolean;
  error: string;
}

export interface AgentRunCallbacks {
  on_step?: (step: AgentStep) => void | Promise<void>;
  on_stream?: (text: string) => void | Promise<void>;
  on_thinking?: (text: string) => void | Promise<void>;
  on_ask?: (q: AskQuestion) => void;
}

const AGENT_CHAT_FILE = "agent_chat.jsonl";

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
    if (sessionId && this._sessionStore) {
      this._sessionStore.saveMessages(projectId, sessionId, persisted);
      this._sessionStore.touch(projectId, sessionId, { state: stateKey, message_count: persisted.length });
    } else {
      this.saveHistory(projectId, persisted);
    }
  }

  // ------------------------------------------------------------------
  // 工具面（T4）
  // ------------------------------------------------------------------

  private _buildToolManager(project: Project, onAsk: AskResolver): ToolManager {
    const ctx: NovelToolContext = {
      projectId: project.id,
      projectStore: this._projectStore,
      memory: this._memory,
      retriever: this._retriever,
      getCurrentState: () => legacyStatusToNew(project.status),
      switchState: (key: string) => {
        const node = getStateNode(key);
        const updated = this._projectStore.update(project.id, { status: node.key });
        project.status = updated.status;
        return updated.status;
      },
      getWorkUnit: () => (project as Project & { work_unit?: string }).work_unit ?? "",
      getEnabledStates: () => {
        const enabled = (project as Project & { states_enabled?: string[] }).states_enabled;
        return enabled && enabled.length > 0 ? enabled : [];
      },
    };
    const tm = new ToolManager();
    const root = this._projectStore.project_root(project.id);
    tm.register(new FileReadTool(root));
    tm.register(new FileWriteTool(root));
    tm.register(new WebSearchTool());
    tm.register(new AskUserTool((question, options, multiple, allowCustom) => onAsk.ask(question, options, multiple, allowCustom)));
    tm.register(new ReadCurrentStateTool(ctx));
    tm.register(new ListStatesTool(ctx));
    tm.register(new SwitchStateTool(ctx));
    tm.register(new MemorySearchTool(ctx));
    return tm;
  }

  // ------------------------------------------------------------------
  // 一轮对话
  // ------------------------------------------------------------------

  async runTurn(
    projectId: string,
    userMessage: string,
    callbacks: AgentRunCallbacks = {},
    opts: { session_id?: string; state?: string; logger?: InteractionLogger; askResolver?: AskResolver } = {}
  ): Promise<AgentTurnResult> {
    const project = this._projectStore.get(projectId);
    const stateKey = opts.state ?? this.getCurrentState(project);
    const stateNode = getStateNode(stateKey);

    // 优先使用路由传入的 logger（client 的交互都记录在它上面）；否则新建兜底
    const interactionLogger = opts.logger ?? new InteractionLogger();
    const client = this._client;
    const askResolver = opts.askResolver ?? new AskResolver(callbacks.on_ask ?? null);
    const toolManager = this._buildToolManager(project, askResolver);

    const toolFormat = this._toolCallMode === "jsonfc" ? TOOL_FORMAT_JSONFC : TOOL_FORMAT_NATIVE;
    const systemPrompt = IDEATION_SYSTEM_PROMPT
      .replace("{project_name}", project.name)
      .replace("{genre}", project.genre || "（待定）")
      .replace("{platform}", project.platform || "（待定）")
      .replace("{target_words}", project.target_words ? String(project.target_words) : "（待定）")
      .replace("{tools}", toolManager.toPrompt())
      .replace("{tool_format}", toolFormat)
      .replace("{end_token}", IDEATION_END_TOKEN);

    const stateHint = `\n\n## 当前创作状态\n当前小说级状态：${stateNode.label}（key=${stateNode.key}）。状态上下文规则：${stateNode.context_assembly_ref}。\n你可以用 read_current_state / list_states / switch_state 查看或切换状态。`;

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
    const processed = await orchestrator.process(messages, {
      project_id: projectId,
      state: stateKey,
      user_message: userMessage,
    });

    const agent = new ReActAgent({
      client,
      tool_manager: toolManager,
      system_prompt: systemPrompt,
      max_iterations: 12,
      max_output_tokens: 4000,
      tool_call_mode: this._toolCallMode,
      ask_resolver: askResolver,
      end_token: IDEATION_END_TOKEN,
    });
    agent.messages = processed;

    // 先落盘「历史 + 本次用户消息」：即使流式中断/LLM 失败，用户消息也不会丢（成功后整体覆盖）
    const pendingPersist: Array<Record<string, unknown>> = [...history, { role: "user", content: userMessage, timestamp: new Date().toISOString() }];
    this._persistHistory(projectId, opts.session_id, pendingPersist, stateKey);

    const start = Date.now();
    let turn: Awaited<ReturnType<ReActAgent["run_turn"]>>;
    try {
      turn = await agent.run_turn(userMessage, {
        on_step: callbacks.on_step,
        on_stream: callbacks.on_stream,
        on_thinking: callbacks.on_thinking,
        on_ask: callbacks.on_ask,
      });
    } catch (err) {
      // 失败也保存已累积消息（至少保留用户输入），避免对话丢失
      const persisted = agent.messages.slice(1).map((m) => m.toDict());
      this._persistHistory(projectId, opts.session_id, persisted, stateKey);
      return {
        reply: "",
        is_done: false,
        steps: [],
        interactions: interactionLogger.get_all(),
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    // 持久化：保存除系统外的历史（下一轮重建系统提示）
    const persisted: Array<Record<string, unknown>> = agent.messages.slice(1).map((m) => m.toDict());
    this._persistHistory(projectId, opts.session_id, persisted, stateKey);

    const elapsed = Date.now() - start;
    const interactions = interactionLogger.get_all();
    for (const it of interactions) {
      try {
        const { saveInteraction } = await import("../storage/interaction_store.js");
        saveInteraction("agent", it, { task_type: "text", session_id: opts.session_id ?? projectId, user_message: userMessage });
      } catch (err) {
        console.warn(`保存 Agent 交互记录失败: ${err}`);
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
