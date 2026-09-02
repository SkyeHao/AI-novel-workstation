/**
 * 多 Agent 群聊编排器（ChatSession）——本 feature 的唯一黑盒测试 seam。
 *
 * 工单 01：会话骨架 + 状态机 + SSE 基础事件（system / chat_message / done / error）。
 * 后续工单将逐步接入：意愿度调度(02)、作者 @ 召唤(03)、共识检测(04)、
 * 分层上下文(05)、Embedding/向量库(06)、持久化恢复(07)、应用与移除标准模式(08)。
 */
import { randomUUID } from "node:crypto";
import { ChatMessage, Role } from "../llm/models.js";
import type { LLMClient } from "../llm/client.js";
import type { AgentRoleCategory } from "../assets/agent_roles.js";
import { SpeakerScheduler, type WillingnessBreakdown } from "./speaker_scheduler.js";
import type { SpeakerSchedulerOptions } from "./speaker_scheduler.js";
import { ConsensusDetector, stripSelfRating } from "./consensus_detector.js";
import type { ConsensusDetectorOptions } from "./consensus_detector.js";
import { LLMConsensusDetector, type LLMConsensusDetectorOptions } from "./llm_consensus_detector.js";
import {
  probeSchedulerDecision,
  type SchedulerAgentInput,
  type SchedulerMemberInfo,
} from "./scheduler_agent.js";
import { compact } from "./willingness_prompt.js";
import { ContextAssembler, type ContextAssemblerOptions } from "./context_assembler.js";
import { DIRECTOR_SYSTEM_PROMPT } from "../assets/roundtable_agent_prompts.js";
import type { EmbeddingService } from "../vector/embedding.js";
import type { VectorStore } from "../vector/store.js";
import { VectorDiscussionContext } from "../vector/context.js";
import { ToolManager } from "../tools/manager.js";
import { createChatReadTools } from "../tools/chat_read_tools.js";
import { AskUserTool } from "../tools/ask_user.js";
import { FinishTurnTool } from "../tools/finish_turn.js";
import { AskResolver, type AskQuestion, ASK_ABORTED_SENTINEL } from "../agent/react.js";
import type { ChatStore } from "../storage/chat_store.js";
import { getProjectStore } from "../api/state.js";

export type ChatSessionStatus = "idle" | "running" | "synthesizing" | "completed" | "terminated";

/**
 * 无限制轮次模式（maxRounds <= 0，直到达成共识）的硬上限。
 * 即使 LLM 共识裁判一直未判定「达成一致」，也强制在到达该轮数后收束，
 * 避免 LLM 无限循环消耗资源。到达时若存在合成者则强制合成最终方案。
 */
const UNLIMITED_ROUNDS_HARD_CAP = 99;

/**
 * 作者「驳回提案 / 换方向」信号的正则集合（启发式）。
 * 作者消息命中任一模式时，系统认为作者否定了当前提案归属人的方案并要求换方向，
 * 从而把话筒交还给该提案者重新提案（软约束进导演提示词 + 硬规则兜底）。
 */
const AUTHOR_REJECTION_PATTERNS: RegExp[] = [
  /换个?s*(方向|思路|角度|话题|题材|主题|方案|路子|个方向)/,
  /换(?:种|条)s*(思路|角度|方向|路子|题材|主题)/,
  /换个|换一种|换条路|换换|继续换/,
  /重来|重新(?:来|讨论|想|给|提|选)/,
  /(方向|思路|题材|主题|方案|提案)?(?:不行|不好|不对|不合适|不理想|不满意)/,
  /否掉|不要这个|太虚|太空洞|没落地|换个别的|再想想/,
  /方向不对|跑题了/,
];

/** 作者连续驳回后，硬规则强制把话筒交还给被驳回提案者的次数上限；超过后交还其他成员提供新视角。 */
const REJECTED_PROPOSER_RETURN_LIMIT = 2;

export interface ChatMember {
  id: string;
  kind: "agent" | "author";
  name: string;
  description: string;
  category: AgentRoleCategory;
  /** 该成员使用的模型 id；为空时跟随系统默认模型 / 任务分配 */
  modelId?: string | null;
  /** 角色系统提示词（来自角色蓝图），工单 05 将扩展为完整上下文组装 */
  systemPrompt?: string;
  /** 角色注入的静态设定键（来自角色蓝图的 contextConfig.sharedContextKeys，工单 05） */
  sharedContextKeys?: string[];
}

export interface ChatMessageRecord {
  id: string;
  sessionId: string;
  memberId: string;
  memberName: string;
  kind: "agent" | "author" | "system";
  category?: AgentRoleCategory;
  content: string;
  timestamp: string;
  /** 回应的消息 id（工单 05 接入），让讨论脉络可溯 */
  replyTo?: string;
}

/** 共识节点（工单 07 持久化：成果单独落库，与过程记录分离）。 */
export interface ChatConsensusNode {
  level: number;
  message: string;
  signals?: string[];
  timestamp: string;
}

/** 可序列化的会话快照（工单 07：供持久化 / 恢复 / 前端查看）。 */
export interface ChatSessionSnapshot {
  id: string;
  projectId: string;
  topic: string;
  members: ChatMember[];
  messages: ChatMessageRecord[];
  status: ChatSessionStatus;
  createdAt: string;
  updatedAt: string;
  summary?: string;
  consensusNodes: ChatConsensusNode[];
}

export type ChatSessionEvent =
  | { type: "system"; data: { message: string; status?: ChatSessionStatus; memberId?: string } }
  | { type: "chat_message"; data: ChatMessageRecord }
  | { type: "delta"; data: { messageId: string; memberId: string; memberName: string; content: string; done?: boolean } }
  | {
      type: "speaker";
      data: { memberId: string; memberName: string; scores: Record<string, number>; reason: string };
    }
   | { type: "agent_status"; data: { memberId: string; status: "thinking" | "generating" | "idle" } }
   | { type: "consensus"; data: { level: number; message: string; signals?: string[] } }
  | { type: "thinking"; data: { messageId: string; memberId: string; memberName: string; content: string } }
  | { type: "tool_call"; data: { messageId: string; memberId: string; memberName: string; tool: string; args: Record<string, unknown> } }
  | { type: "tool_result"; data: { messageId: string; memberId: string; memberName: string; tool: string; content: string; success: boolean } }
  | { type: "ask"; data: { messageId?: string; memberId: string; memberName: string; question: AskQuestion } }
  | {
      type: "scheduler_probe";
      data: {
        round: number;
        ranking: Array<{ memberId: string; priority: number; reason: string }>;
        note?: string;
        chosenId: string | null;
        fallback: boolean;
        parseOk: boolean;
        raw: string;
        /** 作者刚驳回的提案归属人 id（未处于驳回态为 null） */
        rejectedProposerId?: string | null;
        /** 本次决策是否由「作者驳回强制回到提案者」规则覆盖 */
        rejectionForced?: boolean;
      };
    }
  | { type: "done"; data: { status: "completed" | "terminated"; summary?: string } }
  | { type: "error"; data: { error: string } };

export interface ChatSessionConfig {
  id?: string;
  projectId: string;
  topic: string;
  members: ChatMember[];
  /** 注入的静态设定（世界观 / 人物 / 大纲等），工单 05 正式组装进上下文 */
  staticContext?: Record<string, string>;
  llm: LLMClient;
  /** 按成员解析其专属 LLM client（基于 ChatMember.modelId）；缺省回落 config.llm */
  clientResolver?: (member: ChatMember) => LLMClient;
  /** 发言总预算（Agent 发言次数上限），默认 8；<=0 表示不限轮次直到达成共识（安全上限见 UNLIMITED_ROUNDS_HARD_CAP）；工单 04 达成共识可提前结束 */
  maxRounds?: number;
  /** 无限制轮次（maxRounds<=0）模式的安全上限，默认 99；仅测试可注入更小值 */
  unlimitedMaxRounds?: number;
  /** 每个 Agent 每轮允许调用的只读工具次数上限，默认 3；剩余 1 次时提前提醒及时收束 */
  maxToolCalls?: number;
  /** 兜底间隔（ms），默认 30000（距上一条发言超过该值且无人可选时强制开口） */
  idleTimeoutMs?: number;
  /** 冷却时长（ms），默认 20000 */
  cooldownMs?: number;
  /** 可注入时钟（测试用），默认 Date.now */
  now?: () => number;
  /** 可注入随机（测试用），默认 Math.random */
  random?: () => number;
  /** 话题相关性打分函数（默认关键词降级；工单 06 注入 Embedding 服务） */
  relevanceFn?: SpeakerSchedulerOptions["relevanceFn"];
  /** 向量上下文（工单 06）：注入 Embedding + 向量存储；缺省则不启用向量相关性 / 收敛。 */
  vector?: {
    embedding?: EmbeddingService;
    store?: VectorStore;
    /** 向量就绪等待上限（ms），默认 4000；超时自动降级为关键词，不阻塞讨论。 */
    readyTimeoutMs?: number;
  };
  /** 持久化存储（工单 07）：注入后会话记录 / 共识 / 最终方案按书落盘；缺省不持久化。 */
  chatStore?: ChatStore;
  /** 共识检测配置（工单 04：阈值 / 连续轮数 / 收敛判定可注入；工单 06 注入向量聚类）
   *  新增 useLLM=true 时启用纯 LLM 裁判（11-LLM共识），此时忽略阈值/权重，改由 LLM 全量窗口判定。
   */
  consensus?: ConsensusDetectorOptions & {
    useLLM?: boolean;
    llmJudge?: LLMConsensusDetectorOptions;
  };
  /** 上下文组装配置（工单 05：L1/L2 条数、token 预算等；测试注入小预算验证降级） */
  context?: ContextAssemblerOptions;
  willingness?: { enabled?: boolean; threshold?: number; maxTokens?: number; timeoutMs?: number };
  /** 统一调度 Agent（群聊导演，工单 11）：由导演基于发言记录与成员统计决定下一位发言者 */
  schedulerAgent?: SchedulerAgentOptions;
  onEvent?: (event: ChatSessionEvent) => void;
  /** 工单 12：从磁盘恢复「暂停在 ask 的会话」。注入历史消息 + 已用轮次，
   *  构造后状态置 running 并停在等待作者回答，回答经 submitAskAnswer 续跑。 */
  resume?: { history?: ChatMessageRecord[]; turnsUsed?: number };
}

/** 统一调度 Agent（群聊导演）选项：独立模型 / 温度 / 超时 / token；缺省回落讨论同款 LLM。 */
export interface SchedulerAgentOptions {
  enabled?: boolean;
  llm?: LLMClient;
  timeoutMs?: number;
  maxTokens?: number;
  temperature?: number;
  /** 导演系统提示词（来自导演角色卡片）；缺省使用内置默认提示词 */
  systemPrompt?: string;
}

export class ChatSessionError extends Error {}

export class ChatSession {
  readonly id: string;
  readonly projectId: string;
  readonly topic: string;
  readonly members: ChatMember[];
  readonly staticContext: Record<string, string>;
  readonly createdAt: string;

  private _llm: LLMClient;
  /** 按成员解析其专属 LLM client（工单 15：角色可指定模型）；缺省回落 _llm */
  private _clientResolver: (member: ChatMember) => LLMClient;
  private _maxRounds: number;
  private _unlimitedMaxRounds: number;
  private _maxToolCalls: number;
  private _idleTimeoutMs: number;
  private _backstopPollMs: number;
  private _status: ChatSessionStatus = "idle";
  private _messages: ChatMessageRecord[] = [];
  private _listeners = new Set<(event: ChatSessionEvent) => void>();
  private _abort: AbortController | null = null;
  private _completion: Promise<void> | null = null;
  private _updatedAt: string;
  private _nowFn: () => number;
  private _scheduler: SpeakerScheduler;
  private _detector: ConsensusDetector | LLMConsensusDetector;
  private _toolManager: ToolManager | null = null;
  /** ask_user 等待器（工单 12）：Agent 调用 ask_user 后等待作者拍板，作者经 /answer 提交回答后继续 */
  private _askResolver: AskResolver;
  /** 当前 ask 对应的提问成员（供事件标注 / /answer 落一条作者消息） */
  private _pendingAskMember: { id: string; name: string } | null = null;
  /** 当前正在发言的成员（ask_user 工具回调里据此标注提问者） */
  private _speakingMember: ChatMember | null = null;
  private _useLLMConsensus = false;
  /** 是否已推送过「接近共识」预警（防止重复） */
  private _consensusWarned = false;
  /** 作者历史指令（最近 5 条），进入 L3 全局要点（工单 05） */
  private _authorInstructions: string[] = [];
  /** 上下文组装器（工单 05：系统提示 + 静态设定 + L3/L2/L1 + 触发消息 + 任务） */
  private _assembler: ContextAssembler;
  /** 向量讨论上下文（工单 06：话题相关性 + 观点收敛；未注入时为 null，走纯降级） */
  private _vectorContext: VectorDiscussionContext | null;
  /** 向量就绪等待上限（ms），工单 06 */
  private _vectorReadyTimeoutMs: number;
  /** 持久化存储（工单 07）：缺省为 null 不落盘 */
  private _chatStore: ChatStore | null;
  /** 共识节点（工单 07）：成果单独落库，与过程记录分离 */
  private _consensusNodes: ChatConsensusNode[] = [];
  /** 最终方案（合成者总结），工单 07 进入快照 / 落库 */
  private _summary: string | undefined;
  private _schedulerAgentCfg: { enabled: boolean; timeoutMs: number; maxTokens: number; temperature: number };
  private _schedulerLlm: LLMClient;
  private _schedulerSystemPrompt: string;
  private _lastProbeTriggerId: string | null = null;
  /** 当前提案归属人（最近一位提案者类成员；作者驳回提案时据此定位应重新提案的成员） */
  private _currentProposerId: string | null = null;
  /** 作者刚驳回的提案归属人（未处于驳回态为 null） */
  private _rejectedProposerId: string | null = null;
  /** 该提案归属人被作者连续驳回的次数 */
  private _rejectedCount = 0;
  /** 驳回态是否已把话筒交还给被驳回者（避免同一驳回态内反复强拉） */
  private _rejectionSatisfied = false;
  /** 是否处于某位 Agent 的「本轮工具流事务」中（事务内不调度；事务提交后才进入调度点） */
  private _activeTurn = false;
  /** 作者在事务进行中发来的消息队列（含换方向信号）：事务提交后按序合并进驳回态，保证时序正确 */
  private _pendingAuthorSignals: string[] = [];
  /** 每位成员发言次数（供导演软约束平衡） */
  private _speakCounts = new Map<string, number>();
  /** 每位成员最近一次发言所在轮次（turns 计数，供导演计算 roundsSince） */
  private _lastSpeakTurn = new Map<string, number>();
  /** 评审者有效挑刺次数（用于限次，避免无限挑刺导致跑题） */
  private _reviewerCritiqueCounts = new Map<string, number>();
  /** 已消耗的发言轮次（从磁盘恢复时注入，续跑时计入轮次预算） */
  private _turnsUsed = 0;
  /** 恢复后停在等待作者回答：submitAskAnswer 写入回答后启动发言循环续跑 */
  private _awaitingAskResume = false;

  constructor(config: ChatSessionConfig) {
    this.id = config.id ?? randomUUID();
    this.projectId = config.projectId;
    this.topic = config.topic;
    this.members = config.members;
    this.staticContext = config.staticContext ?? {};
    this._llm = config.llm;
    this._clientResolver = config.clientResolver ?? (() => this._llm);
    this._maxRounds = config.maxRounds ?? 8;
    this._unlimitedMaxRounds = config.unlimitedMaxRounds ?? UNLIMITED_ROUNDS_HARD_CAP;
    this._maxToolCalls = config.maxToolCalls ?? 3;
    this._turnsUsed = config.resume?.turnsUsed ?? 0;
    this._awaitingAskResume = false;
    this._idleTimeoutMs = config.idleTimeoutMs ?? 30000;
    this._backstopPollMs = 1000;
    this._nowFn = config.now ?? (() => Date.now());
    this._vectorContext = config.vector
      ? new VectorDiscussionContext({
          embedding: config.vector.embedding,
          store: config.vector.store,
          random: config.random,
        })
      : null;
    this._vectorReadyTimeoutMs = config.vector?.readyTimeoutMs ?? 4000;
    this._chatStore = config.chatStore ?? null;
    this._scheduler = new SpeakerScheduler(config.members, {
      cooldownMs: config.cooldownMs,
      now: config.now,
      random: config.random,
      relevanceFn: this._vectorContext
        ? (member, recentText) => this._vectorContext!.relevance(member, recentText)
        : config.relevanceFn,
    });
    const useLLM = !!(config.consensus as any)?.useLLM;
    this._useLLMConsensus = useLLM;
    if (useLLM) {
      const { useLLM: _u, llmJudge, ...rest } = (config.consensus ?? {}) as any;
      this._detector = new LLMConsensusDetector(this._llm, this.topic, this.members, {
        requiredStreak: (rest as ConsensusDetectorOptions).requiredStreak,
        recentWindow: (rest as ConsensusDetectorOptions).recentWindow,
        ...(llmJudge ?? {}),
      });
    } else {
      const consensusOptions: ConsensusDetectorOptions = { ...config.consensus };
      if (!consensusOptions.convergenceFn && this._vectorContext) {
        consensusOptions.convergenceFn = (recent) => this._vectorContext!.convergence(recent);
      }
      this._detector = new ConsensusDetector(consensusOptions);
    }
    this._askResolver = new AskResolver((q: AskQuestion) => {
      const m = this._pendingAskMember;
      this._emit({
        type: "ask",
        data: { memberId: m?.id ?? "author", memberName: m?.name ?? "作者", question: q },
      });
      // 工单 12：持久化等待作者回答的 ask，进程重启后前端可恢复 ask 卡片继续作答
      if (this._chatStore) {
        this._chatStore.setPendingAsk(this.projectId, this.id, {
          memberId: m?.id ?? "author",
          memberName: m?.name ?? "作者",
          question: q.question,
          options: q.options,
          multiple: q.multiple,
          allow_custom: q.allow_custom,
          timestamp: new Date().toISOString(),
        });
      }
    });
    try {
      const tm = new ToolManager();
      for (const t of createChatReadTools({ projectId: this.projectId, projectStore: getProjectStore() })) tm.register(t);
      // 工单 12：ask_user 工具——Agent 需要作者拍板时向作者提问，回答前挂起本轮
      tm.register(
        new AskUserTool((question, options, multiple, allowCustom) => {
          const m = this._speakingMember;
          this._pendingAskMember = m ? { id: m.id, name: m.name } : null;
          return this._askResolver.ask(question, options, multiple, allowCustom);
        })
      );
      // 工具流事务：Agent 完成全部查询后调用 finish_turn 显式结束本轮（事务内不调度）
      tm.register(new FinishTurnTool());
      this._toolManager = tm;
    } catch { this._toolManager = null; }
    this._assembler = new ContextAssembler({
      sharedContextKeys: [],
      countTokens: this._llm.count_text_tokens.bind(this._llm),
      ...config.context,
    });
    this.createdAt = new Date().toISOString();
    this._updatedAt = this.createdAt;
    this._schedulerAgentCfg = {
      enabled: config.schedulerAgent?.enabled ?? false,
      timeoutMs: config.schedulerAgent?.timeoutMs ?? 60000,
      maxTokens: config.schedulerAgent?.maxTokens ?? 300,
      temperature: config.schedulerAgent?.temperature ?? 0.3,
    };
    this._schedulerLlm = config.schedulerAgent?.llm ?? this._llm;
    this._schedulerSystemPrompt = config.schedulerAgent?.systemPrompt ?? DIRECTOR_SYSTEM_PROMPT;
    // 工单 12：从磁盘恢复的会话——注入历史、重建调度状态，停在等待作者回答
    if (config.resume?.history && config.resume.history.length > 0) {
      this._restoreHistory(config.resume.history);
    }
    if (config.onEvent) this.subscribe(config.onEvent);
  }

  // ------------------------------------------------------------------
  // 公开操作（路由与前端经此 seam 调用）
  // ------------------------------------------------------------------

  /**
   * 开始讨论：idle → running，推送成员加入等系统事件，随后驱动发言循环。
   * 返回的 Promise 在会话结束（completed / terminated）时 resolve；异常在内部消化为 error 事件。
   * 注：当前产品流程改为「首条作者消息激活」，start() 保留供测试与兼容，路由不再调用。
   */
  start(): Promise<void> {
    if (this._status !== "idle") throw new ChatSessionError("会话已在运行或已结束");
    this._activate();
    this._completion = this._prepareAndDrive().finally(() => {
      this._updatedAt = new Date().toISOString();
    });
    return this._completion;
  }

  /** 激活会话：idle → running，推送成员加入等系统事件并落盘初始记录。 */
  private _activate(): void {
    this._status = "running";
    this._updatedAt = new Date().toISOString();
    this._abort = new AbortController();
    this._scheduler.start();

    this._emit({ type: "system", data: { message: "讨论开始", status: this._status } });
    this._emit({ type: "system", data: { message: `讨论主题：${this.topic}` } });
    for (const m of this.members) {
      this._emit({ type: "system", data: { message: `成员「${m.name}」已加入群聊`, memberId: m.id } });
    }

    // 工单 07：落盘初始记录（建文件），后续消息增量追加
    this._chatStore?.save(this.getSnapshot());
  }

  /**
   * 作者发言：实时插入（不阻塞当前 Agent 生成），计入讨论历史并推送。工单 03 增强 @ 与优先调度。
   * idle 会话（创建后未开始）收到首条作者消息时激活：idle → running 并启动发言循环，
   * 使「标题只作会话名」——真正的讨论从作者发出第一条消息开始。
   */
  async sendUserMessage(content: string): Promise<ChatMessageRecord> {
    const text = String(content ?? "").trim();
    if (!text) throw new ChatSessionError("消息不能为空");
    if (this._status === "terminated" || this._status === "completed") {
      throw new ChatSessionError("会话已结束，无法发送消息");
    }
    const activating = this._status === "idle";
    if (activating) this._activate();
    const record: ChatMessageRecord = {
      id: randomUUID(),
      sessionId: this.id,
      memberId: "author",
      memberName: "作者",
      kind: "author",
      content: text,
      timestamp: new Date().toISOString(),
    };
    this._messages.push(record);
    this._updatedAt = new Date().toISOString();
    this._chatStore?.appendMessage(this.projectId, this.id, record);
    this._scheduler.trackMessage(record.content);
    // 作者驳回信号处理：命中「换方向/不行」等时记录被驳回提案归属人，供导演交还话筒
    this._handleAuthorMessage(text);
    // 工单 06：作者发言进入向量上下文（供后续话题相关性 / 收敛聚类），失败静默
    if (this._vectorContext) {
      await this._vectorContext.trackText(record.id, record.content);
    }
    // 工单 05：作者历史指令进入 L3 全局要点（保留最近 5 条）
    this._authorInstructions.push(text);
    if (this._authorInstructions.length > 5) this._authorInstructions.shift();
    // 工单 03：解析 @角色名 定向召唤，被 @ 者获得强意愿加成
    const mentionedIds = this._resolveMentions(text);
    for (const id of mentionedIds) {
      this._scheduler.mention(id);
    }
    this._emit({ type: "chat_message", data: record });
    // 首条消息激活：作者消息已入历史，随后后台驱动发言循环（fire-and-forget，同 start()）
    if (activating) {
      this._completion = this._prepareAndDrive().finally(() => {
        this._updatedAt = new Date().toISOString();
      });
    }
    return record;
  }

  /** 解析消息中的 @角色名，返回命中的 Agent 成员 id（定向召唤）。 */
  private _resolveMentions(text: string): string[] {
    const ids = new Set<string>();
    for (const member of this.members) {
      if (member.kind !== "agent") continue;
      if (text.includes("@" + member.name)) ids.add(member.id);
    }
    return [...ids];
  }

  /** 判断作者消息是否为「驳回提案 / 换方向」信号（启发式正则）。 */
  private _isRejectionSignal(text: string): boolean {
    return AUTHOR_REJECTION_PATTERNS.some((re) => re.test(text));
  }

  /**
   * 把一条作者消息合并进「驳回 / 换方向」状态（旧逻辑本体，供事务外与队列排空时复用）。
   * 命中驳回信号时记录「被驳回的提案归属人」及其连续驳回次数；非驳回消息则清空驳回态。
   */
  private _applyAuthorSignal(text: string): void {
    if (this._isRejectionSignal(text) && this._currentProposerId) {
      this._rejectedProposerId = this._currentProposerId;
      this._rejectedCount += 1;
      this._rejectionSatisfied = false;
    } else {
      this._rejectedProposerId = null;
      this._rejectedCount = 0;
      this._rejectionSatisfied = false;
    }
  }

  /**
   * 处理一条新到达的作者消息（sendUserMessage 入口）。
   * 若正处于某位 Agent 的工具流事务中（_activeTurn=true）：先把消息（含换方向）排入队列，
   * 仅发 system 提示告知「已收到，将在当前发言者完成本轮后处理」，绝不在此刻改写驳回态，
   * 从而保证事务内不因作者消息而触发调度、也不打断当前 Agent 的完整工具流；
   * 事务提交后由 _drainPendingSignals() 按到达顺序合并进驳回态。
   * 事务外则立即合并（作者消息到达时恰好没有 Agent 在发言）。
   */
  private _handleAuthorMessage(text: string): void {
    if (this._activeTurn) {
      this._pendingAuthorSignals.push(text);
      this._emit({
        type: "system",
        data: { message: "已收到，将在当前发言者完成本轮后按你的指令处理" },
      });
      return;
    }
    this._applyAuthorSignal(text);
  }

  /** 事务提交后的调度点：按到达顺序排空作者在事务中留下的消息，合并进驳回态。 */
  private _drainPendingSignals(): void {
    if (this._pendingAuthorSignals.length === 0) return;
    const pending = this._pendingAuthorSignals.splice(0);
    for (const text of pending) {
      this._applyAuthorSignal(text);
    }
  }

  /** 手动终止：running → terminated，推送系统事件；不产出伪总结。 */
  stop(): void {
    if (this._status === "terminated" || this._status === "completed") {
      throw new ChatSessionError("会话已经结束");
    }
    if (this._status === "idle") {
      this._status = "terminated";
      return;
    }
    this._status = "terminated";
    this._updatedAt = new Date().toISOString();
    this._abort?.abort();
    this._activeTurn = false;
    // 工单 12：终止时释放挂起的 ask，避免 agent 无限等待作者回答
    this._askResolver.abort();
    this._pendingAskMember = null;
    this._chatStore?.setPendingAsk(this.projectId, this.id, null);
    this._chatStore?.setStatus(this.projectId, this.id, "terminated");
    this._chatStore?.save(this.getSnapshot());
    this._emit({ type: "system", data: { message: "讨论已被作者终止", status: this._status } });
  }

  /**
   * 销毁会话（删除场景）：中止调度并停止一切落盘。
   * 将 _chatStore 置空后，异步收尾里的 save / appendMessage 全部变为 no-op，
   * 避免被删除的会话在磁盘上“复活”。会话从此不可再用。
   */
  dispose(): void {
    // 工单 12：先清除持久化的 pending ask（此后 _chatStore 置空不再落盘）
    this._chatStore?.setPendingAsk(this.projectId, this.id, null);
    this._chatStore = null;
    this._abort?.abort();
    this._askResolver.abort();
    this._pendingAskMember = null;
    this._activeTurn = false;
  }

  // ------------------------------------------------------------------
  // 查询（供路由 / 前端 / 测试断言）
  // ------------------------------------------------------------------

  getStatus(): ChatSessionStatus {
    return this._status;
  }

  getMessages(): ChatMessageRecord[] {
    return [...this._messages];
  }

  getSnapshot() {
    return {
      id: this.id,
      projectId: this.projectId,
      topic: this.topic,
      members: this.members,
      messages: this.getMessages(),
      status: this._status,
      createdAt: this.createdAt,
      updatedAt: this._updatedAt,
      summary: this._summary,
      consensusNodes: [...this._consensusNodes],
    };
  }

  subscribe(listener: (event: ChatSessionEvent) => void): () => void {
    this._listeners.add(listener);
    return () => {
      this._listeners.delete(listener);
    };
  }

  /** 查看当前等待作者回答的提问（断连恢复用）；无则返回 null。 */
  peekPendingAsk(): { question: AskQuestion; memberId: string; memberName: string } | null {
    const q = this._askResolver.peek();
    if (!q) return null;
    const m = this._pendingAskMember;
    return { question: q, memberId: m?.id ?? "author", memberName: m?.name ?? "作者" };
  }

  get hasPendingAsk(): boolean {
    return this._askResolver.hasPending;
  }

  /**
   * 工单 12：提交作者对 ask_user 的回答。
   * 唤醒等待中的 Agent 本轮继续，并把回答作为作者消息写入讨论历史（对全员可见 + 进入上下文），
   * 前端无需额外渲染——回答会以 chat_message 事件到达。
   */
  async submitAskAnswer(answer: string): Promise<boolean> {
    const text = String(answer ?? "").trim();
    if (!text) return false;
    if (this._status === "terminated" || this._status === "completed") return false;
    // 工单 12：恢复后路径——会话从磁盘恢复并停在 ask（_askResolver 无 pending），
    // 回答直接写入历史并启动发言循环，继续未完成的讨论
    if (this._awaitingAskResume) {
      this._awaitingAskResume = false;
      await this._writeAuthorAnswer(text);
      this._chatStore?.setPendingAsk(this.projectId, this.id, null);
      this._completion = this._prepareAndDrive().finally(() => {
        this._updatedAt = new Date().toISOString();
      });
      return true;
    }
    if (!this._askResolver.submitAnswer(text)) return false;
    await this._writeAuthorAnswer(text);
    this._chatStore?.setPendingAsk(this.projectId, this.id, null);
    return true;
  }

  /** 工单 12：把作者的 ask 回答写入讨论历史（全员可见 + 进入上下文），供两条提交路径复用。 */
  private async _writeAuthorAnswer(text: string): Promise<void> {
    const record: ChatMessageRecord = {
      id: randomUUID(),
      sessionId: this.id,
      memberId: "author",
      memberName: "作者",
      kind: "author",
      content: text,
      timestamp: new Date().toISOString(),
    };
    this._pendingAskMember = null;
    this._messages.push(record);
    this._updatedAt = new Date().toISOString();
    this._chatStore?.appendMessage(this.projectId, this.id, record);
    this._scheduler.trackMessage(record.content);
    // ask 回答是作者对当前 Agent 的即时拍板：已通过 resolver 直接送达当前事务（Agent 会据此调整），
    // 因此立即合并进驳回态（若回答恰是「换方向」等信号），而不走「事务中排队」路径。
    this._applyAuthorSignal(text);
    if (this._vectorContext) {
      await this._vectorContext.trackText(record.id, record.content);
    }
    this._authorInstructions.push(text);
    if (this._authorInstructions.length > 5) this._authorInstructions.shift();
    this._emit({ type: "chat_message", data: record });
  }

  /** 工单 12：从磁盘恢复——注入历史消息、重建调度 / 统计状态，状态置 running 并停在等待作者回答。 */
  private _restoreHistory(history: ChatMessageRecord[]): void {
    this._messages.push(...history);
    this._status = "running";
    this._updatedAt = new Date().toISOString();
    this._abort = new AbortController();
    this._scheduler.start();
    this._awaitingAskResume = true;
    for (const m of history) {
      if (m.kind === "agent") {
        this._scheduler.trackMessage(m.content);
      } else if (m.kind === "author") {
        this._authorInstructions.push(m.content);
        if (this._authorInstructions.length > 5) this._authorInstructions.shift();
        for (const id of this._resolveMentions(m.content)) this._scheduler.mention(id);
      }
    }
    // 重建发言次数 / 最近发言轮次（导演软约束平衡用；轮次用恢复基数 + 出现序号近似）
    let idx = 0;
    for (const m of history) {
      if (m.kind === "agent") {
        this._speakCounts.set(m.memberId, (this._speakCounts.get(m.memberId) ?? 0) + 1);
        this._lastSpeakTurn.set(m.memberId, this._turnsUsed + idx);
        idx += 1;
      }
    }
  }

  // ------------------------------------------------------------------
  // 内部
  // ------------------------------------------------------------------

  private _emit(event: ChatSessionEvent): void {
    for (const listener of [...this._listeners]) {
      try {
        listener(event);
      } catch {
        /* 单个监听器异常不影响其余监听器 */
      }
    }
  }

  private _now(): number {
    return this._nowFn();
  }

  /**
   * 工单 06：向量上下文预热（有界等待）。Embedding 模型 / Qdrant 未就绪时
   * 在 readyTimeoutMs 内重试等待，超时则降级为关键词 + 随机，绝不阻塞讨论。
   */
  private async _prepareAndDrive(): Promise<void> {
    if (this._vectorContext) {
      await this._withTimeout(
        this._vectorContext.ensureReady(this.members, this.staticContext),
        this._vectorReadyTimeoutMs
      );
    }
    await this._drive();
  }

  /** 有界等待：promise 与超时二者先到者返回；两侧都清理定时器，避免悬挂句柄。 */
  private _withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
    return new Promise<T | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), ms);
      promise.then(
        (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        () => {
          clearTimeout(timer);
          resolve(null);
        }
      );
    });
  }

  /**
   * 发言循环（工单 02 意愿度调度）：
   * - 每次迭代由 SpeakerScheduler 选出当前意愿度最高的未冷却成员发言；
   * - 若全部处于冷却（无人可选）则进入兜底等待：冷却到期自动恢复自然轮转，
   *   超过 idleTimeoutMs 仍无人可选时强制最高分者开口（防冷场）；
   * - 达到发言预算 maxRounds 或状态不再 running 时结束。
   */
  private async _drive(): Promise<void> {
    try {
      // 工单 12：从磁盘恢复的会话从已用轮次继续，避免续跑后超出轮次预算
      let turns = this._turnsUsed;
      const roundsCap = this._maxRounds > 0 ? this._maxRounds : this._unlimitedMaxRounds;
      while (this._status === "running" && turns < roundsCap) {
        let speaker: ChatMember | null = null;
        if (this._schedulerAgentCfg.enabled && this._messages.length > 0) {
          speaker = await this._pickBySchedulerAgent(turns);
        }
        if (!speaker) {
          speaker = this._scheduler.pickNext(this._now());
          if (!speaker) {
            speaker = await this._waitForIdleBackstop();
            if (!speaker) continue;
          }
        }
        await this._runAgentTurn(speaker, turns, roundsCap);
        // 事务提交后的调度点：合并作者在事务中留下的消息（含换方向），再进入下一位发言者的调度
        this._drainPendingSignals();
        this._scheduler.recordTurn(speaker.id);
        // 工单 11：统计发言次数与最近发言轮次，供导演软约束平衡
        this._speakCounts.set(speaker.id, (this._speakCounts.get(speaker.id) ?? 0) + 1);
        this._lastSpeakTurn.set(speaker.id, turns);
        // 防跑题：评审者限次（最多 3 次有效挑刺），超过后不再为主角挑刺，避免无限展开
        if (speaker.category === "reviewer") {
          this._reviewerCritiqueCounts.set(speaker.id, (this._reviewerCritiqueCounts.get(speaker.id) ?? 0) + 1);
        }
        turns += 1;
        // 工单 04：连续多轮超阈值 → 由合成者产出结构化总结并结束
        if (this._detector.shouldSynthesize) {
          const synthesized = await this._runSynthesisIfPossible();
          if (synthesized) break;
        }
      }
      // 无限制轮次（maxRounds<=0）安全上限保护：即使共识裁判一直未判定达成一致，
      // 也强制由合成者收束，避免无限循环；无合成者时回落下方常规完成逻辑。
      if (this._status === "running" && this._maxRounds <= 0 && turns >= this._unlimitedMaxRounds) {
        this._emit({
          type: "system",
          data: { message: "已到达无限制讨论的安全上限，强制进入最终合成收束" },
        });
        await this._runSynthesisIfPossible();
      }
      if (this._status === "running") {
        this._status = "completed";
        this._updatedAt = new Date().toISOString();
        this._chatStore?.setPendingAsk(this.projectId, this.id, null);
        this._chatStore?.setStatus(this.projectId, this.id, "completed");
        this._chatStore?.save(this.getSnapshot());
        this._emit({ type: "done", data: { status: "completed" } });
      }
    } catch (err) {
      // 异常统一收敛为 error 事件；状态进入 terminated（对应设计文档「作者手动终止 / 异常」）
      this._status = "terminated";
      this._activeTurn = false;
      this._updatedAt = new Date().toISOString();
      this._chatStore?.setPendingAsk(this.projectId, this.id, null);
      this._chatStore?.setStatus(this.projectId, this.id, "terminated");
      this._chatStore?.save(this.getSnapshot());
      const message = err instanceof Error ? err.message : String(err);
      // 手动终止触发的中止（abort）不算运行错误，不推送 error 事件
      if (!/abort|终止/i.test(message)) {
        this._emit({ type: "error", data: { error: message } });
      }
    }
  }

  /**
   * 兜底等待：全部成员冷却中时调用。以 idleTimeoutMs 为上限，期间：
   * - 每隔 backstopPollMs 检查一次，冷却到期即有成员自然恢复 → 立即返回该成员；
   * - 超过 idleTimeoutMs 仍无人可选 → 无视冷却强制最高分者（防冷场）；
   * - 会话被终止 → 返回 null。
   */
  private async _waitForIdleBackstop(): Promise<ChatMember | null> {
    const signal = this._abort?.signal;
    if (signal?.aborted) return null;
    return new Promise<ChatMember | null>((resolve) => {
      let forceTimer: NodeJS.Timeout;
      let pollTimer: NodeJS.Timeout;
      const finish = (member: ChatMember | null): void => {
        clearTimeout(forceTimer);
        clearInterval(pollTimer);
        signal?.removeEventListener("abort", onAbort);
        resolve(member);
      };
      const onAbort = (): void => finish(null);
      forceTimer = setTimeout(() => {
        finish(this._status === "running" ? this._scheduler.forceHighest(this._now()) : null);
      }, this._idleTimeoutMs);
      pollTimer = setInterval(() => {
        if (this._status !== "running") {
          finish(null);
          return;
        }
        const speaker = this._scheduler.pickNext(this._now());
        if (speaker) finish(speaker);
      }, this._backstopPollMs);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  /**
   * 工单 11：统一调度 Agent（群聊导演）决定下一位发言者。
   * - 被@强优先：存在活跃 @ 时直接归被 @ 者，不经导演；
   * - 软约束：导演看到每位成员发言次数 / 距上次发言轮数，由提示词平衡，不硬性拦截冷却；
   * - 导演解析失败 / 超时 → 返回 null，由 _drive 回退规则调度（pickNext），再失败走兜底等待。
   */
  private async _pickBySchedulerAgent(turns: number): Promise<ChatMember | null> {
    // 工具流事务守卫：当前 Agent 仍在发言流程中时绝不调度下一位，事务提交后（_activeTurn=false）才允许进入调度点
    if (this._activeTurn) return null;
    if (this._scheduler.hasMention()) {
      return this._scheduler.pickNext();
    }
    const trigger = this._messages[this._messages.length - 1];
    if (!trigger) return null;
    if (this._lastProbeTriggerId === trigger.id) return null;
    this._lastProbeTriggerId = trigger.id;
    if (this._status !== "running") return null;
    const signal = this._abort?.signal;
    if (signal?.aborted) return null;
    const agents = this.members.filter((m) => m.kind === "agent");
    if (agents.length === 0) return null;
    const memberInfo: SchedulerMemberInfo[] = agents.map((member) => {
      const speakCount = this._speakCounts.get(member.id) ?? 0;
      const lastTurn = this._lastSpeakTurn.get(member.id);
      return {
        member,
        speakCount,
        roundsSince: lastTurn === undefined ? -1 : Math.max(0, turns - lastTurn),
      };
    });
    const recentCount = 6;
    const historyMsgs = this._messages.slice(0, -recentCount);
    const historySummary = historyMsgs.length > 0 ? historyMsgs.map((m) => m.memberName + ": " + compact(m.content, 80)).join("\n") : "";
    const recentMessages = this._messages.slice(-recentCount);
    const input: SchedulerAgentInput = {
      topic: this.topic,
      memberInfo,
      historySummary,
      recentMessages,
      triggerMessage: trigger,
      rejectedProposerId: this._rejectedProposerId,
      rejectedProposerCount: this._rejectedCount,
      maxRounds: this._maxRounds,
      turnsUsed: turns,
    };
    const result = await probeSchedulerDecision(this._schedulerLlm, input, {
      timeoutMs: this._schedulerAgentCfg.timeoutMs,
      maxTokens: this._schedulerAgentCfg.maxTokens,
      temperature: this._schedulerAgentCfg.temperature,
      systemPrompt: this._schedulerSystemPrompt,
      signal: signal ?? undefined,
    });
    const decision = result.decision;
    // 防跑题硬约束：评审者限次 + 剩余轮次收束优先合成者
    let filteredRanking = decision?.ranking ?? [];
    // 评审者已达 3 次挑刺后降权：从候选里移除超限的 reviewer（除非只剩 reviewer）
    const reviewerOverLimit = new Set(
      [...this._reviewerCritiqueCounts.entries()].filter(([, c]) => c >= 3).map(([id]) => id)
    );
    if (reviewerOverLimit.size > 0) {
      const withoutOver = filteredRanking.filter((r) => !reviewerOverLimit.has(r.memberId));
      if (withoutOver.length > 0) filteredRanking = withoutOver;
    }
    // 剩余轮次<=2 时强制合成者收束
    const roundsCap = this._maxRounds > 0 ? this._maxRounds : this._unlimitedMaxRounds;
    const remaining = roundsCap - turns;
    if (remaining <= 2) {
      const synth = this.members.find((m) => m.category === "synthesizer");
      if (synth) {
        const hasSynthInRanking = filteredRanking.some((r) => r.memberId === synth.id);
        if (!hasSynthInRanking) {
          filteredRanking = [{ memberId: synth.id, priority: 1, reason: "剩余轮次不足，强制收束" }, ...filteredRanking];
        } else {
          // 把合成者提到首位
          filteredRanking = [
            filteredRanking.find((r) => r.memberId === synth.id)!,
            ...filteredRanking.filter((r) => r.memberId !== synth.id),
          ];
        }
      }
    }
    // 作者驳回兜底：作者刚否定提案并要求换方向 → 把被驳回的提案者强制拉回重新提案
    // （软约束在导演提示词里，此处为硬规则：导演没选他时兜底，且同一驳回态只强拉一次。
    //  放在合成者强制收束之后，保证作者明确信号优先级最高，避免轮次将尽时被收束规则覆盖。）
    let rejectionForced = false;
    if (this._rejectedProposerId && !this._rejectionSatisfied && this._rejectedCount <= REJECTED_PROPOSER_RETURN_LIMIT) {
      const rp = this.members.find((m) => m.id === this._rejectedProposerId && m.kind === "agent");
      if (rp) {
        const hasInRanking = filteredRanking.some((r) => r.memberId === rp.id);
        if (!hasInRanking) {
          filteredRanking = [
            { memberId: rp.id, priority: 1, reason: "作者刚驳回提案，强制回到「" + rp.name + "」重新给出方向" },
            ...filteredRanking,
          ];
        } else {
          filteredRanking = [
            filteredRanking.find((r) => r.memberId === rp.id)!,
            ...filteredRanking.filter((r) => r.memberId !== rp.id),
          ];
        }
        rejectionForced = true;
      }
    }
    const effectiveDecision = decision ? { ...decision, ranking: filteredRanking } : null;
    const chosen = effectiveDecision?.ranking?.[0];
    const fallback = !effectiveDecision || !chosen;
    // 话筒实际交还给被驳回提案者 → 本驳回态已处理，避免同一驳回态内反复强拉
    if (chosen && this._rejectedProposerId && chosen.memberId === this._rejectedProposerId) {
      this._rejectionSatisfied = true;
    }
    this._emit({
      type: "scheduler_probe",
      data: {
        round: turns,
        ranking: effectiveDecision?.ranking ?? [],
        note: effectiveDecision?.note,
        chosenId: chosen?.memberId ?? null,
        fallback,
        parseOk: result.parseOk,
        raw: result.raw.slice(0, 2000),
        rejectedProposerId: this._rejectedProposerId,
        rejectionForced,
      },
    });
    if (!chosen) return null;
    return this.members.find((m) => m.id === chosen.memberId) ?? null;
  }

  /**
   * ask_user 兜底（正文提问检测）：Agent 未走 ask_user 工具、却在发言正文里以问句/请求句
   * 面向作者提问或请求拍板时，从正文提取问题并包装成 ask 卡片。命中返回提问与候选选项。
   */
  private _extractAskToAuthor(text: string) {
    const t = (text ?? "").trim();
    if (!t) return null;
    const pats: Array<RegExp> = [
      /请作者|作者请|问作者|让作者|等作者|待作者|由作者|向作者/,
      /需要你(?:来)?(?:拍板|决定|确认|选择|定夺|敲定|答复|回复|拿主意|给个方向)/,
      /请你(?:来)?(?:拍板|决定|确认|选择|定夺|敲定|答复|回复|拿主意|给个方向)/,
      /你来(?:拍板|决定|确认|选择|定夺|敲定|拿主意|定)/,
      /由你(?:拍板|决定|确认|选择|定夺|敲定)/,
      /你(?:更)?倾向(?:于)?/,
      /你(?:觉得|认为|希望|打算|意下如何|怎么看|说了算|来定|拿主意)/,
      /请(?:你)?(?:确认|选择|决定|拍板)(?:一下)?/,
      /是否(?:接受|同意|采用|可以|认可|可行)/,
    ];
    if (!pats.some((re) => re.test(t))) return null;
    // 提取问题：取最后一个含问号或作者信号的分句，否则取整段尾部
    let question = "";
    const chunks: Array<string> = [];
    let seg = "";
    for (const ch of t) {
      if ("。！？!?；;".includes(ch)) {
        chunks.push(seg + ch);
        seg = "";
      } else {
        seg += ch;
      }
    }
    if (seg.trim()) chunks.push(seg);
    for (let i = chunks.length - 1; i >= 0; i--) {
      const s = (chunks[i] ?? "").trim();
      if (!s) continue;
      if (s.includes("？") || s.includes("?") || pats.some((re) => re.test(s))) {
        question = s;
        break;
      }
    }
    if (!question) question = t.slice(-200);
    // 拆出 A/B/C 候选选项
    const options: Array<string> = [];
    for (const L of "ABCDEF") {
      for (const sep of [".", "、", "．", "。"]) {
        const idx = question.indexOf(L + sep);
        if (idx >= 0) {
          // 跳过分隔符后的空格（LLM 常见 "A. 选项" 写法），再截取到标点/空格
          let start = idx + 2;
          while (start < question.length && " ".includes(question[start])) start++;
          let end = start;
          while (end < question.length && !"，,。；;？?!！ ".includes(question[end])) end++;
          const v = question.slice(start, end).trim();
          if (v && v.length <= 40) options.push(L + ". " + v);
          break;
        }
      }
    }
    return { question: question.length > 120 ? question.slice(-120) : question, options: options.slice(0, 6) };
  }

  /** 让某位 Agent 发言：发言权分配 → 思考/工具（折叠）→ 最终结论（独立气泡）。上下文仅含最终结论。 */
  private async _runAgentTurn(member: ChatMember, turnsUsed?: number, turnsCap?: number): Promise<void> {
    // 进入「本轮工具流事务」：事务内不调度其他人发言；只有事务提交（finish_turn / 散文收尾 / 兜底）后才进入调度点
    this._activeTurn = true;
    this._speakingMember = member;
    // 工单 15：角色可指定专属模型；未指定时回落会话默认 client
    const memberClient = this._clientResolver(member);
    // 提案者发言即成为「当前提案归属人」（作者驳回提案时据此把话筒交还该提案者）
    if (member.category === "proposer") {
      this._currentProposerId = member.id;
    }
    const score = this._scheduler.computeScores(this._now()).find((s) => s.member.id === member.id) ?? {
      total: 0, breakdown: { mention: 0, wait: 0, relevance: 0, trait: 0, cooldown: 0, random: 0 } as WillingnessBreakdown, reason: "",
    };
    this._emit({ type: "speaker", data: { memberId: member.id, memberName: member.name, scores: { ...score.breakdown, total: score.total }, reason: score.reason } });
    this._emit({ type: "agent_status", data: { memberId: member.id, status: "thinking" } });
    const triggerMessage = this._messages.length > 0 ? this._messages[this._messages.length - 1] : undefined;
    // 话题锚点：所有成员必须围绕锚点发言，超出视为跑题
    const topicAnchor = `本次讨论锚点：「${this.topic}」。请严格围绕该锚点发言，超出锚点的新维度（如题材会上引入系统数值/人物身世等）视为跑题，应主动收敛。`;
    let taskPrompt = this._useLLMConsensus
      ? topicAnchor + "\n\n请作为「" + member.name + "」发言，承接最近的讨论并发表你的观点。如需背景，可调用只读工具 read_worldview/read_characters/read_outline/read_core_elements/read_memory 按需查询（最多" + this._maxToolCalls + "次），再给出最终结论。若遇到需要作者拍板的决策（题材、平台、方向、设定取舍等），可调用 ask_user 工具向作者提问并等待其选择。\n\n请严格按你角色设定中的输出格式组织发言；若你要质疑或反对某人的提案，请直接点名并给出具体理由，不要空泛表态。"
      : topicAnchor + "\n\n请作为「" + member.name + "」发言，承接最近的讨论并发表你的观点。若遇到需要作者拍板的决策（题材、方向、设定取舍等），可调用 ask_user 工具向作者提问并等待其选择。\n\n发言要求：请在结尾单独一行输出你的共识自评，格式：【共识度：0~1】。0 表示完全不认同，1 表示完全达成一致。";
    // 工单 13：向作者提问的强制规则——需要作者拍板必须调用 ask_user，禁止在正文里以问句直接提问
    taskPrompt += "【向作者提问的强制规则】若遇到需要作者拍板/确认的决策（题材、平台、方向、设定取舍、是否采用某方案等），";
    taskPrompt += "你必须调用 ask_user 工具提问：把问题写入 ask_user 的 question 字段并给出 2-6 个候选选项，等待作者回答后再继续；";
    taskPrompt += "选项应覆盖主要可行方向并互相排他；即使候选不够，系统也会自动补足默认选项并在末尾追加“自定义回答”入口，作者不会看到裸输入框；";
    taskPrompt += "严禁在发言正文中以问句/请求句向作者提问或请求拍板（例如“你来定”“你怎么看”“请确认”等）。";
    taskPrompt += "若需向作者说明进展，可在调用 ask_user 前用一两句正文说明（如“我正就题材方向向作者确认”），真正的提问只能通过 ask_user 工具发出。";
    // 工具流事务：一次发言是原子过程，只有调用 finish_turn 才结束本轮（事务内不调度其他人发言）
    if (this._toolManager && this._toolManager.listNames().length > 0) {
      taskPrompt += "【本轮流程（重要）】你的一次发言是一个完整过程：可以在本过程内多次调用工具查询背景或向作者提问（ask_user），查看结果、继续查询与思考；";
      taskPrompt += "当你完成全部工具查询并形成最终结论时，必须调用 finish_turn 工具，把最终结论完整写入 finish_turn 的 conclusion 字段以结束本轮——系统会把它作为你的最终发言展示并进入讨论历史；";
      taskPrompt += "在你调用 finish_turn 之前，本轮不会结束，也不会安排其他人发言，请放心充分查询与思考，不要在中间过程里输出最终结论；";
      taskPrompt += "若你直接输出正文散文而没有调用 finish_turn，系统会把你最后输出的正文视为本轮最终结论。";
    }
    // 范围围栏：评审者本场聚焦锚点维度，超出视为跑题
    if (member.category === "reviewer") {
      const critCount = this._reviewerCritiqueCounts.get(member.id) ?? 0;
      taskPrompt += `\n\n你是评审者，职责是挑刺但必须落在本次锚点维度内，超出锚点的新维度视为跑题应降权。已挑刺 ${critCount} 次，本场最多 3 次有效挑刺，超过后请转为“通过/有条件通过”并给出收敛建议。`;
    }
    // 轮次用尽前提醒：最后 1-2 轮强制收敛，避免被硬截断
    if (typeof turnsUsed === "number" && typeof turnsCap === "number") {
      const isUnlimited = this._maxRounds <= 0;
      const cap = isUnlimited ? this._unlimitedMaxRounds : turnsCap;
      const remaining = cap - turnsUsed;
      const needWarn = isUnlimited ? remaining <= 5 : (cap <= 3 ? remaining <= 1 : remaining <= 2);
      if (remaining <= 2 && turnsUsed >= 0) {
        const hint = isUnlimited
          ? `注意：讨论已进行 ${turnsUsed}/${cap} 轮，即将达到安全上限。请不要再开新议题，基于已有结论给出明确立场和可执行建议，下一个发言后将由合成者整理最终方案。`
          : `注意：讨论已进行 ${turnsUsed}/${cap} 轮，剩余 ${remaining} 轮后将收束。请不要再开新议题，基于已有结论给出明确立场和可执行建议，下一个发言后将由合成者整理最终方案。`;
        taskPrompt += "\n\n" + hint;
        if (needWarn) {
          this._emit({ type: "system", data: { message: hint } });
        }
      }
    }
    const assembled = this._assembler.assemble({
      member, topic: this.topic, messages: this._messages, staticContext: this.staticContext,
      triggerMessage, authorInstructions: this._authorInstructions, taskPrompt,
    });
    const baseMessages: ChatMessage[] = [
      new ChatMessage(Role.SYSTEM, assembled.systemPrompt, undefined, member.name),
      new ChatMessage(Role.USER, assembled.userPrompt),
    ];
    const messageId = randomUUID();
    let finalContent = "";
    if (this._toolManager && this._toolManager.listNames().length > 0) {
      let conversation: ChatMessage[] = [...baseMessages];
      // +1 次「收敛机会」：工具配额用尽后仍给 Agent 一次调用 finish_turn / 输出散文收尾的机会，避免硬截断
      for (let iter = 0; iter <= this._maxToolCalls; iter++) {
        if (this._status !== "running") {
          this._activeTurn = false;
          return;
        }
        // 生成阶段开始：先上报 generating（含 achat 挂起期间），确保前端不会停留在 thinking
        this._emit({ type: "agent_status", data: { memberId: member.id, status: "generating" } });
        const functions = this._toolManager.toOpenaiFunctions();
        let resp: any;
        try { resp = await memberClient.achat(conversation, { functions, function_call: "auto", temperature: 0.7 }, this._abort?.signal); } catch { break; }
        const rawFc = (resp as any).raw?.choices?.[0]?.message?.function_call || (resp as any).function_call;
        let fcName: string | null = null; let fcArgs: Record<string, unknown> = {};
        if (rawFc && rawFc.name) { fcName = rawFc.name; try { fcArgs = rawFc.arguments ? JSON.parse(typeof rawFc.arguments === "string" ? rawFc.arguments : JSON.stringify(rawFc.arguments)) : {}; } catch { fcArgs = {}; } }
        if (!fcName) {
          const prose = resp.content || "";
          // 散文内显式结束哨兵【本轮结束】：哨兵前内容视为本轮最终结论（模型未走 finish_turn 信封的兜底）
          const sentinelIdx = prose.indexOf("【本轮结束】");
          if (sentinelIdx >= 0) {
            const conclusion = prose.slice(0, sentinelIdx).trim();
            this._emit({ type: "agent_status", data: { memberId: member.id, status: "generating" } });
            let accS = ""; let lastS = 0;
            const emitS = (done: boolean): void => { const now = Date.now(); if (!done && now - lastS < 30) return; lastS = now; this._emit({ type: "delta", data: { messageId, memberId: member.id, memberName: member.name, content: done ? conclusion : accS, done } }); };
            for (const ch of conclusion) { accS += ch; emitS(false); }
            emitS(true);
            finalContent = conclusion;
            break;
          }
          // 散文形式的工具请求（模型未走 function_call 信封）→ 作为折叠的过程气泡展示；finish_turn 不按此路径执行
          const foundTools = this._toolManager.listNames().filter((n) => n !== "finish_turn" && prose.includes(n));
          if (foundTools.length > 0) {
            // 散文形式的工具请求（模型未走 function_call 信封）→ 作为折叠的过程气泡展示
            if (prose.trim()) this._emit({ type: "thinking", data: { messageId, memberId: member.id, memberName: member.name, content: prose.slice(0, 800) } });
            for (const tool of foundTools) {
              this._emit({ type: "tool_call", data: { messageId, memberId: member.id, memberName: member.name, tool, args: {} } });
              let toolResult: any;
              try { toolResult = await this._toolManager.execute(tool, {}); } catch (e) { toolResult = { success: false, output: String(e) }; }
              const resultText = toolResult.success ? toolResult.output : "错误: " + toolResult.error;
              if (typeof resultText === "string" && resultText.includes(ASK_ABORTED_SENTINEL)) {
                this._emit({ type: "agent_status", data: { memberId: member.id, status: "idle" } });
                this._pendingAskMember = null;
                this._activeTurn = false;
                this._speakingMember = null;
                return;
              }
              this._emit({ type: "tool_result", data: { messageId, memberId: member.id, memberName: member.name, tool, content: resultText.slice(0, 4000), success: toolResult.success } });
              conversation.push(new ChatMessage(Role.ASSISTANT, prose, null, member.name));
              conversation.push(new ChatMessage(Role.FUNCTION, resultText, null, tool));
            }
            const remaining = this._maxToolCalls - (iter + 1);
            if (remaining === 1) {
              conversation.push(new ChatMessage(Role.USER, "注意：你最多还能调用 1 次工具。完成查询后请调用 finish_turn 工具提交你的最终结论并结束本轮，不要再调用其他工具。"));
            } else if (remaining === 0) {
              conversation.push(new ChatMessage(Role.USER, "已到达工具调用配额。请调用 finish_turn 工具提交你的最终结论并结束本轮；若你无法调用 finish_turn，也可直接输出你的最终结论正文。"));
            }
            continue;
          }
          // 最终结论（散文、未提及工具）→ 流式上屏为独立聊天气泡：
          // 逐字累积 delta（30ms 节流），最后一帧为完整原文并标记 done。
          this._emit({ type: "agent_status", data: { memberId: member.id, status: "generating" } });
          let acc = "";
          let lastProseDeltaAt = 0;
          const emitProseDelta = (done: boolean): void => {
            const now = Date.now();
            if (!done && now - lastProseDeltaAt < 30) return;
            lastProseDeltaAt = now;
            this._emit({ type: "delta", data: { messageId, memberId: member.id, memberName: member.name, content: done ? prose : acc, done } });
          };
          for (const ch of prose) { acc += ch; emitProseDelta(false); }
          emitProseDelta(true);
          finalContent = prose;
          break;
        }
        if (resp.content && resp.content.trim()) this._emit({ type: "thinking", data: { messageId, memberId: member.id, memberName: member.name, content: resp.content.slice(0, 800) } });
        // finish_turn：显式结束本轮——conclusion 作为最终结论流式上屏为独立气泡，随后结束本轮（不生成工具气泡）
        if (fcName === "finish_turn") {
          const conclusion = (typeof fcArgs.conclusion === "string" ? fcArgs.conclusion.trim() : "")
            || resp.content || (typeof fcArgs.summary === "string" ? fcArgs.summary : "") || "";
          this._emit({ type: "agent_status", data: { memberId: member.id, status: "generating" } });
          let acc2 = ""; let last2 = 0;
          const emit2 = (done: boolean): void => { const now = Date.now(); if (!done && now - last2 < 30) return; last2 = now; this._emit({ type: "delta", data: { messageId, memberId: member.id, memberName: member.name, content: done ? conclusion : acc2, done } }); };
          for (const ch of conclusion) { acc2 += ch; emit2(false); }
          emit2(true);
          finalContent = conclusion;
          break;
        }
        this._emit({ type: "tool_call", data: { messageId, memberId: member.id, memberName: member.name, tool: fcName, args: fcArgs } });
        this._emit({ type: "agent_status", data: { memberId: member.id, status: "generating" } });
        let toolResult: any; try { toolResult = await this._toolManager.execute(fcName, fcArgs); } catch (e) { toolResult = { success: false, output: String(e) }; }
        const resultText = toolResult.success ? toolResult.output : "错误: " + toolResult.error;
        // ask_user 被中断（会话终止/删除）时，resolver 以哨兵值唤醒，工具回复不应导致异常中断
        if (typeof resultText === "string" && resultText.includes(ASK_ABORTED_SENTINEL)) {
          this._emit({ type: "agent_status", data: { memberId: member.id, status: "idle" } });
          this._pendingAskMember = null;
          this._activeTurn = false;
          this._speakingMember = null;
          return;
        }
        this._emit({ type: "tool_result", data: { messageId, memberId: member.id, memberName: member.name, tool: fcName, content: resultText.slice(0, 4000), success: toolResult.success } });
        conversation.push(new ChatMessage(Role.ASSISTANT, resp.content || "", rawFc ? { name: fcName, arguments: typeof rawFc.arguments === "string" ? rawFc.arguments : JSON.stringify(fcArgs) } : null, member.name));
        conversation.push(new ChatMessage(Role.FUNCTION, resultText, null, fcName));
                // 提前提醒：每次工具调用完成后按剩余次数提示，避免模型把配额耗在低价值查询上
        const remaining = this._maxToolCalls - (iter + 1);
        if (remaining === 1) {
          conversation.push(new ChatMessage(Role.USER, "注意：你最多还能调用 1 次工具。完成查询后请调用 finish_turn 工具提交你的最终结论并结束本轮，不要再调用其他工具。"));
        } else if (remaining === 0) {
          conversation.push(new ChatMessage(Role.USER, "已到达工具调用配额。请调用 finish_turn 工具提交你的最终结论并结束本轮；若你无法调用 finish_turn，也可直接输出你的最终结论正文。"));
        }
      }
      if (!finalContent) {
        // 循环耗尽仍未产出最终结论（纯工具调用兜底）→ 直接流式生成收尾
        this._emit({ type: "agent_status", data: { memberId: member.id, status: "generating" } });
        let streamed = ""; let lastDeltaAt = 0;
        const emitDelta = (done: boolean) => { const now = Date.now(); if (!done && now - lastDeltaAt < 30) return; lastDeltaAt = now; this._emit({ type: "delta", data: { messageId, memberId: member.id, memberName: member.name, content: streamed, done } }); };
        for await (const chunk of memberClient.astream(conversation, {}, undefined, this._abort?.signal)) { streamed += chunk; emitDelta(false); }
        emitDelta(true);
        finalContent = streamed;
      }
      // finalContent 已由散文路径流式输出，此处无需重复发 delta
    } else {
      const messages = baseMessages;
      this._emit({ type: "agent_status", data: { memberId: member.id, status: "generating" } });
      let streamed = ""; let lastDeltaAt = 0;
      const emitDelta = (done: boolean) => { const now = Date.now(); if (!done && now - lastDeltaAt < 30) return; lastDeltaAt = now; this._emit({ type: "delta", data: { messageId, memberId: member.id, memberName: member.name, content: streamed, done } }); };
      for await (const chunk of memberClient.astream(messages, {}, undefined, this._abort?.signal)) { streamed += chunk; emitDelta(false); }
      if (this._status !== "running") {
        this._activeTurn = false;
        return;
      }
      emitDelta(true);
      finalContent = streamed;
    }
    if (this._status !== "running") {
      this._activeTurn = false;
      return;
    }
    // 工单 13：ask_user 兜底——Agent 未调用 ask_user 却在正文里直接向作者提问/请求拍板时，
    // 自动把正文提问包装成 ask 卡片并挂起本轮等待作者回答，避免提问被当作普通结论而丢失。
    if (!this._askResolver.hasPending) {
      const ask = this._extractAskToAuthor(finalContent);
      if (ask) {
        // 提问正文作为该成员的一条消息入史（作者的回答随后由 submitAskAnswer 写入其后）
        const qRecord: ChatMessageRecord = {
          id: messageId,
          sessionId: this.id,
          memberId: member.id,
          memberName: member.name,
          kind: "agent",
          category: member.category,
          content: stripSelfRating(finalContent),
          timestamp: new Date().toISOString(),
          replyTo: this._messages.length > 0 ? this._messages[this._messages.length - 1]!.id : undefined,
        };
        this._messages.push(qRecord);
        this._updatedAt = new Date().toISOString();
        this._chatStore?.appendMessage(this.projectId, this.id, qRecord);
        this._scheduler.trackMessage(qRecord.content);
        if (this._vectorContext) await this._vectorContext.trackText(qRecord.id, stripSelfRating(qRecord.content));
        this._emit({ type: "chat_message", data: qRecord });
        // 挂起本轮：发出 ask 卡片，等待作者回答后继续（回答由路由 submitAskAnswer 写入）
        this._pendingAskMember = { id: member.id, name: member.name };
        const answer = await this._askResolver.ask(ask.question, ask.options, false, true);
        // 会话在等待期间被终止/删除 → ask 以哨兵值唤醒，静默结束本轮
        if (typeof answer === "string" && answer.includes(ASK_ABORTED_SENTINEL)) {
          this._pendingAskMember = null;
          this._emit({ type: "agent_status", data: { memberId: member.id, status: "idle" } });
          this._activeTurn = false;
          this._speakingMember = null;
          return;
        }
        this._pendingAskMember = null;
        this._emit({ type: "agent_status", data: { memberId: member.id, status: "idle" } });
        this._activeTurn = false;
        this._speakingMember = null;
        return;
      }
    }
    const record: ChatMessageRecord = {
      id: messageId,
      sessionId: this.id,
      memberId: member.id,
      memberName: member.name,
      kind: "agent",
      category: member.category,
      content: finalContent,
      timestamp: new Date().toISOString(),
      replyTo: this._messages.length > 0 ? this._messages[this._messages.length - 1]!.id : undefined,
    };
    // 工单 06：向量化本条发言（供共识收敛聚类 + 话题相关性），失败静默；
    // 必须在 evaluate 之前完成，保证收敛判定能看到本条发言的向量
    if (this._vectorContext) {
      await this._vectorContext.trackText(record.id, stripSelfRating(finalContent));
    }
    let evalResult: { level: number; signals: string[]; streak: number; triggered: boolean; warned: boolean; reason?: string; unresolved?: string[]; dissent_members?: any[] };
    if (this._useLLMConsensus) {
      (this._detector as LLMConsensusDetector).updateContext(this.topic, this.members);
      const llmRes = await (this._detector as LLMConsensusDetector).evaluate(record);
      evalResult = llmRes;
      if (llmRes.warned && !llmRes.triggered && !this._consensusWarned) {
        this._consensusWarned = true;
        const msg = llmRes.unresolved && llmRes.unresolved.length ? "讨论接近共识，待解分歧：" + llmRes.unresolved.join("；") + "，可补充意见后即将收束" : "讨论接近共识，可补充意见后即将收束";
        this._emit({ type: "consensus", data: { level: llmRes.level, message: msg, signals: llmRes.signals } });
      }
    } else {
      const ruleRes = (this._detector as ConsensusDetector).evaluate(record);
      evalResult = ruleRes;
      if (ruleRes.warned && !ruleRes.triggered && !this._consensusWarned) {
        this._consensusWarned = true;
        this._emit({ type: "consensus", data: { level: ruleRes.level, message: "讨论接近共识，可补充意见后即将收束", signals: ruleRes.signals } });
      }
    }
    record.content = stripSelfRating(finalContent);
    this._messages.push(record);
    this._updatedAt = new Date().toISOString();
    this._chatStore?.appendMessage(this.projectId, this.id, record);
    this._scheduler.trackMessage(record.content);
    this._emit({ type: "chat_message", data: record });
    this._emit({ type: "agent_status", data: { memberId: member.id, status: "idle" } });
    // 事务提交：本轮结束，释放事务锁（此后才允许进入下一位发言者的调度点）
    this._activeTurn = false;
  }

  /**
   * 工单 04：达成共识后的合成阶段。
   * 由「合成者」成员基于讨论记录产出结构化总结（核心共识 / 主要分歧 / 综合方案 / 行动建议），
   * 随后会话进入 completed 并推送带 summary 的 done 事件。
   * 无合成者成员时不触发合成，重置检测器让讨论继续。
   * @returns 是否已触发合成并结束会话
   */
  private async _runSynthesisIfPossible(): Promise<boolean> {
    const synthesizer = this.members.find((m) => m.kind === "agent" && m.category === "synthesizer");
    if (!synthesizer) {
      this._detector.reset();
      this._emit({ type: "system", data: { message: "接近共识，但当前没有合成者成员，讨论继续" } });
      return false;
    }
    // 工单 15：合成者同样使用其专属模型
    const memberClient = this._clientResolver(synthesizer);
    this._status = "synthesizing";
    this._updatedAt = new Date().toISOString();
    this._emit({
      type: "system",
      data: { message: "已达成共识，合成者「" + synthesizer.name + "」正在整理最终方案", status: this._status, memberId: synthesizer.id },
    });
    this._emit({ type: "consensus", data: { level: 1, message: "已达成共识，开始合成最终方案" } });
    // 工单 07：共识节点单独落库（成果与过程记录分离）
    const node: ChatConsensusNode = {
      level: 1,
      message: "已达成共识，开始合成最终方案",
      timestamp: new Date().toISOString(),
    };
    this._consensusNodes.push(node);
    this._chatStore?.appendConsensus(this.projectId, this.id, node);
    this._emit({ type: "agent_status", data: { memberId: synthesizer.id, status: "thinking" } });

    const recent = this._messages
      .slice(-12)
      .map((m) => "「" + m.memberName + "」：" + m.content)
      .join("\n");
    const summaryMessages = [
      new ChatMessage(Role.SYSTEM, synthesizer.systemPrompt || "你是剧情讨论的合成者。", undefined, synthesizer.name),
      new ChatMessage(
        Role.USER,
        "你是本次圆桌会议的合成者。请基于以下讨论记录，输出固定格式的最终方案，严格按以下四个小节输出，每节以 ## 标题开头且顺序固定：## 核心共识、## 主要分歧、## 综合方案、## 行动建议。每节需写 3-6 条要点，可追溯到讨论中的具体发言；不要开新议题，不要留开放式提问；若无分歧则在对应节写“无明显分歧”。" +
          "\n\n讨论主题：" + this.topic +
          "\n\n讨论记录：\n" + (recent || "（暂无记录）")
      ),
    ];
    this._emit({ type: "agent_status", data: { memberId: synthesizer.id, status: "generating" } });
    // 工单 09：合成者总结同样流式输出，以合成者身份上屏；最终经 done 事件带出 summary。
    const messageId = "synth-" + randomUUID();
    let streamed = "";
    let lastDeltaAt = 0;
    const emitDelta = (done: boolean): void => {
      const now = Date.now();
      if (!done && now - lastDeltaAt < 30) return;
      lastDeltaAt = now;
      this._emit({
        type: "delta",
        data: { messageId, memberId: synthesizer.id, memberName: synthesizer.name, content: streamed, done },
      });
    };
    for await (const chunk of memberClient.astream(summaryMessages, {}, undefined, this._abort?.signal)) {
      streamed += chunk;
      emitDelta(false);
    }
    if (this._status !== "synthesizing") return true; // 生成期间被作者终止
    emitDelta(true);
    const summary = streamed ?? "";

    this._status = "completed";
    this._updatedAt = new Date().toISOString();
    // 工单 07：最终方案落库 + 终态写盘
    this._summary = summary;
    this._chatStore?.setSummary(this.projectId, this.id, summary);
    this._chatStore?.setStatus(this.projectId, this.id, "completed");
    this._chatStore?.save(this.getSnapshot());
    this._emit({ type: "agent_status", data: { memberId: synthesizer.id, status: "idle" } });
    this._emit({ type: "consensus", data: { level: 1, message: "合成者产出最终方案：\n" + summary } });
    this._emit({ type: "done", data: { status: "completed", summary } });
    return true;
  }
}
