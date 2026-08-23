/**
 * 共识检测器（工单 04）。
 *
 * 三路信号加权判定，连续 N 轮超阈值触发合成：
 *   - 关键词信号（0.6）：发言中出现「我同意 / 一致 / 达成共识 / 认同 / 没有异议」等；
 *   - Agent 自评（0.7）：每次 Agent 发言末尾携带「【共识度：0~1】」自评；
 *   - 观点收敛（0.75）：默认降级为「最近窗口内 ≥2 位不同成员表态一致」
 *     （跨成员收敛，工单 06 由向量聚类替换）。
 *
 * level = min(1, 0.6*kw + 0.7*self + 0.75*conv)；warn 阈值低于触发阈值，
 * 提前推送「接近共识」预警，给作者补充机会。
 */
import type { ChatMessageRecord } from "./chat_session.js";

/** 关键词信号正则（中文共识表达） */
const KEYWORD_RE =
  /(我同意|我赞成|一致|达成共识|认同|没有异议|无异议|同意这个|认可这个|就按这个|可以定稿|一致认为|达成一致)/;

/** 自评正则：匹配行尾「【共识度：0.9】」或「共识度 0.9」 */
const SELF_RATING_RE = /【?共识度[:：]\s*(0(\.\d+)?|1(\.0+)?)\s*】?/;

export interface ConsensusEvaluation {
  /** 加权共识水平 0..1 */
  level: number;
  /** 命中的信号名：keyword / self / convergence */
  signals: string[];
  /** 当前连续超阈值轮数 */
  streak: number;
  /** 单轮是否超触发阈值 */
  triggered: boolean;
  /** 是否达到预警阈值（未触发合成） */
  warned: boolean;
}

export interface ConsensusDetectorOptions {
  /** 触发阈值，默认 0.7 */
  threshold?: number;
  /** 预警阈值，默认 0.6 */
  warnThreshold?: number;
  /** 连续触发轮数，默认 2 */
  requiredStreak?: number;
  /** 关键词信号权重，默认 0.6 */
  keywordWeight?: number;
  /** 自评信号权重，默认 0.7 */
  selfRatingWeight?: number;
  /** 观点收敛权重，默认 0.75 */
  convergenceWeight?: number;
  /** 观点收敛最近窗口大小，默认 10 */
  recentWindow?: number;
  /** 观点收敛判定函数（默认跨成员收敛降级；工单 06 注入向量聚类） */
  convergenceFn?: (recent: ChatMessageRecord[]) => boolean;
}

export function parseSelfRating(content: string): number | null {
  if (!content) return null;
  const m = SELF_RATING_RE.exec(content);
  if (!m) return null;
  const v = Number(m[1]);
  if (Number.isNaN(v)) return null;
  return Math.max(0, Math.min(1, v));
}

export function hasConsensusKeyword(content: string): boolean {
  return !!content && KEYWORD_RE.test(content);
}

/** 从发言内容中剥离「共识度」自评行，仅用于上屏展示（讨论记录保留纯净正文）。 */
export function stripSelfRating(content: string): string {
  if (!content) return "";
  return content
    .replace(/^\s*【?共识度[:：].*$/gm, "")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/** 一位成员在一条发言中是否表达「赞同 / 收敛」（关键词或高自评）。 */
function expressesAgreement(msg: ChatMessageRecord): boolean {
  return hasConsensusKeyword(msg.content) || (parseSelfRating(msg.content) ?? 0) >= 0.7;
}

export class ConsensusDetector {
  private _opts: Required<
    Pick<
      ConsensusDetectorOptions,
      "threshold" | "warnThreshold" | "requiredStreak" | "keywordWeight" | "selfRatingWeight" | "convergenceWeight" | "recentWindow"
    >
  > & { convergenceFn?: (recent: ChatMessageRecord[]) => boolean };
  private _streak = 0;
  private _recent: ChatMessageRecord[] = [];

  constructor(options: ConsensusDetectorOptions = {}) {
    this._opts = {
      threshold: options.threshold ?? 0.7,
      warnThreshold: options.warnThreshold ?? 0.6,
      requiredStreak: options.requiredStreak ?? 2,
      keywordWeight: options.keywordWeight ?? 0.6,
      selfRatingWeight: options.selfRatingWeight ?? 0.7,
      convergenceWeight: options.convergenceWeight ?? 0.75,
      recentWindow: options.recentWindow ?? 10,
      convergenceFn: options.convergenceFn,
    };
  }

  get streak(): number {
    return this._streak;
  }

  get shouldSynthesize(): boolean {
    return this._streak >= this._opts.requiredStreak;
  }

  reset(): void {
    this._streak = 0;
  }

  /** 评估一条 Agent 发言，更新连续触发轮数。 */
  evaluate(message: ChatMessageRecord): ConsensusEvaluation {
    this._recent.push(message);
    if (this._recent.length > this._opts.recentWindow) {
      this._recent.shift();
    }
    const kw = hasConsensusKeyword(message.content);
    const self = parseSelfRating(message.content);
    const selfScore = self ?? 0;
    let conv: boolean;
    if (this._opts.convergenceFn) {
      conv = this._opts.convergenceFn(this._recent);
    } else {
      // 降级：观点收敛 ≈ 最近窗口内 ≥2 位不同成员表态一致（避免单条发言重复计权）
      const agreeing = new Set(this._recent.filter(expressesAgreement).map((m) => m.memberId));
      conv = agreeing.size >= 2;
    }

    let level =
      (kw ? this._opts.keywordWeight : 0) +
      selfScore * this._opts.selfRatingWeight +
      (conv ? this._opts.convergenceWeight : 0);
    level = Math.min(1, level);

    const signals: string[] = [];
    if (kw) signals.push("keyword");
    if (self !== null) signals.push("self");
    if (conv) signals.push("convergence");

    const triggered = level >= this._opts.threshold;
    this._streak = triggered ? this._streak + 1 : 0;
    const warned = level >= this._opts.warnThreshold;
    return { level: Math.round(level * 100) / 100, signals, streak: this._streak, triggered, warned };
  }
}
