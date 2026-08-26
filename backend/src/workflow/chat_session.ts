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
import { probeAllWillingness } from "./willingness_probe.js";
import type { WillingnessProbeResult } from "./willingness_probe.js";
import { ContextAssembler, type ContextAssemblerOptions } from "./context_assembler.js";
import type { EmbeddingService } from "../vector/embedding.js";
import type { VectorStore } from "../vector/store.js";
import { VectorDiscussionContext } from "../vector/context.js";
import type { ChatStore } from "../storage/chat_store.js";

export type ChatSessionStatus = "idle" | "running" | "synthesizing" | "completed" | "terminated";

export interface ChatMember {
  id: string;
  kind: "agent" | "author";
  name: string;
  description: string;
  category: AgentRoleCategory;
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
  | {
      type: "willingness_probe";
      data: {
        round: number;
        results: Array<{ memberId: string; memberName: string; category?: AgentRoleCategory; willingness: number; confidence: number; reason: string; wouldMention: string[]; parseOk: boolean }>;
        chosenId: string | null;
        fallback: boolean;
        threshold: number;
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
  /** 发言总预算（Agent 发言次数上限），默认 8；工单 04 达成共识可提前结束 */
  maxRounds?: number;
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
  onEvent?: (event: ChatSessionEvent) => void;
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
  private _maxRounds: number;
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
  private _willingnessCfg: { enabled: boolean; threshold: number; maxTokens: number; timeoutMs: number };
  private _lastProbeTriggerId: string | null = null;

  constructor(config: ChatSessionConfig) {
    this.id = config.id ?? randomUUID();
    this.projectId = config.projectId;
    this.topic = config.topic;
    this.members = config.members;
    this.staticContext = config.staticContext ?? {};
    this._llm = config.llm;
    this._maxRounds = config.maxRounds ?? 8;
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
    this._assembler = new ContextAssembler({
      sharedContextKeys: [],
      countTokens: this._llm.count_text_tokens.bind(this._llm),
      ...config.context,
    });
    this.createdAt = new Date().toISOString();
    this._updatedAt = this.createdAt;
    this._willingnessCfg = {
      enabled: config.willingness?.enabled ?? false,
      threshold: config.willingness?.threshold ?? 0.35,
      maxTokens: config.willingness?.maxTokens ?? 100,
      timeoutMs: config.willingness?.timeoutMs ?? 1800,
    };
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
    this._chatStore = null;
    this._abort?.abort();
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
      let turns = 0;
      while (this._status === "running" && turns < this._maxRounds) {
        let speaker: ChatMember | null = null;
        if (this._willingnessCfg.enabled && this._messages.length > 0) {
          speaker = await this._pickByWillingnessProbe(turns);
        }
        if (!speaker) {
          speaker = this._scheduler.pickNext(this._now());
          if (!speaker) {
            speaker = await this._waitForIdleBackstop();
            if (!speaker) continue;
          }
        }
        await this._runAgentTurn(speaker);
        this._scheduler.recordTurn(speaker.id);
        turns += 1;
        // 工单 04：连续多轮超阈值 → 由合成者产出结构化总结并结束
        if (this._detector.shouldSynthesize) {
          const synthesized = await this._runSynthesisIfPossible();
          if (synthesized) break;
        }
      }
      if (this._status === "running") {
        this._status = "completed";
        this._updatedAt = new Date().toISOString();
        this._chatStore?.setStatus(this.projectId, this.id, "completed");
        this._chatStore?.save(this.getSnapshot());
        this._emit({ type: "done", data: { status: "completed" } });
      }
    } catch (err) {
      // 异常统一收敛为 error 事件；状态进入 terminated（对应设计文档「作者手动终止 / 异常」）
      this._status = "terminated";
      this._updatedAt = new Date().toISOString();
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

  private async _pickByWillingnessProbe(round: number): Promise<ChatMember | null> {
    const trigger = this._messages[this._messages.length - 1];
    if (!trigger) return null;
    if (this._lastProbeTriggerId === trigger.id) return null;
    this._lastProbeTriggerId = trigger.id;
    if (this._status !== "running") return null;
    const signal = this._abort?.signal;
    if (signal?.aborted) return null;
    const agents = this.members.filter((m) => m.kind === "agent");
    if (agents.length === 0) return null;
    const mentioned = new Set(this._resolveMentions(trigger.content));
    let results: WillingnessProbeResult[];
    try {
      results = await probeAllWillingness(this._llm, agents, { topic: this.topic, staticContext: this.staticContext, messages: this._messages, triggerMessage: trigger, isMentioned: (member) => mentioned.has(member.id) }, { threshold: this._willingnessCfg.threshold, timeoutMs: this._willingnessCfg.timeoutMs, maxTokens: this._willingnessCfg.maxTokens, signal: signal ?? undefined });
    } catch { return null; }
    const threshold = this._willingnessCfg.threshold;
    const viable = results.filter((r) => r.parseOk && r.willingness >= threshold);
    const payload = { round, results: results.map((r) => ({ memberId: r.memberId, memberName: r.memberName, category: agents.find((a) => a.id === r.memberId)?.category, willingness: r.parseOk ? r.willingness : 0, confidence: r.confidence, reason: r.reason, wouldMention: r.wouldMention, parseOk: r.parseOk })), chosenId: null as string | null, fallback: viable.length === 0, threshold } as const;
    if (viable.length === 0) { this._emit({ type: "willingness_probe", data: payload }); return null; }
    const now = this._now();
    const scoreMap = new Map(this._scheduler.computeScores(now).map((c) => [c.member.id, c.total] as const));
    viable.sort((a, b) => {
      const d = b.willingness - a.willingness;
      if (Math.abs(d) >= 0.05) return d;
      const sa = scoreMap.get(a.memberId) ?? 0;
      const sb = scoreMap.get(b.memberId) ?? 0;
      if (sb !== sa) return sb - sa;
      return a.memberId.localeCompare(b.memberId);
    });
    const chosen = viable[0]!;
    (payload as unknown as { chosenId: string | null }).chosenId = chosen.memberId;
    this._emit({ type: "willingness_probe", data: payload });
    return agents.find((a) => a.id === chosen.memberId) ?? null;
  }

  /** 让某位 Agent 发言：发言权分配（speaker）→ 思考 → 生成 → 上屏（chat_message）。 */
  private async _runAgentTurn(member: ChatMember): Promise<void> {
    // 发言权分配事件：附带意愿度得分明细，让调度透明可理解
    const score =
      this._scheduler.computeScores(this._now()).find((s) => s.member.id === member.id) ?? {
        total: 0,
        breakdown: { mention: 0, wait: 0, relevance: 0, trait: 0, cooldown: 0, random: 0 } as WillingnessBreakdown,
        reason: "",
      };
    this._emit({
      type: "speaker",
      data: {
        memberId: member.id,
        memberName: member.name,
        scores: { ...score.breakdown, total: score.total },
        reason: score.reason,
      },
    });
    this._emit({ type: "agent_status", data: { memberId: member.id, status: "thinking" } });
    // 工单 05：分层上下文组装（系统提示 + 静态设定 + L3/L2/L1 + 触发消息 + 任务），按预算降级
    const triggerMessage = this._messages.length > 0 ? this._messages[this._messages.length - 1] : undefined;
    const taskPrompt =
      "请作为「" + member.name + "」发言，承接最近的讨论（尤其是作者的发言与要求）并发表你的观点。" +
      "\n\n发言要求：请在结尾单独一行输出你的共识自评，格式：【共识度：0~1】。" +
      "0 表示完全不认同当前讨论方向，1 表示完全达成一致。";
    const assembled = this._assembler.assemble({
      member,
      topic: this.topic,
      messages: this._messages,
      staticContext: this.staticContext,
      triggerMessage,
      authorInstructions: this._authorInstructions,
      taskPrompt,
    });
    const messages = [
      new ChatMessage(Role.SYSTEM, assembled.systemPrompt, undefined, member.name),
      new ChatMessage(Role.USER, assembled.userPrompt),
    ];
    this._emit({ type: "agent_status", data: { memberId: member.id, status: "generating" } });
    // 工单 09：流式输出。messageId 提前生成；delta 事件携带「累计」内容，
    // 断线重连后前端拿到任一条 delta 即可完整还原，天然抗丢帧。
    const messageId = randomUUID();
    let streamed = "";
    let lastDeltaAt = 0;
    const emitDelta = (done: boolean): void => {
      const now = Date.now();
      if (!done && now - lastDeltaAt < 30) return; // 节流：至少 30ms 一帧，避免帧过密
      lastDeltaAt = now;
      this._emit({
        type: "delta",
        data: { messageId, memberId: member.id, memberName: member.name, content: streamed, done },
      });
    };
    for await (const chunk of this._llm.astream(messages, {}, undefined, this._abort?.signal)) {
      streamed += chunk;
      emitDelta(false);
    }
    if (this._status !== "running") return;
    emitDelta(true);
    const record: ChatMessageRecord = {
      id: messageId,
      sessionId: this.id,
      memberId: member.id,
      memberName: member.name,
      kind: "agent",
      category: member.category,
      content: streamed,
      timestamp: new Date().toISOString(),
      replyTo: this._messages.length > 0 ? this._messages[this._messages.length - 1]!.id : undefined,
    };
    // 工单 06：向量化本条发言（供共识收敛聚类 + 话题相关性），失败静默；
    // 必须在 evaluate 之前完成，保证收敛判定能看到本条发言的向量
    if (this._vectorContext) {
      await this._vectorContext.trackText(record.id, stripSelfRating(streamed));
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
    record.content = stripSelfRating(streamed);
    this._messages.push(record);
    this._updatedAt = new Date().toISOString();
    this._chatStore?.appendMessage(this.projectId, this.id, record);
    this._scheduler.trackMessage(record.content);
    this._emit({ type: "chat_message", data: record });
    this._emit({ type: "agent_status", data: { memberId: member.id, status: "idle" } });
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
        "请基于以下讨论记录，输出结构化最终方案，包含四部分：核心共识、主要分歧、综合方案、行动建议。" +
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
    for await (const chunk of this._llm.astream(summaryMessages, {}, undefined, this._abort?.signal)) {
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
