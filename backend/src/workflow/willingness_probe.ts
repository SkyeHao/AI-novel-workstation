import type { LLMClient } from "../llm/client.js";
import { ChatMessage, Role } from "../llm/models.js";
import type { ChatMember, ChatMessageRecord } from "./chat_session.js";
import { WILLINGNESS_SYSTEM_PROMPT, compact } from "./willingness_prompt.js";

export interface WillingnessProbeInput {
  member: ChatMember;
  topic: string;
  staticContext: Record<string, string>;
  historySummary: string;
  recentMessages: ChatMessageRecord[];
  triggerMessage?: ChatMessageRecord;
  mentioned: boolean;
}

export interface WillingnessProbeResult {
  memberId: string;
  memberName: string;
  willingness: number;
  confidence: number;
  reason: string;
  wouldMention: string[];
  raw: string;
  parseOk: boolean;
}

function buildUserPrompt(input: WillingnessProbeInput): string {
  const lines: string[] = [];
  lines.push("[ROLE] " + input.member.name + " (" + input.member.category + "): " + input.member.description);
  if (input.mentioned) lines.push("[MENTIONED] you were @ in latest message");
  lines.push("");
  lines.push("[TOPIC] " + input.topic);
  const keys =
    input.member.sharedContextKeys && input.member.sharedContextKeys.length > 0
      ? input.member.sharedContextKeys
      : Object.keys(input.staticContext);
  const statLines = keys
    .map((k) => {
      const v = input.staticContext[k];
      return v && v.trim().length > 0 ? "- " + k + ": " + compact(v, 240) : "";
    })
    .filter(Boolean);
  if (statLines.length > 0) {
    lines.push("[STATIC]");
    lines.push(...statLines);
  }
  lines.push("");
  if (input.historySummary && input.historySummary.trim().length > 0) {
    lines.push("[HISTORY_SUMMARY]");
    lines.push(input.historySummary);
    lines.push("");
  }
  if (input.recentMessages.length > 0) {
    lines.push("[RECENT] last 5");
    for (const m of input.recentMessages) lines.push(m.memberName + ": " + compact(m.content, 220));
    lines.push("");
  }
  if (input.triggerMessage) {
    lines.push("[TRIGGER] just posted");
    lines.push(input.triggerMessage.memberName + ": " + input.triggerMessage.content);
    lines.push("");
  }
  lines.push("Return JSON only.");
  return lines.join("\n");
}

export function parseWillingnessResponse(raw: string): { willingness: number; confidence: number; reason: string; wouldMention: string[] } | null {
  if (!raw) return null;
  const m = raw.match(/\{[\s\S]*\}/);
  const t = m ? m[0]! : raw;
  try {
    const o = JSON.parse(t) as Record<string, unknown>;
    let w = Number(o.willingness);
    let c = Number(o.confidence);
    const reason = String(o.reason ?? "").slice(0, 80);
    const wmRaw = o.would_mention;
    const wouldMention: string[] = Array.isArray(wmRaw) ? wmRaw.map((x) => String(x)).filter(Boolean).slice(0, 5) : [];
    if (Number.isNaN(w) || Number.isNaN(c)) return null;
    w = Math.max(0, Math.min(1, w));
    c = Math.max(0, Math.min(1, c));
    return { willingness: w, confidence: c, reason, wouldMention };
  } catch {
    return null;
  }
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

export interface ProbeContext {
  topic: string;
  staticContext: Record<string, string>;
  messages: ChatMessageRecord[];
  triggerMessage?: ChatMessageRecord;
  isMentioned: (member: ChatMember) => boolean;
}

export async function probeAllWillingness(
  llm: LLMClient,
  members: ChatMember[],
  ctx: ProbeContext,
  opts: { threshold?: number; timeoutMs?: number; maxTokens?: number; signal?: AbortSignal } = {}
): Promise<WillingnessProbeResult[]> {
  const timeoutMs = opts.timeoutMs ?? 1800;
  const maxTokens = opts.maxTokens ?? 100;
  const signal = opts.signal;
  const l1Count = 5;
  const l2Count = 20;
  const historyMsgs = ctx.messages.slice(-(l1Count + l2Count), -l1Count);
  const historySummary = historyMsgs.length > 0 ? historyMsgs.map((m) => m.memberName + ": " + compact(m.content, 60)).join("\n") : "";
  const recentMessages = ctx.messages.slice(-5);
  const tasks = members.map(async (member) => {
    if (signal?.aborted) return { memberId: member.id, memberName: member.name, willingness: -1, confidence: 0, reason: "aborted", wouldMention: [], raw: "", parseOk: false };
    const input: WillingnessProbeInput = {
      member,
      topic: ctx.topic,
      staticContext: ctx.staticContext,
      historySummary,
      recentMessages,
      triggerMessage: ctx.triggerMessage,
      mentioned: ctx.isMentioned(member),
    };
    const userPrompt = buildUserPrompt(input);
    const messages = [new ChatMessage(Role.SYSTEM, WILLINGNESS_SYSTEM_PROMPT, undefined, member.name), new ChatMessage(Role.USER, userPrompt)];
    const ac = async (): Promise<string | null> => {
      try {
        const r = await llm.achat(messages, { temperature: 0.3, max_tokens: maxTokens }, signal);
        return r.content ?? "";
      } catch {
        return null;
      }
    };
    const text = await withTimeout(ac(), timeoutMs);
    const rawText = (text ?? "").trim();
    const parsed = rawText ? parseWillingnessResponse(rawText) : null;
    if (!parsed) return { memberId: member.id, memberName: member.name, willingness: -1, confidence: 0, reason: rawText ? "parse_failed" : "timeout", wouldMention: [], raw: rawText, parseOk: false };
    return { memberId: member.id, memberName: member.name, willingness: parsed.willingness, confidence: parsed.confidence, reason: parsed.reason, wouldMention: parsed.wouldMention, raw: rawText, parseOk: true };
  });
  return Promise.all(tasks);
}

export { buildUserPrompt };
