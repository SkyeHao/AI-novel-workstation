/**
 * 向量讨论上下文（工单 06）。
 *
 * 将 EmbeddingService（文本→向量）与 VectorStore（向量存取 / 聚类）组合成
 * 讨论编排可消费的两路语义信号：
 *   1. 话题相关性：成员画像向量 vs 最近发言向量 的余弦相似度 → 意愿度 +0~50；
 *   2. 观点收敛：最近发言向量聚类，簇内相似度 ≥ 阈值 → 共识检测。
 *
 * 同步签名约束：调度器与共识检测器的消费接口都是同步函数，而 Embedding 是异步的，
 * 因此本类在会话开始时预热成员画像向量，并在每次发言后异步更新
 * 「最近发言向量 / 消息向量表」，读取侧全部走内存缓存。
 * 任一环节未就绪 / 未命中时自动回退到「关键词 + 随机」/「跨成员表态一致」，绝不抛出。
 *
 * 运行时切换接口：本类只依赖 EmbeddingService 与 VectorStore 接口，
 * 可通过 createEmbeddingService / createVectorStore 替换实现（例如切换其它向量库 / 模型）。
 */
import type { ChatMember, ChatMessageRecord } from "../workflow/chat_session.js";
import type { EmbeddingService } from "./embedding.js";
import type { VectorStore } from "./store.js";
import { cosine } from "./store.js";
import { hasConsensusKeyword, parseSelfRating } from "../workflow/consensus_detector.js";
import { keywordRelevance } from "../workflow/speaker_scheduler.js";

export interface VectorContextOptions {
  embedding?: EmbeddingService;
  store?: VectorStore;
  /** 成员画像文本拼接：默认 name + description + sharedContextKeys 静态设定。 */
  profileText?: (member: ChatMember, staticContext: Record<string, string>) => string;
  /** 观点收敛阈值（簇内相似度 ≥ 该值视为收敛），默认 0.75。 */
  convergenceThreshold?: number;
  /** 随机函数（关键词降级用），默认 Math.random。 */
  random?: () => number;
}

/** 跨成员表态一致（关键词或自评 ≥ 0.7）——向量服务不可用时的观点收敛降级。 */
function agreementFallback(recent: ChatMessageRecord[]): boolean {
  const agreeing = new Set(
    recent
      .filter((m) => hasConsensusKeyword(m.content) || (parseSelfRating(m.content) ?? 0) >= 0.7)
      .map((m) => m.memberId)
  );
  return agreeing.size >= 2;
}

const DEFAULT_PROFILE_TEXT = (member: ChatMember, staticContext: Record<string, string>): string => {
  const keys = member.sharedContextKeys ?? [];
  const shared = keys
    .map((k) => staticContext[k])
    .filter((v): v is string => !!v)
    .join("；");
  return [member.name, member.description, shared].filter(Boolean).join(" ").slice(0, 2000);
};

export class VectorDiscussionContext {
  private _embedding?: EmbeddingService;
  private _store?: VectorStore;
  private _profileText: (member: ChatMember, staticContext: Record<string, string>) => string;
  private _convergenceThreshold: number;
  private _random: () => number;
  private _profileVectors = new Map<string, number[]>();
  private _messageVectors = new Map<string, number[]>();
  private _recentTextVector: number[] | null = null;
  private _ready = false;

  constructor(options: VectorContextOptions = {}) {
    this._embedding = options.embedding;
    this._store = options.store;
    this._profileText = options.profileText ?? DEFAULT_PROFILE_TEXT;
    this._convergenceThreshold = options.convergenceThreshold ?? 0.75;
    this._random = options.random ?? Math.random;
  }

  get ready(): boolean {
    return this._ready;
  }

  /**
   * 会话开始时预热：加载 Embedding / 连接向量库、确保 collection、向量化成员画像。
   * 任一环节失败返回 false（不抛出），由上层降级。
   */
  async ensureReady(members: ChatMember[], staticContext: Record<string, string>): Promise<boolean> {
    if (this._ready) return true;
    if (!this._embedding || !this._store) return false;
    try {
      const [embedOk, storeOk] = await Promise.all([this._embedding.ensureReady(), this._store.ensureReady()]);
      if (!embedOk || !storeOk) return false;
      await this._store.ensureCollection(this._embedding.dimensions);
      const texts = members.map((m) => this._profileText(m, staticContext));
      const vectors = await this._embedding.embed(texts);
      for (let i = 0; i < members.length; i++) {
        this._profileVectors.set(members[i]!.id, vectors[i]!);
      }
      this._ready = true;
      return true;
    } catch {
      this._ready = false;
      return false;
    }
  }

  /**
   * 跟踪一条发言：异步向量化并缓存（供收敛聚类与话题相关性），失败静默。
   * 调用时机在共识检测 / 上屏之前，保证收敛判定能看到本条发言的向量。
   */
  async trackText(messageId: string, text: string): Promise<void> {
    if (!this._ready || !this._embedding || !text) return;
    try {
      const vec = (await this._embedding.embed([text]))[0]!;
      this._messageVectors.set(messageId, vec);
      this._recentTextVector = vec;
      await this._store?.upsert([{ id: messageId, vector: vec, payload: { messageId } }]);
    } catch {
      /* 向量化失败静默，读取侧回退 */
    }
  }

  /** 同步话题相关性 0~50：成员画像 vs 最近发言；未就绪 / 未命中 → 关键词降级。 */
  relevance(member: ChatMember, recentText: string): number {
    if (!this._ready) return keywordRelevance(member, recentText, this._random);
    const memberVec = this._profileVectors.get(member.id);
    const recentVec = this._recentTextVector;
    if (!memberVec || !recentVec) return keywordRelevance(member, recentText, this._random);
    const sim = cosine(memberVec, recentVec);
    return Math.max(0, Math.min(50, Math.round(sim * 50)));
  }

  /** 同步观点收敛判定：最近发言向量聚类；未就绪 / 向量不足 → 跨成员表态一致降级。 */
  convergence(recent: ChatMessageRecord[]): boolean {
    if (!this._ready) return agreementFallback(recent);
    const vectors = recent.map((m) => this._messageVectors.get(m.id)).filter((v): v is number[] => !!v);
    if (vectors.length < 2) return agreementFallback(recent);
    const sim = this._store?.clusterSimilarity(vectors) ?? 0;
    return sim >= this._convergenceThreshold;
  }
}
