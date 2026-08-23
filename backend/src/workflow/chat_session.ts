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

export type ChatSessionStatus = "idle" | "running" | "synthesizing" | "completed" | "terminated";

export interface ChatMember {
  id: string;
  kind: "agent" | "author";
  name: string;
  description: string;
  category: AgentRoleCategory;
  /** 角色系统提示词（来自角色蓝图），工单 05 将扩展为完整上下文组装 */
  systemPrompt?: string;
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

export type ChatSessionEvent =
  | { type: "system"; data: { message: string; status?: ChatSessionStatus; memberId?: string } }
  | { type: "chat_message"; data: ChatMessageRecord }
  | {
      type: "speaker";
      data: { memberId: string; memberName: string; scores: Record<string, number>; reason: string };
    }
  | { type: "agent_status"; data: { memberId: string; status: "thinking" | "generating" | "idle" } }
  | { type: "consensus"; data: { level: number; message: string; signals?: string[] } }
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
  /** 骨架阶段：每位成员发言的轮数（工单 02 由意愿度调度接管） */
  maxRounds?: number;
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
  private _status: ChatSessionStatus = "idle";
  private _messages: ChatMessageRecord[] = [];
  private _listeners = new Set<(event: ChatSessionEvent) => void>();
  private _abort: AbortController | null = null;
  private _completion: Promise<void> | null = null;
  private _updatedAt: string;

  constructor(config: ChatSessionConfig) {
    this.id = config.id ?? randomUUID();
    this.projectId = config.projectId;
    this.topic = config.topic;
    this.members = config.members;
    this.staticContext = config.staticContext ?? {};
    this._llm = config.llm;
    this._maxRounds = config.maxRounds ?? 1;
    this.createdAt = new Date().toISOString();
    this._updatedAt = this.createdAt;
    if (config.onEvent) this.subscribe(config.onEvent);
  }

  // ------------------------------------------------------------------
  // 公开操作（路由与前端经此 seam 调用）
  // ------------------------------------------------------------------

  /**
   * 开始讨论：idle → running，推送成员加入等系统事件，随后驱动发言循环。
   * 返回的 Promise 在会话结束（completed / terminated）时 resolve；异常在内部消化为 error 事件。
   */
  start(): Promise<void> {
    if (this._status !== "idle") throw new ChatSessionError("会话已在运行或已结束");
    this._status = "running";
    this._updatedAt = new Date().toISOString();
    this._abort = new AbortController();

    this._emit({ type: "system", data: { message: "讨论开始", status: this._status } });
    this._emit({ type: "system", data: { message: `讨论主题：${this.topic}` } });
    for (const m of this.members) {
      this._emit({ type: "system", data: { message: `成员「${m.name}」已加入群聊`, memberId: m.id } });
    }

    this._completion = this._drive().finally(() => {
      this._updatedAt = new Date().toISOString();
    });
    return this._completion;
  }

  /** 作者发言：实时插入（不阻塞当前 Agent 生成），计入讨论历史并推送。工单 03 增强 @ 与优先调度。 */
  async sendUserMessage(content: string): Promise<ChatMessageRecord> {
    const text = String(content ?? "").trim();
    if (!text) throw new ChatSessionError("消息不能为空");
    if (this._status !== "running") throw new ChatSessionError("会话未在运行中，无法发送消息");
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
    this._emit({ type: "chat_message", data: record });
    return record;
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
    this._emit({ type: "system", data: { message: "讨论已被作者终止", status: this._status } });
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

  /**
   * 骨架发言循环：轮流让每位成员发言一次（maxRounds 轮）。
   * 工单 02 将替换为意愿度调度器（speaker 选择 + 冷却 + 等待加成 + 兜底）。
   */
  private async _drive(): Promise<void> {
    try {
      for (let round = 0; round < this._maxRounds && this._status === "running"; round++) {
        for (const member of this.members) {
          if (this._status !== "running") break;
          await this._runAgentTurn(member);
        }
      }
      if (this._status === "running") {
        this._status = "completed";
        this._updatedAt = new Date().toISOString();
        this._emit({ type: "done", data: { status: "completed" } });
      }
    } catch (err) {
      // 异常统一收敛为 error 事件；状态进入 terminated（对应设计文档「作者手动终止 / 异常」）
      this._status = "terminated";
      this._updatedAt = new Date().toISOString();
      this._emit({ type: "error", data: { error: err instanceof Error ? err.message : String(err) } });
    }
  }

  /** 让某位 Agent 发言：思考 → LLM 生成 → 上屏（chat_message）。 */
  private async _runAgentTurn(member: ChatMember): Promise<void> {
    this._emit({ type: "agent_status", data: { memberId: member.id, status: "thinking" } });
    const messages = [
      new ChatMessage(Role.SYSTEM, member.systemPrompt || "你是一位剧情讨论顾问。", undefined, member.name),
      new ChatMessage(Role.USER, `讨论主题：${this.topic}\n\n请作为「${member.name}」发言。`),
    ];
    const resp = await this._llm.achat(messages, {}, this._abort?.signal);
    if (this._status !== "running") return;
    const record: ChatMessageRecord = {
      id: randomUUID(),
      sessionId: this.id,
      memberId: member.id,
      memberName: member.name,
      kind: "agent",
      category: member.category,
      content: resp.content,
      timestamp: new Date().toISOString(),
    };
    this._messages.push(record);
    this._updatedAt = new Date().toISOString();
    this._emit({ type: "chat_message", data: record });
    this._emit({ type: "agent_status", data: { memberId: member.id, status: "idle" } });
  }
}
