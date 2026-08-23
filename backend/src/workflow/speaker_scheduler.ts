/**
 * 意愿度发言调度器（工单 02）。
 *
 * 单一发言者模型：任一时刻至多一个 Agent 在生成，其余等待。
 * 系统对每位成员动态计算「意愿度」，选出最高分者获得发言权：
 *   总意愿度 = 被@加成(+100)
 *            + 等待时间加成(+0~30)      // 越久没发言越高
 *            + 话题相关性(+0~50)        // 默认关键词降级；工单 06 接入 Embedding
 *            + 角色特性加成(+0~20)      // 角色倾向，如冲突制造者更爱开口
 *            - 冷却惩罚(-50~-20)        // 刚发过言衰减，防垄断
 *            + 随机扰动(+0~10)          // 打破固定顺序
 *
 * 候选 = 不在冷却期的成员；若无人可选（全部冷却中）由编排器触发兜底强制开口。
 * 时间与随机均可注入，使黑盒测试确定性（经 ChatSession 唯一 seam）。
 */
import type { AgentRoleCategory } from "../assets/agent_roles.js";
import type { ChatMember } from "./chat_session.js";

export interface WillingnessBreakdown {
  mention: number;
  wait: number;
  relevance: number;
  trait: number;
  cooldown: number;
  random: number;
}

export interface SpeakerCandidate {
  member: ChatMember;
  total: number;
  breakdown: WillingnessBreakdown;
  reason: string;
}

export interface SpeakerSchedulerOptions {
  /** 冷却时长（ms），默认 20000 */
  cooldownMs?: number;
  /** 被@一次加成，默认 100 */
  mentionBoost?: number;
  /** 等待加成上限，默认 30 */
  maxWaitBonus?: number;
  /** 每秒等待加成速率，默认 1（越久越开口） */
  waitRatePerSec?: number;
  /** 话题相关性得分范围 [0,50]，默认 [0,50] */
  relevanceRange?: [number, number];
  /** 角色特性加成表（category → 0~20），默认 proposer+8 / reviewer+12 / synthesizer+5 */
  traitBonus?: Partial<Record<AgentRoleCategory, number>>;
  /** 随机函数（0..1），默认 Math.random；测试注入恒 0 使确定性 */
  random?: () => number;
  /** 时钟（ms），默认 Date.now；测试注入可控时钟 */
  now?: () => number;
  /** 相关性打分函数（默认关键词降级）；工单 06 由 Embedding 服务替换 */
  relevanceFn?: (member: ChatMember, recentText: string) => number;
}

const DEFAULT_TRAIT: Record<AgentRoleCategory, number> = {
  proposer: 8,
  reviewer: 12,
  synthesizer: 5,
};

/** 从角色名 / 描述抽取关键词（中文按 2 字 n-gram + 英文单词），供关键词相关性降级。 */
function extractKeywords(member: ChatMember): string[] {
  const src = member.name + " " + member.description;
  const terms = new Set<string>();
  for (const m of src.matchAll(/[A-Za-z0-9_]{2,}/g)) {
    terms.add(m[0].toLowerCase());
  }
  const zh = src.replace(/[A-Za-z0-9_s]/g, "");
  for (let i = 0; i + 1 < zh.length; i++) {
    terms.add(zh.slice(i, i + 2));
  }
  return [...terms].slice(0, 60);
}

/** 默认关键词相关性：recentText 命中该角色关键词越多得分越高；无命中给随机下限。 */
function keywordRelevance(member: ChatMember, recentText: string, random: () => number): number {
  const terms = extractKeywords(member);
  if (terms.length === 0) return Math.round(random() * 10);
  let hits = 0;
  const text = String(recentText ?? "").toLowerCase();
  for (const t of terms) {
    if (text.includes(t)) hits += 1;
  }
  if (hits === 0) return Math.round(random() * 10);
  return Math.min(50, 10 + hits * 8);
}

export class SpeakerScheduler {
  private _members: ChatMember[];
  private _opts: {
    cooldownMs: number;
    mentionBoost: number;
    maxWaitBonus: number;
    waitRatePerSec: number;
    relevanceRange: [number, number];
    traitBonus: Record<AgentRoleCategory, number>;
    random: () => number;
    now: () => number;
    relevanceFn?: (member: ChatMember, recentText: string) => number;
  };
  private _mentionBoost = new Map<string, number>();
  private _lastSpokeAt = new Map<string, number>();
  private _startedAt = 0;
  /** 最近一条消息（含作者消息）的文本，用于话题相关性 */
  private _recentText = "";

  constructor(members: ChatMember[], options: SpeakerSchedulerOptions = {}) {
    this._members = members;
    this._opts = {
      cooldownMs: options.cooldownMs ?? 20000,
      mentionBoost: options.mentionBoost ?? 100,
      maxWaitBonus: options.maxWaitBonus ?? 30,
      waitRatePerSec: options.waitRatePerSec ?? 1,
      relevanceRange: options.relevanceRange ?? [0, 50],
      traitBonus: { ...DEFAULT_TRAIT, ...(options.traitBonus ?? {}) },
      random: options.random ?? Math.random,
      now: options.now ?? (() => Date.now()),
      relevanceFn: options.relevanceFn,
    };
  }

  /** 会话开始时调用，记录起始时钟。 */
  start(): void {
    this._startedAt = this._opts.now();
  }

  /** @ 定向召唤：给指定成员一次性强加成（被选中或下次发言后清除）。 */
  mention(memberId: string): void {
    this._mentionBoost.set(memberId, this._opts.mentionBoost);
  }

  /** 更新最近消息文本（作者或 Agent 发言后调用），供话题相关性计算。 */
  trackMessage(content: string): void {
    this._recentText = String(content ?? "").slice(0, 2000);
  }

  /** 某成员发言结束后调用：记录发言时间、清除 @ 加成。 */
  recordTurn(memberId: string): void {
    this._lastSpokeAt.set(memberId, this._opts.now());
    this._mentionBoost.delete(memberId);
  }

  get recentText(): string {
    return this._recentText;
  }

  /** 是否处于冷却期（冷却中不可作为常规候选）。 */
  isCooling(memberId: string, now: number = this._opts.now()): boolean {
    const last = this._lastSpokeAt.get(memberId);
    if (last === undefined) return false;
    return now - last < this._opts.cooldownMs;
  }

  /** 计算全部成员的意愿度明细（排序从高到低）。 */
  computeScores(now: number = this._opts.now()): SpeakerCandidate[] {
    return this._members
      .map((member) => this._score(member, now))
      .sort((a, b) => b.total - a.total || a.member.id.localeCompare(b.member.id));
  }

  /**
   * 选择下一位发言者：候选 = 未冷却；若存在 @ 加成者则优先（无视冷却，对应「@ 后下轮归被 @ 者」）。
   * 无可选返回 null（由编排器触发兜底）。
   */
  pickNext(now: number = this._opts.now()): ChatMember | null {
    for (const id of this._mentionBoost.keys()) {
      const member = this._members.find((m) => m.id === id);
      if (member) return member;
    }
    const candidates = this.computeScores(now).filter((c) => !this.isCooling(c.member.id, now));
    if (candidates.length === 0) return null;
    return candidates[0]!.member;
  }

  /** 兜底：无视冷却，选当前总分最高者强制开口（防冷场）。 */
  forceHighest(now: number = this._opts.now()): ChatMember {
    return this.computeScores(now)[0]!.member;
  }

  private _score(member: ChatMember, now: number): SpeakerCandidate {
    const last = this._lastSpokeAt.get(member.id) ?? this._startedAt;
    const elapsedSec = Math.max(0, (now - last) / 1000);
    const wait = Math.min(this._opts.maxWaitBonus, Math.floor(elapsedSec * this._opts.waitRatePerSec));

    const ageMs = Math.max(0, now - last);
    let cooldown = 0;
    if (this._lastSpokeAt.has(member.id) && ageMs < this._opts.cooldownMs) {
      const progress = Math.min(1, ageMs / this._opts.cooldownMs);
      cooldown = Math.round(-(50 - progress * 30));
    }

    const mention = this._mentionBoost.get(member.id) ?? 0;
    const trait = this._opts.traitBonus[member.category] ?? 0;
    const relMin = this._opts.relevanceRange[0];
    const relMax = this._opts.relevanceRange[1];
    let relevance: number;
    if (this._opts.relevanceFn) {
      relevance = Math.max(relMin, Math.min(relMax, Math.round(this._opts.relevanceFn(member, this._recentText))));
    } else {
      relevance = Math.max(relMin, Math.min(relMax, keywordRelevance(member, this._recentText, this._opts.random)));
    }
    const random = Math.round(this._opts.random() * 10);

    const total = mention + wait + relevance + trait + cooldown + random;
    const breakdown: WillingnessBreakdown = { mention, wait, relevance, trait, cooldown, random };
    const parts: string[] = [];
    if (mention > 0) parts.push("被@ +" + mention);
    if (wait > 0) parts.push("等待 +" + wait);
    if (relevance > 0) parts.push("相关性 +" + relevance);
    if (trait > 0) parts.push("角色 +" + trait);
    if (cooldown < 0) parts.push("冷却 " + cooldown);
    if (random > 0) parts.push("随机 +" + random);
    const reason = parts.length > 0 ? parts.join("，") : "基准分";
    return { member, total, breakdown, reason };
  }
}
