/**
 * 本地多语言 Embedding 服务（工单 06）。
 *
 * 独立服务模块：仅负责「文本 → 向量」。
 * - 模型：paraphrase-multilingual-MiniLM-L12-v2（384 维，多语言，本地离线）
 * - 运行时：@xenova/transformers（纯 JS / ONNX，免 Python 环境）
 * - 模型加载失败 / 未安装依赖时 ensureReady 返回 false，由上层降级，绝不抛出阻断主流程。
 *
 * 运行时切换接口：所有消费方依赖本文件导出的 EmbeddingService 接口，
 * 可通过 createEmbeddingService 替换实现（例如后续切换其它本地 / 远程模型）。
 */

const DEFAULT_MODEL = "Xenova/paraphrase-multilingual-MiniLM-L12-v2";
const DEFAULT_DIMENSIONS = 384;

export interface EmbeddingService {
  readonly modelName: string;
  readonly dimensions: number;
  /** 异步初始化（首次加载模型可能下载权重）；失败返回 false，不抛出。 */
  ensureReady(): Promise<boolean>;
  /** 批量文本向量化；未就绪时抛出（调用方需先 ensureReady）。 */
  embed(texts: string[]): Promise<number[][]>;
}

export interface EmbeddingServiceOptions {
  /** 模型标识（HuggingFace 仓库名），默认 Xenova/paraphrase-multilingual-MiniLM-L12-v2 */
  modelName?: string;
  /** 向量维度（与模型输出对齐），默认 384 */
  dimensions?: number;
  /** 模型缓存目录（默认取用户配置目录下 models/，可被 env 覆盖） */
  cacheDir?: string;
  /** 是否允许本地模型文件，默认 true（优先走本地缓存，避免每次联网） */
  allowLocalModels?: boolean;
  /** 首次加载超时（ms），默认 60000 */
  loadTimeoutMs?: number;
}

interface TransformersModule {
  pipeline?: (...args: unknown[]) => Promise<unknown>;
  env?: Record<string, unknown>;
}

type ExtractorFn = (texts: string[] | string, options?: { pooling?: string; normalize?: boolean }) => Promise<{
  tolist: () => number[][];
}>;

export class TransformersEmbeddingService implements EmbeddingService {
  readonly modelName: string;
  readonly dimensions: number;
  private _extractor: ExtractorFn | null = null;
  private _cacheDir: string | undefined;
  private _loadTimeoutMs: number;

  constructor(options: EmbeddingServiceOptions = {}) {
    this.modelName = options.modelName ?? DEFAULT_MODEL;
    this.dimensions = options.dimensions ?? DEFAULT_DIMENSIONS;
    this._cacheDir = options.cacheDir;
    this._loadTimeoutMs = options.loadTimeoutMs ?? 60000;
  }

  async ensureReady(): Promise<boolean> {
    if (this._extractor) return true;
    try {
      const mod = (await import("@xenova/transformers")) as TransformersModule;
      if (!mod.pipeline) return false;
      if (mod.env && this._cacheDir) mod.env.cacheDir = this._cacheDir;
      if (mod.env) mod.env.allowLocalModels = true;
      const pipeline = mod.pipeline.bind(mod);
      this._extractor = (await this._withTimeout(
        pipeline("feature-extraction", this.modelName) as Promise<unknown>,
        this._loadTimeoutMs
      )) as unknown as ExtractorFn;
      return true;
    } catch {
      this._extractor = null;
      return false;
    }
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (!this._extractor) {
      const ok = await this.ensureReady();
      if (!ok) throw new Error("Embedding 服务未就绪，无法向量化");
    }
    const output = await this._extractor!(texts, { pooling: "mean", normalize: true });
    const list = output.tolist();
    if (!Array.isArray(list) || list.length !== texts.length) {
      throw new Error("Embedding 输出维度异常");
    }
    return list;
  }

  private _withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Embedding 模型加载超时")), ms);
      promise.then(
        (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        (e) => {
          clearTimeout(timer);
          reject(e);
        }
      );
    });
  }
}

/** 创建 Embedding 服务；依赖缺失 / 加载失败时不抛出，由调用方决定是否降级。 */
export async function createEmbeddingService(options: EmbeddingServiceOptions = {}): Promise<EmbeddingService> {
  const service = new TransformersEmbeddingService(options);
  const ok = await service.ensureReady();
  if (!ok) throw new Error("Embedding 服务不可用");
  return service;
}
