/** 记忆检索（ADR-0005 / T6，TS 版，迁移自 storage/retriever.py）。
 * 轻量召回三管并用：规则关键词召回 + Agent 主动工具读取 + 分层摘要兜底。 */
import type { MemoryStore } from "./memory_store.js";

export const MEMORY_RETRIEVAL_MODE_ENV = "MEMORY_RETRIEVAL_MODE";
export const MEMORY_RETRIEVAL_MODE_DEFAULT = "keyword";

export interface MemoryHit {
  kind: string;
  data: Record<string, unknown>;
}

export interface MemoryRetriever {
  retrieve(
    projectId: string,
    opts?: { query?: string; state?: string; source?: string; limit?: number }
  ): MemoryHit[];
  injectAll(projectId: string, opts?: { state?: string; limit?: number }): MemoryHit[];
}

export class KeywordMemoryRetriever implements MemoryRetriever {
  private _memory: MemoryStore;

  constructor(memory: MemoryStore) {
    this._memory = memory;
  }

  retrieve(
    projectId: string,
    opts: { query?: string; state?: string; source?: string; limit?: number } = {}
  ): MemoryHit[] {
    const query = opts.query ?? "";
    const limit = opts.limit ?? 20;
    const results: MemoryHit[] = [];

    const facts = this._memory.findFacts(projectId, {
      state: opts.state,
      source: opts.source,
      keyword: query,
    });
    for (const f of facts) results.push({ kind: "fact", data: f });

    for (const f of this._memory.listForeshadow(projectId)) {
      if (query && typeof f.desc === "string" && !f.desc.includes(query)) continue;
      results.push({ kind: "foreshadow", data: f });
    }

    const seen = new Set<string>();
    const dedup: MemoryHit[] = [];
    for (const item of results) {
      const rid = String(item.data.id ?? "");
      if (seen.has(rid)) continue;
      seen.add(rid);
      dedup.push(item);
      if (dedup.length >= limit) break;
    }
    return dedup;
  }

  injectAll(projectId: string, opts: { state?: string; limit?: number } = {}): MemoryHit[] {
    const limit = opts.limit ?? 10;
    const results: MemoryHit[] = [];
    for (const f of this._memory.activeForeshadow(projectId)) {
      results.push({ kind: "active_foreshadow", data: f });
      if (results.length >= limit) break;
    }
    if (results.length < limit) {
      for (const f of this._memory.findFacts(projectId, { state: opts.state })) {
        results.push({ kind: "fact", data: f });
        if (results.length >= limit) break;
      }
    }
    return results;
  }
}

export function createRetriever(memory: MemoryStore): MemoryRetriever {
  const mode = (process.env[MEMORY_RETRIEVAL_MODE_ENV] ?? MEMORY_RETRIEVAL_MODE_DEFAULT).trim().toLowerCase();
  if (mode === "keyword") return new KeywordMemoryRetriever(memory);
  if (mode === "vector") {
    console.warn("vector 检索模式为 Not-yet 可选项，暂回退 keyword");
    return new KeywordMemoryRetriever(memory);
  }
  console.warn(`未知检索模式 '${mode}'，回退 keyword`);
  return new KeywordMemoryRetriever(memory);
}
