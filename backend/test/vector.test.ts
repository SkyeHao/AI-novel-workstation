import { describe, expect, it } from "vitest";
import { cosine, clusterSimilarity } from "../src/vector/store.js";
import type { VectorStore } from "../src/vector/store.js";
import type { EmbeddingService } from "../src/vector/embedding.js";
import { VectorDiscussionContext } from "../src/vector/context.js";
import type { ChatMember, ChatMessageRecord } from "../src/workflow/chat_session.js";

class FakeEmbedding implements EmbeddingService {
  modelName = "fake";
  dimensions = 3;
  ready = true;
  route: (text: string) => number[];
  constructor(route: (text: string) => number[]) {
    this.route = route;
  }
  async ensureReady(): Promise<boolean> {
    return this.ready;
  }
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.route(t));
  }
}

class FakeStore implements VectorStore {
  name = "fake";
  async ensureReady(): Promise<boolean> {
    return true;
  }
  async ensureCollection(): Promise<void> {}
  async upsert(): Promise<void> {}
  async search(): Promise<string[]> {
    return [];
  }
  clusterSimilarity(vectors: number[][]): number {
    return clusterSimilarity(vectors);
  }
  async close(): Promise<void> {}
}

const MEMBERS: ChatMember[] = [
  { id: "r1", kind: "agent", name: "主角线", description: "专注主角成长", category: "proposer" },
  { id: "r2", kind: "agent", name: "情感线", description: "专注感情戏", category: "proposer" },
];

function msg(id: string, memberId: string, content: string): ChatMessageRecord {
  return {
    id,
    sessionId: "s",
    memberId,
    memberName: memberId,
    kind: "agent",
    content,
    timestamp: "t",
  };
}

describe("vector（工单 06：余弦相似度与簇内相似度纯函数）", () => {
  it("cosine：相同向量≈1、正交≈0、空向量为 0", () => {
    expect(cosine([1, 0, 0], [1, 0, 0])).toBeCloseTo(1, 5);
    expect(cosine([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 5);
    expect(cosine([1, 0, 0], [0, 1, 0])).toBeCloseTo(0, 5);
    expect(cosine([0, 0, 0], [1, 0, 0])).toBe(0);
  });

  it("clusterSimilarity：一致向量≈1、分散向量更低、空集为 0", () => {
    expect(clusterSimilarity([[1, 0, 0], [1, 0, 0], [1, 0, 0]])).toBeCloseTo(1, 5);
    const spread = clusterSimilarity([[1, 0, 0], [0, 1, 0], [0, 0, 1]]);
    // 三个互相正交的向量对质心相似度 ≈ 1/√3 ≈ 0.577，明显低于完全一致
    expect(spread).toBeLessThan(0.9);
    expect(spread).toBeGreaterThan(0);
    expect(clusterSimilarity([])).toBe(0);
  });
});

describe("VectorDiscussionContext（工单 06：向量讨论上下文）", () => {
  it("未就绪时 relevance 回退关键词；就绪后按画像向量与最近发言的相似度打分", async () => {
    const embedding = new FakeEmbedding((t) => (t.includes("主角") ? [1, 0, 0] : [0, 1, 0]));
    const ctx = new VectorDiscussionContext({ embedding, store: new FakeStore(), random: () => 0.5 });

    // 未就绪：走关键词降级（画像命中关键词得分 > 0）
    expect(ctx.ready).toBe(false);
    expect(ctx.relevance(MEMBERS[0]!, "关于主角的讨论")).toBeGreaterThan(0);

    await ctx.ensureReady(MEMBERS, {});
    expect(ctx.ready).toBe(true);

    await ctx.trackText("m1", "关于主角的讨论");
    expect(ctx.relevance(MEMBERS[0]!, "关于主角的讨论")).toBe(50); // 画像[1,0,0] vs 最近[1,0,0]
    expect(ctx.relevance(MEMBERS[1]!, "关于主角的讨论")).toBe(0); // 画像[0,1,0] 正交
  });

  it("convergence：就绪后按向量聚类判定，趋同为 true、分散为 false", async () => {
    const same = new VectorDiscussionContext({
      embedding: new FakeEmbedding(() => [1, 0, 0]),
      store: new FakeStore(),
      convergenceThreshold: 0.75,
    });
    await same.ensureReady(MEMBERS, {});
    await same.trackText("m1", "应当加强主线");
    await same.trackText("m2", "主线需要推进");
    expect(same.convergence([msg("m1", "r1", "应当加强主线"), msg("m2", "r2", "主线需要推进")])).toBe(true);

    const spread = new VectorDiscussionContext({
      embedding: new FakeEmbedding((t) => (t.includes("情感") ? [0, 1, 0] : [1, 0, 0])),
      store: new FakeStore(),
      convergenceThreshold: 0.75,
    });
    await spread.ensureReady(MEMBERS, {});
    await spread.trackText("m1", "加强主线");
    await spread.trackText("m2", "侧重情感");
    expect(spread.convergence([msg("m1", "r1", "加强主线"), msg("m2", "r2", "侧重情感")])).toBe(false);
  });

  it("convergence 未就绪时按跨成员表态一致降级（关键词 / 高自评）", async () => {
    const embedding = new FakeEmbedding(() => [1, 0, 0]);
    embedding.ready = false;
    const ctx = new VectorDiscussionContext({ embedding, store: new FakeStore(), random: () => 0.5 });

    expect(
      ctx.convergence([
        msg("m1", "r1", "我同意这个方向"),
        msg("m2", "r2", "我赞成，就这么定"),
      ])
    ).toBe(true);

    expect(
      ctx.convergence([
        msg("m1", "r1", "没有共识关键词"),
        msg("m2", "r2", "也没有"),
      ])
    ).toBe(false);
  });
});
