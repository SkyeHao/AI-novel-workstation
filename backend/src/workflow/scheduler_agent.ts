/**
 * 统一调度 Agent（群聊导演）。
 *
 * 替代工单 02/10 的「每轮并行征询全员意愿」：改为每次决策只调用一个导演角色，
 * 输入讨论主题、成员信息（含发言统计）、近期发言与历史摘要，输出下一个该发言的成员排序。
 *
 * 设计决策（与用户确认）：
 *  - 软约束：导演能看到每个成员「已发言次数 / 距上次发言轮数」，由提示词引导平衡，
 *    代码不硬性拦截冷却中的成员（导演可点名刚发言者继续补充）。
 *  - 被@强优先由 ChatSession 在调用本模块之前处理，导演不感知。
 *  - 独立配置：导演可用独立模型 / 温度 / 超时（由路由装配，缺省回落讨论同款 LLM）。
 */
import type { LLMClient } from "../llm/client.js";
import { ChatMessage, Role } from "../llm/models.js";
import type { AgentRoleCategory } from "../assets/agent_roles.js";
import type { ChatMember, ChatMessageRecord } from "./chat_session.js";
import { compact } from "./willingness_prompt.js";
import { DIRECTOR_SYSTEM_PROMPT } from "../assets/roundtable_agent_prompts.js";

/** 导演输入中单个成员的信息（含发言统计，供软约束平衡）。 */
export interface SchedulerMemberInfo {
  member: ChatMember;
  /** 已发言次数 */
  speakCount: number;
  /** 距上次发言间隔的轮数：0 = 刚刚发言过；-1 = 从未发言 */
  roundsSince: number;
}

export interface SchedulerAgentInput {
  topic: string;
  memberInfo: SchedulerMemberInfo[];
  /** 更早发言摘要（每条压缩） */
  historySummary: string;
  /** 最近发言（完整度较高） */
  recentMessages: ChatMessageRecord[];
  /** 刚发布的触发消息（作者或上一位成员） */
  triggerMessage?: ChatMessageRecord;
  /** 作者刚驳回的提案归属人 id（作者要求换方向时定位应重新提案的成员） */
  rejectedProposerId?: string | null;
  /** 该提案归属人被作者连续驳回的次数（>=1 表示正处于驳回态） */
  rejectedProposerCount?: number;
  /** 发言轮次上限；<=0 表示不限轮次直到达成共识 */
  maxRounds: number;
  /** 已消耗的发言轮数 */
  turnsUsed: number;
}

export interface SchedulerRankEntry {
  memberId: string;
  priority: number;
  reason: string;
}

export interface SchedulerDecision {
  ranking: SchedulerRankEntry[];
  note?: string;
}

export interface SchedulerDecisionResult {
  decision: SchedulerDecision | null;
  raw: string;
  parseOk: boolean;
}


function categoryLabel(category: AgentRoleCategory): string {
  const labels: Record<AgentRoleCategory, string> = {
    proposer: "提案者",
    synthesizer: "合成者",
    reviewer: "挑刺者",
  };
  return labels[category] ?? category;
}

/** 组装导演的用户消息：主题 + 成员统计 + 近期发言 + 历史摘要 + 触发消息。 */
export function buildSchedulerUserPrompt(input: SchedulerAgentInput): string {
  const lines: string[] = [];
  lines.push("[TOPIC] " + input.topic);
  lines.push("");
  lines.push("[MEMBERS]");
  for (const info of input.memberInfo) {
    const m = info.member;
    const spoke =
      info.roundsSince === -1
        ? "从未发言"
        : "已发言 " + info.speakCount + " 次，距上次发言 " + info.roundsSince + " 轮";
    lines.push("- 「" + m.name + "」(id: " + m.id + "，" + categoryLabel(m.category) + "，定位：" + compact(m.description, 60) + ")｜" + spoke);
  }
  lines.push("");
  if (input.recentMessages.length > 0) {
    lines.push("[RECENT] 最近 " + input.recentMessages.length + " 条");
    for (const m of input.recentMessages) {
      lines.push("「" + m.memberName + "」：" + compact(m.content, 240));
    }
    lines.push("");
  }
  if (input.historySummary && input.historySummary.trim().length > 0) {
    lines.push("[HISTORY] 更早发言摘要");
    lines.push(input.historySummary);
    lines.push("");
  }
  if (input.triggerMessage) {
    lines.push("[TRIGGER] 刚刚发布");
    lines.push("「" + input.triggerMessage.memberName + "」：" + compact(input.triggerMessage.content, 300));
    lines.push("");
  }
  if (input.rejectedProposerId) {
    const rp = input.memberInfo.find((i) => i.member.id === input.rejectedProposerId);
    if (rp) {
      const count = Math.max(1, input.rejectedProposerCount ?? 1);
      lines.push("[AUTHOR_REJECTION] 作者在上一轮结束后否定了「" + rp.member.name + "」的提案并要求换方向（该提案者已被连续驳回 " + count + " 次）。");
      lines.push("优先安排「" + rp.member.name + "」重新给出新方向；仅当被连续驳回 3 次及以上时，可先让其他成员提供新视角，随后仍回到「" + rp.member.name + "」整合。");
      lines.push("");
    }
  }
  const statusLine =
    input.maxRounds <= 0
      ? "[STATUS] 讨论不限轮次，直到达成共识；当前已进行 " + input.turnsUsed + " 轮"
      : "[STATUS] 讨论共 " + input.maxRounds + " 轮，已用 " + input.turnsUsed + " 轮，剩余 " + Math.max(0, input.maxRounds - input.turnsUsed) + " 轮";
  lines.push(statusLine);
  lines.push("");
  lines.push("Return JSON only.");
  return lines.join("\n");
}

/**
 * 解析导演输出为排序决策；成员 id 不在合法集合或解析失败返回 null。
 * 提供可选 memberIdByName（名字→id 映射）时，模型误填成员名字会按名字兜底补齐。
 */
export function parseSchedulerResponse(
  raw: string,
  validMemberIds: Set<string>,
  memberIdByName?: Map<string, string> | Record<string, string>
): SchedulerDecision | null {
  if (!raw) return null;
  const m = raw.match(/\{[\s\S]*\}/);
  const t = m ? m[0]! : raw;
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(t) as Record<string, unknown>;
  } catch {
    return null;
  }
  const rankingRaw = Array.isArray(obj.ranking) ? obj.ranking : [];
  const seen = new Set<string>();
  const ranking: SchedulerRankEntry[] = [];
  for (const item of rankingRaw) {
    if (!item || typeof item !== "object") continue;
    const entry = item as Record<string, unknown>;
    let memberId = String(entry.member ?? entry.memberId ?? "").trim();
    if (memberId && !validMemberIds.has(memberId) && memberIdByName) {
      // 宽容回退：模型可能输出了成员名字而非 id，按名字映射补齐
      const resolved =
        memberIdByName instanceof Map ? memberIdByName.get(memberId) : memberIdByName[memberId];
      if (resolved && validMemberIds.has(resolved)) memberId = resolved;
    }
    if (!memberId || !validMemberIds.has(memberId)) continue;
    if (seen.has(memberId)) continue;
    seen.add(memberId);
    const priority = Number(entry.priority);
    ranking.push({
      memberId,
      priority: Number.isFinite(priority) ? Math.max(1, Math.round(priority)) : 99,
      reason: String(entry.reason ?? "").slice(0, 120),
    });
  }
  if (ranking.length === 0) return null;
  ranking.sort((a, b) => a.priority - b.priority);
  return { ranking: ranking.slice(0, 3), note: obj.note ? String(obj.note).slice(0, 200) : undefined };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    p.then(
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

export interface SchedulerProbeOptions {
  timeoutMs?: number;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
  /** 导演角色卡片的系统提示词；缺省使用内置默认提示词 */
  systemPrompt?: string;
}

/** 单次导演决策调用（带超时）。调用方负责在解析失败 / 超时时回退规则调度。 */
export async function probeSchedulerDecision(
  llm: LLMClient,
  input: SchedulerAgentInput,
  opts: SchedulerProbeOptions = {}
): Promise<SchedulerDecisionResult> {
  const timeoutMs = opts.timeoutMs ?? 60000;
  const maxTokens = opts.maxTokens ?? 300;
  const temperature = opts.temperature ?? 0.3;
  const signal = opts.signal;
  const validIds = new Set(input.memberInfo.map((i) => i.member.id));
  const memberIdByName = new Map<string, string>();
  for (const info of input.memberInfo) {
    if (!memberIdByName.has(info.member.name)) memberIdByName.set(info.member.name, info.member.id);
  }
  const userPrompt = buildSchedulerUserPrompt(input);
  const messages = [
    new ChatMessage(Role.SYSTEM, opts.systemPrompt ?? DIRECTOR_SYSTEM_PROMPT, undefined, "调度员"),
    new ChatMessage(Role.USER, userPrompt),
  ];
  const ac = async (): Promise<string | null> => {
    try {
      const r = await llm.achat(messages, { temperature, max_tokens: maxTokens }, signal);
      return r.content ?? "";
    } catch {
      return null;
    }
  };
  const text = await withTimeout(ac(), timeoutMs);
  const rawText = (text ?? "").trim();
  if (!rawText) return { decision: null, raw: rawText, parseOk: false };
  const decision = parseSchedulerResponse(rawText, validIds, memberIdByName);
  return { decision, raw: rawText, parseOk: decision !== null };
}
