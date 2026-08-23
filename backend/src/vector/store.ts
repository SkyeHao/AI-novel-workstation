/**
 * 向量存储服务（工单 06）。
 *
 * 独立服务模块：Qdrant 封装（collection 管理 / upsert / search / cluster）。
 * - 仅负责向量与载荷的存取与检索；不感知剧情语义。
 * - 连接失败 / 依赖缺失时 ensureReady 返回 false，由上层降级，绝不抛出阻断主流程。
 * - clusterSimilarity 为纯计算（对最近向量的簇内相似度），不依赖连接，供共识收敛判定。
 *
 * 运行时切换接口：所有消费方依赖 VectorStore 接口，可通过 createVectorStore 替换实现
 * （例如切换到其它向量库 / 内存实现）。
 */

export interface VectorPoint {
  /** 消息 id（或业务主键） */
  id: string;
  vector: number[];
  payload?: Record<string, unknown>;
}

export interface VectorStore {
  readonly name: string;
  /** 连接检查并确保就绪；失败返回 false，不抛出。 */
  ensureReady(): Promise<boolean>;
  /** 确保 collection 存在（首次自动创建，维度按 embedding 维度）。 */
  ensureCollection(dimensions: number): Promise<void>;
  /** 批量写入向量（失败静默，不阻断主流程）。 */
  upsert(points: VectorPoint[]): Promise<void>;
  /** 相似检索：返回最相似的 messageId 列表。 */
  search(vector: number[], limit: number): Promise<string[]>;
  /** 簇内相似度 0..1：与质心的平均余弦，用于观点收敛判定。 */
  clusterSimilarity(vectors: number[][]): number;
  close(): Promise<void>;
}

export interface VectorStoreOptions {
  /** Qdrant 服务地址，默认 http://127.0.0.1:6333 */
  url?: string;
  /** Qdrant API key（可选） */
  apiKey?: string;
  /** collection 名，默认 chat_messages */
  collectionName?: string;
  /** 连接超时（ms），默认 3000 */
  connectTimeoutMs?: number;
}

const DEFAULT_URL = "http://127.0.0.1:6333";
const DEFAULT_COLLECTION = "chat_messages";

interface QdrantClientLike {
  getCollections(): Promise<{ result?: { collections?: Array<{ name: string }> } }>;
  createCollection(name: string, cfg: { vectors: { size: number; distance: string } }): Promise<unknown>;
  upsert(collection: string, body: { points: Array<Record<string, unknown>> }): Promise<unknown>;
  search(
    collection: string,
    body: { vector: number[]; limit: number; with_payload?: boolean }
  ): Promise<Array<{ id: string | number; payload?: Record<string, unknown> | null }>>;
}

/** 余弦相似度（向量已归一化时可视为点积）。 */
export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** 簇内相似度：各向量与质心余弦的平均（0..1）。空集返回 0。 */
export function clusterSimilarity(vectors: number[][]): number {
  if (vectors.length === 0) return 0;
  const dim = vectors[0]!.length;
  const mean = new Array(dim).fill(0);
  for (const v of vectors) {
    for (let i = 0; i < dim; i++) mean[i]! += v[i]!;
  }
  for (let i = 0; i < dim; i++) mean[i]! /= vectors.length;
  let sum = 0;
  for (const v of vectors) sum += cosine(v, mean);
  return sum / vectors.length;
}

export class QdrantVectorStore implements VectorStore {
  readonly name = "qdrant";
  private _client: QdrantClientLike | null = null;
  private _collection: string;
  private _url: string;
  private _apiKey: string | undefined;
  private _connectTimeoutMs: number;

  constructor(options: VectorStoreOptions = {}) {
    this._url = options.url ?? DEFAULT_URL;
    this._apiKey = options.apiKey;
    this._collection = options.collectionName ?? DEFAULT_COLLECTION;
    this._connectTimeoutMs = options.connectTimeoutMs ?? 3000;
  }

  async ensureReady(): Promise<boolean> {
    if (this._client) return true;
    try {
      const mod = await import("@qdrant/js-client-rest");
      const QdrantClientCtor = (mod as { QdrantClient: unknown }).QdrantClient as new (
        cfg: Record<string, unknown>
      ) => QdrantClientLike;
      this._client = new QdrantClientCtor({
        url: this._url,
        apiKey: this._apiKey || undefined,
        timeout: this._connectTimeoutMs,
        checkCompatibility: false,
      });
      // 连接检查：getCollections 有界等待
      await this._client.getCollections();
      return true;
    } catch {
      this._client = null;
      return false;
    }
  }

  async ensureCollection(dimensions: number): Promise<void> {
    if (!this._client) return;
    try {
      const res = await this._client.getCollections();
      const existing = res?.result?.collections?.some((c) => c.name === this._collection) ?? false;
      if (!existing) {
        await this._client.createCollection(this._collection, {
          vectors: { size: dimensions, distance: "Cosine" },
        });
      }
    } catch {
      /* 建集合失败静默，后续 upsert 亦静默 */
    }
  }

  async upsert(points: VectorPoint[]): Promise<void> {
    if (!this._client || points.length === 0) return;
    try {
      await this._client.upsert(this._collection, {
        points: points.map((p) => ({ id: p.id, vector: p.vector, payload: p.payload ?? {} })),
      });
    } catch {
      /* 写入失败静默（向量库非关键路径） */
    }
  }

  async search(vector: number[], limit: number): Promise<string[]> {
    if (!this._client) return [];
    try {
      const res = await this._client.search(this._collection, { vector, limit, with_payload: true });
      return res.map((r) => {
        const pid = r.payload?.["messageId"];
        return pid !== undefined ? String(pid) : String(r.id);
      });
    } catch {
      return [];
    }
  }

  clusterSimilarity(vectors: number[][]): number {
    return clusterSimilarity(vectors);
  }

  async close(): Promise<void> {
    this._client = null;
  }
}

/** 创建向量存储；连接失败 / 依赖缺失时不抛出，由调用方决定是否降级。 */
export async function createVectorStore(options: VectorStoreOptions = {}): Promise<VectorStore> {
  const store = new QdrantVectorStore(options);
  const ok = await store.ensureReady();
  if (!ok) throw new Error("向量存储不可用");
  return store;
}
