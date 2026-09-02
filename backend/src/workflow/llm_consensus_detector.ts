/**
 * LLM 共识裁判（纯 LLM 判定，替代规则加权）。
 *
 * 设计：不再做 keyword/self/convergence 三路加权，
 * 而是一次看全量窗口（topic + 成员角色 + 最近 10 条消息），
 * 让 LLM 像人类主持人一样输出结构化裁决。
 *
 * 连续 2 轮 verdict==='reached' 且无未解决分歧才算达成，
 * 与旧 ConsensusDetector 的 streak 语义对齐，但由 LLM 的语义判断驱动。
 */
import { ChatMessage, Role } from "../llm/models.js";
import type { LLMClient } from "../llm/client.js";
import { compact } from "./willingness_prompt.js";
import { CONSENSUS_JUDGE_SYSTEM_PROMPT } from "../assets/roundtable_agent_prompts.js";
// 为避免与 chat_session.ts 循环依赖，此处本地定义最小所需形状（与 ChatMember/ChatMessageRecord 结构一致）
export interface JudgeMember {
  id: string;
  name: string;
  kind: "agent" | "author";
  category?: string;
  description?: string;
}
export interface JudgeMessage {
  id: string;
  memberId: string;
  memberName: string;
  content: string;
}
type ChatMember = JudgeMember;
type ChatMessageRecord = JudgeMessage;

export type LLMVerdict = "none" | "near" | "reached";

export interface LLMJudgeResult {
  level: number; // 0-1
  verdict: LLMVerdict;
  agree_members: string[]; // 成员 id 或 name
  dissent_members: Array<{ member: string; reason: string }>;
  unresolved: string[]; // 未解决的核心分歧点
  reason: string; // 一句话总结，给前端/日志
  raw?: string; // LLM 原始输出，便于排障
}

export interface LLMConsensusEvaluation extends LLMJudgeResult {
  signals: string[]; // 固定 ["llm"]，兼容旧 ConsensusEvaluation.signals
  streak: number;
  triggered: boolean; // verdict==='reached' && unresolved.length===0
  warned: boolean; // verdict==='near' || (reached 但有分歧)
}

export interface LLMConsensusDetectorOptions {
  /** 共识裁判专属 LLM client（来自共识裁判角色卡片的 modelId）；缺省回落讨论同款 LLM */
  llm?: LLMClient;
  requiredStreak?: number; // 默认 2
  recentWindow?: number; // 默认 10
  modelTemperature?: number; // 默认 0.2
  /** 判定输出 token 上限；null 表示不限制、使用所选模型默认配置（与导演/讨论一致） */
  maxTokens?: number | null;
  timeoutMs?: number; // 默认 60000（与导演超时对齐），超时则 fallback
  fallbackToRule?: boolean; // LLM 失败是否回退到规则，默认 true
  /** 共识裁判角色卡片的系统提示词；缺省使用内置默认提示词 */
  systemPrompt?: string;
}

function extractJson(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1]! : trimmed;
  try {
    const parsed = JSON.parse(candidate);
    if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
    return null;
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>;
      } catch { return null; }
    }
    return null;
  }
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/**
 * 判定某项 unresolved / dissent 是否属于「作者待拍板 / 待作者确认」类。
 * 这类事项只等作者执行决策，不是 agent 之间的分歧，不应阻塞 agent 间的共识判定。
 */
function isAuthorPendingItem(text: string): boolean {
  const t = (text ?? "").trim();
  if (!t) return false;
  const mentionsAuthor = /作者/.test(t);
  const decisionWords = /(拍板|确认|决定|选择|答复|回复|审阅|检查|敲定|定夺|等待|待|确定)/.test(t);
  const directPending = /(待作者|等作者|请作者|由作者|等待作者)/.test(t);
  return directPending || (mentionsAuthor && decisionWords);
}


/**
 * 各角色当前立场：各自最近一次发言（压缩后），便于裁判快速定位谁同意 / 谁保留，
 * 弥补「最近 10 条窗口」可能被某一人刷屏、看不到其他成员态度的缺陷。
 */
function buildMemberStanceLines(members: ChatMember[], memberLast: Map<string, ChatMessageRecord>): string {
  return members
    .map((m) => {
      const tag = m.kind === "author" ? "作者" : m.category;
      const last = memberLast.get(m.id);
      if (!last) return `- ${m.name}（${tag}）：尚未发言`;
      return `- ${m.name}（${tag}）：${compact(last.content, 160)}`;
    })
    .join("\n");
}

export function buildUserPrompt(
  topic: string,
  members: ChatMember[],
  recent: ChatMessageRecord[],
  memberLast: Map<string, ChatMessageRecord>
): string {
  const memberLines = members.map((m) => `- ${m.name}（${m.kind === "author" ? "作者" : m.category}）：${m.description || ""}`).join("\n");
  const stanceLines = buildMemberStanceLines(members, memberLast);
  const msgLines = recent.map((m, i) => `${i + 1}. 「${m.memberName}」：${m.content}`).join("\n") || "（暂无消息）";
  return `讨论主题：${topic}

成员：
${memberLines}

各角色当前立场（各自最近一次发言，供参考，不代表完整立场）：
${stanceLines}

最近消息（按时间顺序）：
${msgLines}

请输出 JSON，格式：
{
  "level": 0.0,
  "verdict": "none|near|reached",
  "agree_members": ["成员名"],
  "dissent_members": [{"member": "成员名", "reason": "一句话原因"}],
  "unresolved": ["未解决分歧点"],
  "reason": "一句话总结"
}

判定标准：
- none: 明显分歧或无人明确同意
- near: 多数同意但有1人保留或有未解决分歧
- reached: 至少2人明确同意且无人反对、无未解决分歧

示例1（达成）：
输入：A:我同意这个方案 B:认同，就按这个来 C:没异议
输出：{"level":0.9,"verdict":"reached","agree_members":["A","B","C"],"dissent_members":[],"unresolved":[],"reason":"3人明确一致，无分歧"}

示例2（假达成）：
输入：A:同意 B:同意 C:但我觉得主角动机还是不成立
输出：{"level":0.65,"verdict":"near","agree_members":["A","B"],"dissent_members":[{"member":"C","reason":"主角动机不成立"}],"unresolved":["主角动机是否可信"],"reason":"2人同意，C 仍保留"}

现在请判断本次讨论。`;
}

export class LLMConsensusDetector {
  private _llm: LLMClient;
  private _topic: string;
  private _members: ChatMember[];
  private _opts: Required<LLMConsensusDetectorOptions>;
  private _recent: ChatMessageRecord[] = [];
  /** 各成员最近一次发言，用于共识裁判快速感知各方当前立场 */
  private _memberLast = new Map<string, ChatMessageRecord>();
  private _streak = 0;
  private _systemPrompt: string;

  constructor(llm: LLMClient, topic: string, members: ChatMember[], opts: LLMConsensusDetectorOptions = {}) {
    this._llm = opts.llm ?? llm;
    this._topic = topic;
    this._members = members;
    this._systemPrompt = opts.systemPrompt ?? CONSENSUS_JUDGE_SYSTEM_PROMPT;
   this._opts = {
      llm: this._llm,
      systemPrompt: this._systemPrompt,
     requiredStreak: opts.requiredStreak ?? 2,
      recentWindow: opts.recentWindow ?? 10,
      modelTemperature: opts.modelTemperature ?? 0.2,
      maxTokens: opts.maxTokens ?? null,
      timeoutMs: opts.timeoutMs ?? 60000,
      fallbackToRule: opts.fallbackToRule ?? true,
    };
  }

  get streak(): number { return this._streak; }
  get shouldSynthesize(): boolean { return this._streak >= this._opts.requiredStreak; }
  reset(): void { this._streak = 0; }

  /** 供 ChatSession 在成员/主题变化时同步 */
  updateContext(topic: string, members: ChatMember[]): void {
    this._topic = topic;
    this._members = members;
  }

  /** 主入口：异步 LLM 裁决，失败可回退。ChatSession 每轮 Agent 发言后调用。 */
  async evaluate(message: ChatMessageRecord): Promise<LLMConsensusEvaluation> {
    this._recent.push(message);
    if (this._recent.length > this._opts.recentWindow) this._recent.shift();
    // 记录每位成员最近一次发言（按 memberId 覆盖，与滑窗解耦，保留完整讨论期立场）
    this._memberLast.set(message.memberId, message);

    const snapshot = [...this._recent];
    let result: LLMJudgeResult | null = null;
    try {
      result = await this._judgeWithTimeout(snapshot);
    } catch {
      result = null;
    }

    if (!result) {
      // Fallback：视为 none，避免误触发
      const fallback: LLMConsensusEvaluation = {
        level: 0, verdict: "none", agree_members: [], dissent_members: [], unresolved: ["LLM 判定失败，回退"],
        reason: "LLM 判定失败", raw: "", signals: ["llm"], streak: 0, triggered: false, warned: false,
      };
      this._streak = 0;
      return fallback;
    }

    const triggered = result.verdict === "reached" && result.unresolved.length === 0;
    const warned = result.verdict === "near" || (result.verdict === "reached" && !triggered);
    this._streak = triggered ? this._streak + 1 : 0;

    return {
      ...result,
      signals: ["llm"],
      streak: this._streak,
      triggered,
      warned,
    };
  }

  private async _judgeWithTimeout(recent: ChatMessageRecord[]): Promise<LLMJudgeResult | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this._opts.timeoutMs);
    try {
      const prompt = buildUserPrompt(this._topic, this._members, recent, this._memberLast);
      const messages = [
        new ChatMessage(Role.SYSTEM, this._systemPrompt),
        new ChatMessage(Role.USER, prompt),
      ];
      const kwargs: Record<string, unknown> = {
        temperature: this._opts.modelTemperature,
        response_format: { type: "json_object" },
      };
      // maxTokens 为空时不下发 max_tokens，交 LLMClient 使用所选模型的默认上限（与导演一致）
      if (this._opts.maxTokens != null) kwargs.max_tokens = this._opts.maxTokens;
      const resp = await this._llm.achat(messages, kwargs, controller.signal);
      const parsed = extractJson(resp.content);
      if (!parsed) return null;
      return this._normalize(parsed, resp.content);
    } finally {
      clearTimeout(timer);
    }
  }

  private _normalize(raw: Record<string, unknown>, rawText: string): LLMJudgeResult {
    const level = clamp01(Number((raw as any).level ?? 0));
    const verdictRaw = String((raw as any).verdict || "none").toLowerCase();
    const verdict: LLMVerdict = verdictRaw === "reached" ? "reached" : verdictRaw === "near" ? "near" : "none";
    const agree = Array.isArray((raw as any).agree_members) ? (raw as any).agree_members.map((s: unknown) => String(s)) : [];
    const dissentRaw = Array.isArray((raw as any).dissent_members) ? (raw as any).dissent_members : [];
    const dissent = dissentRaw.map((d: any) => {
      if (typeof d === "string") return { member: d, reason: "" };
      return { member: String(d.member || d.name || ""), reason: String(d.reason || "") };
    }).filter((d: any) => d.member);
    const unresolved: string[] = Array.isArray((raw as any).unresolved) ? (raw as any).unresolved.map((s: unknown) => String(s)) : [];
    // 工单 13：解耦「作者待拍板」——作者待决策/确认的事项不是 agent 间分歧，
    // 从 unresolved / dissent 中剥离，避免裁判永远把「等待作者」列为障碍导致死循环。
    const authorPendingUnresolved = unresolved.filter((u: string) => isAuthorPendingItem(u));
    const authorPendingDissent = dissent.filter((d: { member: string; reason: string }) => isAuthorPendingItem(d.reason + " " + d.member));
    const filteredUnresolved = unresolved.filter((u: string) => !isAuthorPendingItem(u));
    const filteredDissent = dissent.filter((d: { member: string; reason: string }) => !isAuthorPendingItem(d.reason + " " + d.member));
    let reason = String((raw as any).reason || "");
    if (authorPendingUnresolved.length > 0 || authorPendingDissent.length > 0) {
      const extra = [...authorPendingUnresolved, ...authorPendingDissent.map((d: { member: string; reason: string }) => d.reason || d.member)].join("；");
      reason = (reason ? reason + "；" : "") + "（作者待决策项不阻塞共识：" + extra + "）";
    }
    let finalVerdict = verdict;
    let finalLevel = level;
    // 若剥离作者项后 agent 之间已无分歧且 ≥2 人同意，把 LLM 因作者项判的 near 升为 reached
    if (filteredUnresolved.length === 0 && filteredDissent.length === 0 && agree.length >= 2 &&
        (verdict === "near" || verdict === "reached")) {
      finalVerdict = "reached";
      finalLevel = Math.max(finalLevel, 0.75);
    }
    // 一致性修正：若有真实 agent 分歧/unresolved 却判 reached，自动降级为 near
    if (finalVerdict === "reached" && (filteredDissent.length > 0 || filteredUnresolved.length > 0)) {
      finalVerdict = "near";
      finalLevel = Math.min(level, 0.65);
    }
    if (finalVerdict === "reached" && agree.length < 2) {
      finalVerdict = "near";
      finalLevel = Math.min(level, 0.6);
    }
    return { level: Math.round(finalLevel * 100) / 100, verdict: finalVerdict, agree_members: agree, dissent_members: filteredDissent, unresolved: filteredUnresolved, reason, raw: rawText };
  }
}



