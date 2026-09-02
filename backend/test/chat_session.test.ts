import { describe, expect, it, vi } from "vitest";
import { ChatSession } from "../src/workflow/chat_session.js";
import type { ChatSessionEvent, ChatMember, ChatMessageRecord } from "../src/workflow/chat_session.js";
import { SpeakerScheduler } from "../src/workflow/speaker_scheduler.js";
import type { LLMClient } from "../src/llm/client.js";
import type { EmbeddingService } from "../src/vector/embedding.js";
import { clusterSimilarity, type VectorPoint, type VectorStore } from "../src/vector/store.js";

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

class FakeVectorStore implements VectorStore {
  name = "fake";
  points: VectorPoint[] = [];
  async ensureReady(): Promise<boolean> {
    return true;
  }
  async ensureCollection(): Promise<void> {}
  async upsert(points: VectorPoint[]): Promise<void> {
    this.points.push(...points);
  }
  async search(): Promise<string[]> {
    return [];
  }
  clusterSimilarity(vectors: number[][]): number {
    return clusterSimilarity(vectors);
  }
  async close(): Promise<void> {}
}

class FakeLLMClient {
  config = { model: "fake", apiKey: "fake", baseUrl: "fake", temperature: 0, maxTokens: 100, timeout: 10, maxRetries: 0 };
  calls: Array<{ content: string; systemPrompt?: string; userPrompt?: string }> = [];
  failWith: Error | null = null;
  /** 按序弹出的回复队列；耗尽后回退到默认发言 */
  replies: string[] = [];
  private gate: Promise<void> | null = null;
  private resolveGate: (() => void) | null = null;

  /** 让下一次 achat 挂起，直到 release() */
  hold(): void {
    if (this.gate) return;
    this.gate = new Promise<void>((r) => {
      this.resolveGate = r;
    });
  }

  release(): void {
    this.resolveGate?.();
    this.resolveGate = null;
    this.gate = null;
  }

  count_tokens(): number {
    return 0;
  }

  count_text_tokens(text: string): number {
    return text.length;
  }

  async achat(messages: Array<{ role: string; content?: string; name?: string | null }>): Promise<{ content: string; model: string }> {
    const name = (messages[0] as { name?: string | null } | undefined)?.name ?? "角色";
    const systemPrompt = (messages[0] as { content?: string } | undefined)?.content ?? "";
    const userPrompt = (messages[1] as { content?: string } | undefined)?.content ?? "";
    this.calls.push({ content: name, systemPrompt, userPrompt });
    if (this.gate) await this.gate;
    if (this.failWith) throw this.failWith;
    const content = this.replies.length > 0 ? this.replies.shift()! : "这是「" + name + "」的发言";
    return { content, model: "fake" };
  }

  /** 流式接口：按字符逐段吐出回复，与 achat 共用回复队列 / gate / 异常注入。 */
  async *astream(
    messages: Array<{ role: string; content?: string; name?: string | null }>,
    _kwargs?: Record<string, unknown>,
    onDelta?: (delta: { content?: string | null }) => void,
    signal?: AbortSignal
  ): AsyncGenerator<string> {
    const name = (messages[0] as { name?: string | null } | undefined)?.name ?? "角色";
    const systemPrompt = (messages[0] as { content?: string } | undefined)?.content ?? "";
    const userPrompt = (messages[1] as { content?: string } | undefined)?.content ?? "";
    this.calls.push({ content: name, systemPrompt, userPrompt });
    if (this.gate) await this.gate;
    if (this.failWith) throw this.failWith;
    const content = this.replies.length > 0 ? this.replies.shift()! : "这是「" + name + "」的发言";
    for (const ch of content) {
      if (signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
      if (onDelta) onDelta({ content: ch });
      yield ch;
    }
  }

  close(): void {}
}

function makeMembers(): ChatMember[] {
  return [
    { id: "r1", kind: "agent", name: "冲突制造者", description: "专注于戏剧冲突", category: "proposer", systemPrompt: "你是冲突制造者" },
    { id: "r2", kind: "agent", name: "情感锚点", description: "确保人物动机可信", category: "proposer", systemPrompt: "你是情感锚点" },
  ];
}

function makeMembersWithSynthesizer(): ChatMember[] {
  return [
    ...makeMembers(),
    { id: "r3", kind: "agent", name: "合成者", description: "整理讨论成果", category: "synthesizer", systemPrompt: "你是合成者" },
  ];
}

describe("ChatSession（工单 01：群聊骨架）", () => {
  it("状态流转 idle→running→completed；事件按序 system → chat_message → done", async () => {
    const events: ChatSessionEvent[] = [];
    const fake = new FakeLLMClient();
    const session = new ChatSession({
      projectId: "proj-1",
      topic: "第 10 章应该发生什么危机",
      members: makeMembers(),
      llm: fake as unknown as LLMClient,
      now: () => 0,
      random: () => 0.5,
      cooldownMs: 10,
      idleTimeoutMs: 20,
      maxRounds: 2,
      onEvent: (e) => events.push(e),
    });

    expect(session.getStatus()).toBe("idle");
    await session.start();
    expect(session.getStatus()).toBe("completed");

    const types = events.map((e) => e.type);
    expect(types[0]).toBe("system");
    expect(types[types.length - 1]).toBe("done");
    expect(types).toContain("chat_message");

    // 两位 Agent 各发言一次
    const chatMsgs = events.filter((e) => e.type === "chat_message") as Array<{ type: "chat_message"; data: ChatMessageRecord }>;
    expect(chatMsgs.length).toBe(2);
    expect(chatMsgs[0]!.data.kind).toBe("agent");
    expect(chatMsgs[0]!.data.memberName).toBe("冲突制造者");

    // 内部消息记录一致
    expect(session.getMessages().length).toBe(2);
  });

  it("重复 start 抛出错误", async () => {
    const fake = new FakeLLMClient();
    const session = new ChatSession({
      projectId: "proj-1",
      topic: "t",
      members: makeMembers(),
      llm: fake as unknown as LLMClient,
      now: () => 0,
      random: () => 0.5,
      cooldownMs: 10,
      maxRounds: 1,
    });
    await session.start();
    expect(() => session.start()).toThrow(/已结束|运行/);
  });

  it("运行中 stop 进入 terminated，不产出 done", async () => {
    const events: ChatSessionEvent[] = [];
    const fake = new FakeLLMClient();
    fake.hold();
    const session = new ChatSession({
      projectId: "proj-1",
      topic: "t",
      members: makeMembers(),
      llm: fake as unknown as LLMClient,
      now: () => 0,
      random: () => 0.5,
      cooldownMs: 10,
      idleTimeoutMs: 20,
      maxRounds: 2,
      onEvent: (e) => events.push(e),
    });

    const p = session.start();
    await vi.waitFor(() => expect(fake.calls.length).toBe(1));
    session.stop();
    fake.release();
    await p;

    expect(session.getStatus()).toBe("terminated");
    expect(events.some((e) => e.type === "done")).toBe(false);
    expect(events.some((e) => e.type === "system" && /终止/.test(e.data.message))).toBe(true);
  });

  it("LLM 异常时发出 error 事件且会话进入 terminated", async () => {
    const events: ChatSessionEvent[] = [];
    const fake = new FakeLLMClient();
    fake.failWith = new Error("LLM 连接失败");
    const session = new ChatSession({
      projectId: "proj-1",
      topic: "t",
      members: makeMembers(),
      llm: fake as unknown as LLMClient,
      onEvent: (e) => events.push(e),
    });

    await session.start();
    expect(session.getStatus()).toBe("terminated");
    const err = events.find((e) => e.type === "error");
    expect(err).toBeTruthy();
    expect((err!.data as { error: string }).error).toContain("LLM 连接失败");
  });

  it("作者消息实时插入并上屏（不影响当前 Agent 生成）", async () => {
    const events: ChatSessionEvent[] = [];
    const fake = new FakeLLMClient();
    fake.hold();
    const session = new ChatSession({
      projectId: "proj-1",
      topic: "t",
      members: makeMembers(),
      llm: fake as unknown as LLMClient,
      now: () => 0,
      random: () => 0.5,
      cooldownMs: 10,
      idleTimeoutMs: 20,
      maxRounds: 2,
      onEvent: (e) => events.push(e),
    });

    const p = session.start();
    await vi.waitFor(() => expect(fake.calls.length).toBe(1));
    const msg = await session.sendUserMessage("作者说：请注意设定一致性");
    fake.release();
    await p;

    expect(msg.kind).toBe("author");
    expect(session.getMessages().some((m) => m.memberId === "author")).toBe(true);
    const authorMsg = events.find((e) => e.type === "chat_message" && e.data.kind === "author");
    expect(authorMsg).toBeTruthy();
    // 已完成的 Agent 生成不受影响
    expect(session.getMessages().filter((m) => m.kind === "agent").length).toBe(2);
  });
});

describe("ChatSession（工单 02：意愿度调度）", () => {
  it("任一时刻仅一位 Agent 在生成，无并发生成", async () => {
    const events: ChatSessionEvent[] = [];
    const fake = new FakeLLMClient();
    fake.hold();
    const session = new ChatSession({
      projectId: "proj-2",
      topic: "t",
      members: makeMembers(),
      llm: fake as unknown as LLMClient,
      now: () => 0,
      random: () => 0.5,
      cooldownMs: 10,
      idleTimeoutMs: 20,
      maxRounds: 2,
      onEvent: (e) => events.push(e),
    });

    const p = session.start();
    // 第一个生成被 gate 卡住（thinking/generating 中）
    await vi.waitFor(() => expect(fake.calls.length).toBe(1));

    // 卡住期间不应有第二个 Agent 开始生成
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(fake.calls.length).toBe(1);
    const generating = events.filter((e) => e.type === "agent_status" && e.data.status === "generating");
    expect(generating.length).toBe(1);

    fake.release();
    await p;
    expect(session.getMessages().filter((m) => m.kind === "agent").length).toBe(2);
  });

  it("冷却生效：刚发言者在冷却期内让位给未发言成员", async () => {
    const events: ChatSessionEvent[] = [];
    const fake = new FakeLLMClient();
    const session = new ChatSession({
      projectId: "proj-2",
      topic: "t",
      members: makeMembers(),
      llm: fake as unknown as LLMClient,
      now: () => 0,
      random: () => 0.5,
      maxRounds: 2,
      onEvent: (e) => events.push(e),
    });

    await session.start();
    const speakers = events.filter((e) => e.type === "speaker").map((e) => e.data.memberId);
    // 初始 tie-break 让 r1 先发言；随后 r1 冷却让位给 r2
    expect(speakers).toEqual(["r1", "r2"]);
  });

  it("30s 兜底：全部成员冷却中时强制最高分者开口，不冷场", async () => {
    const events: ChatSessionEvent[] = [];
    const fake = new FakeLLMClient();
    const session = new ChatSession({
      projectId: "proj-2",
      topic: "t",
      members: makeMembers(),
      llm: fake as unknown as LLMClient,
      now: () => 0,
      random: () => 0.5,
      maxRounds: 3,
      cooldownMs: 60000,
      idleTimeoutMs: 100,
      onEvent: (e) => events.push(e),
    });

    await session.start();
    const speakers = events.filter((e) => e.type === "speaker").map((e) => e.data.memberId);
    // 前两轮 r1/r2 各发言一次后全部进入冷却，第三轮由兜底强制开口
    expect(speakers.length).toBe(3);
    expect(session.getMessages().length).toBe(3);
    const third = events.filter((e) => e.type === "speaker")[2]!.data;
    // 被兜底强制开口者处于冷却中（cooldown < 0），证明兜底无视冷却
    expect(third.scores.cooldown).toBeLessThan(0);
  });

  it("speaker 事件含得分明细，agent_status 反映思考/生成/完成", async () => {
    const events: ChatSessionEvent[] = [];
    const fake = new FakeLLMClient();
    const session = new ChatSession({
      projectId: "proj-2",
      topic: "t",
      members: makeMembers(),
      llm: fake as unknown as LLMClient,
      now: () => 0,
      random: () => 0.5,
      maxRounds: 2,
      onEvent: (e) => events.push(e),
    });

    await session.start();
    const speakers = events.filter((e) => e.type === "speaker");
    expect(speakers.length).toBe(2);
    for (const s of speakers) {
      const sc = s.data.scores;
      expect(sc).toHaveProperty("mention");
      expect(sc).toHaveProperty("wait");
      expect(sc).toHaveProperty("relevance");
      expect(sc).toHaveProperty("trait");
      expect(sc).toHaveProperty("cooldown");
      expect(sc).toHaveProperty("random");
      expect(sc).toHaveProperty("total");
      expect(typeof s.data.reason).toBe("string");
      expect(s.data.reason.length).toBeGreaterThan(0);
    }
    const statuses = events.filter((e) => e.type === "agent_status").map((e) => e.data.status);
    expect(statuses).toContain("thinking");
    expect(statuses).toContain("generating");
    expect(statuses).toContain("idle");
  });
});

describe("SpeakerScheduler（工单 02 意愿度计算）", () => {
  it("等待加成：久未发言者得分随等待时间上升", () => {
    let clock = 0;
    const scheduler = new SpeakerScheduler(makeMembers(), {
      now: () => clock,
      random: () => 0.5,
      cooldownMs: 0,
    });
    scheduler.start(); // startedAt = 0
    clock = 1000;
    scheduler.recordTurn("r1"); // r1 刚发言
    clock = 6000; // r1 等了 5s，r2 等了 6s（从会话开始未发言）
    const scores = scheduler.computeScores();
    const r1 = scores.find((s) => s.member.id === "r1")!;
    const r2 = scores.find((s) => s.member.id === "r2")!;
    expect(r1.breakdown.wait).toBe(5);
    expect(r2.breakdown.wait).toBe(6);
    expect(r2.breakdown.wait).toBeGreaterThan(r1.breakdown.wait);
  });

  it("冷却生效：刚发言者在冷却期内不被选为下一位", () => {
    let clock = 0;
    const scheduler = new SpeakerScheduler(makeMembers(), {
      now: () => clock,
      random: () => 0.5,
      cooldownMs: 20000,
    });
    scheduler.start();
    clock = 1000;
    scheduler.recordTurn("r1");
    expect(scheduler.pickNext()!.id).toBe("r2");
  });

  it("@ 召唤：被 @ 者获得强意愿加成，优先发言（无视冷却）并在发言后清除", () => {
    let clock = 0;
    const scheduler = new SpeakerScheduler(makeMembers(), {
      now: () => clock,
      random: () => 0.5,
      cooldownMs: 60000,
    });
    scheduler.start();
    clock = 1000;
    scheduler.recordTurn("r1"); // r1 进入冷却
    scheduler.mention("r1");
    expect(scheduler.pickNext()!.id).toBe("r1"); // 无视冷却
    // @ 加成在发言后清除
    scheduler.recordTurn("r1");
    const after = scheduler.computeScores().find((s) => s.member.id === "r1")!.breakdown.mention;
    expect(after).toBe(0);
  });

  it("forceHighest：全部冷却时 pickNext 返回 null，兜底仍可返回最高分者", () => {
    let clock = 0;
    const scheduler = new SpeakerScheduler(makeMembers(), {
      now: () => clock,
      random: () => 0.5,
      cooldownMs: 60000,
    });
    scheduler.start();
    clock = 1000;
    scheduler.recordTurn("r1");
    scheduler.recordTurn("r2");
    expect(scheduler.pickNext()).toBeNull();
    expect(scheduler.forceHighest()).toBeTruthy();
  });
});

describe("ChatSession（工单 03：作者参与 + @ 召唤）", () => {
  it("@ 召唤：作者 @ 某角色后，下一发言窗口归被 @ 者（无视冷却），得分含 mention=100", async () => {
    const events: ChatSessionEvent[] = [];
    const fake = new FakeLLMClient();
    const session = new ChatSession({
      projectId: "proj-3",
      topic: "t",
      members: makeMembers(),
      llm: fake as unknown as LLMClient,
      now: () => 0,
      random: () => 0.5,
      cooldownMs: 60000,
      idleTimeoutMs: 200,
      maxRounds: 3,
      relevanceFn: () => 0,
      onEvent: (e) => events.push(e),
    });

    const p = session.start();
    // 等 r1、r2 各发言一次，二者均进入 60s 冷却
    await vi.waitFor(() =>
      expect(events.filter((e) => e.type === "chat_message" && e.data.kind === "agent").length).toBe(2)
    );
    // 作者 @ 情感锚点(r2)：下一步应归 r2（无 @ 时 tie-break 会是 r1）
    await session.sendUserMessage("@情感锚点 请从人物动机角度补充");
    await p;

    const speakers = events.filter((e) => e.type === "speaker").map((e) => e.data.memberId);
    expect(speakers).toEqual(["r1", "r2", "r2"]);
    const third = events.filter((e) => e.type === "speaker")[2]!.data;
    expect(third.memberId).toBe("r2");
    expect(third.scores.mention).toBe(100);
  });

  it("作者消息计入上下文：后续 Agent 发言 replyTo 指向作者消息", async () => {
    const events: ChatSessionEvent[] = [];
    const fake = new FakeLLMClient();
    fake.hold();
    const session = new ChatSession({
      projectId: "proj-3",
      topic: "t",
      members: makeMembers(),
      llm: fake as unknown as LLMClient,
      now: () => 0,
      random: () => 0.5,
      cooldownMs: 60000,
      idleTimeoutMs: 200,
      maxRounds: 2,
      onEvent: (e) => events.push(e),
    });

    const p = session.start();
    await vi.waitFor(() => expect(fake.calls.length).toBe(1));
    const authorMsg = await session.sendUserMessage("作者说：请注意设定一致性");
    fake.release();
    await p;

    const agentMsgs = events.filter(
      (e) => e.type === "chat_message" && e.data.kind === "agent"
    ) as Array<{ type: "chat_message"; data: ChatMessageRecord }>;
    expect(agentMsgs.length).toBe(2);
    // 第一条 Agent 发言承接作者消息
    expect(agentMsgs[0]!.data.replyTo).toBe(authorMsg.id);
  });
});

describe("ChatSession（工单 04：共识检测与合成者总结）", () => {
  const AGREE_1 = "我同意这个方案。\n【共识度：0.9】";
  const AGREE_2 = "我也一致认可，可以定稿。\n【共识度：0.95】";
  const SUMMARY = "核心共识：第 10 章引入外部威胁。\n主要分歧：敌人身份。\n综合方案：分两幕推进。\n行动建议：先写人物反应。";

  it("连续两轮关键词+自评达成共识 → 合成者产出结构化总结 → done 带 summary", async () => {
    const events: ChatSessionEvent[] = [];
    const fake = new FakeLLMClient();
    fake.replies = [AGREE_1, AGREE_2, SUMMARY];
    const session = new ChatSession({
      projectId: "proj-4",
      topic: "t",
      members: makeMembersWithSynthesizer(),
      llm: fake as unknown as LLMClient,
      now: () => 0,
      random: () => 0.5,
      cooldownMs: 10,
      idleTimeoutMs: 20,
      maxRounds: 4,
      onEvent: (e) => events.push(e),
    });

    await session.start();
    expect(session.getStatus()).toBe("completed");

    // 仅两位 Agent 各发言一次后即进入合成，无需跑满预算
    const speakers = events.filter((e) => e.type === "speaker").map((e) => e.data.memberId);
    expect(speakers).toEqual(["r1", "r2"]);

    const systemText = events
      .filter((e) => e.type === "system")
      .map((e) => e.data.message)
      .join("\n");
    expect(systemText).toContain("已达成共识");
    expect(systemText).toContain("合成者");

    const done = events.find((e) => e.type === "done")!;
    expect((done.data as { status: string; summary?: string }).status).toBe("completed");
    expect((done.data as { status: string; summary?: string }).summary).toBe(SUMMARY);

    // 过程消息剥离自评行上屏
    const msgs = events.filter(
      (e) => e.type === "chat_message" && e.data.kind === "agent"
    ) as Array<{ data: ChatMessageRecord }>;
    expect(msgs[0]!.data.content).not.toContain("共识度");
    expect(msgs[0]!.data.content).toContain("我同意这个方案");
  });

  it("仅一轮达成共识不触发合成（需连续两轮）", async () => {
    const events: ChatSessionEvent[] = [];
    const fake = new FakeLLMClient();
    fake.replies = [AGREE_1];
    const session = new ChatSession({
      projectId: "proj-4",
      topic: "t",
      members: makeMembersWithSynthesizer(),
      llm: fake as unknown as LLMClient,
      now: () => 0,
      random: () => 0.5,
      cooldownMs: 10,
      idleTimeoutMs: 20,
      maxRounds: 1,
      onEvent: (e) => events.push(e),
    });

    await session.start();
    expect(session.getStatus()).toBe("completed");
    const done = events.find((e) => e.type === "done")!;
    expect((done.data as { status: string; summary?: string }).summary).toBeUndefined();
    expect(events.some((e) => e.type === "system" && /已达成共识/.test(e.data.message))).toBe(false);
  });

  it("无合成者成员时达成共识也不触发合成", async () => {
    const events: ChatSessionEvent[] = [];
    const fake = new FakeLLMClient();
    fake.replies = [AGREE_1, AGREE_2];
    const session = new ChatSession({
      projectId: "proj-4",
      topic: "t",
      members: makeMembers(), // 无 synthesizer
      llm: fake as unknown as LLMClient,
      now: () => 0,
      random: () => 0.5,
      cooldownMs: 10,
      idleTimeoutMs: 20,
      maxRounds: 2,
      onEvent: (e) => events.push(e),
    });

    await session.start();
    expect(session.getStatus()).toBe("completed");
    const done = events.find((e) => e.type === "done")!;
    expect((done.data as { status: string; summary?: string }).summary).toBeUndefined();
    expect(events.some((e) => e.type === "system" && /没有合成者/.test(e.data.message))).toBe(true);
  });

  it("接近共识但未触发时推送共识预警事件", async () => {
    const events: ChatSessionEvent[] = [];
    const fake = new FakeLLMClient();
    fake.replies = ["我同意大家的意见。", "这是「情感锚点」的发言"];
    const session = new ChatSession({
      projectId: "proj-4",
      topic: "t",
      members: makeMembers(),
      llm: fake as unknown as LLMClient,
      now: () => 0,
      random: () => 0.5,
      cooldownMs: 10,
      idleTimeoutMs: 20,
      maxRounds: 2,
      onEvent: (e) => events.push(e),
    });

    await session.start();
    const warn = events.find((e) => e.type === "consensus" && /接近共识/.test(e.data.message));
    expect(warn).toBeTruthy();
    const done = events.find((e) => e.type === "done")!;
    expect((done.data as { status: string; summary?: string }).summary).toBeUndefined();
  });

  it("作者手动终止不产出伪总结（即使已接近共识）", async () => {
    const events: ChatSessionEvent[] = [];
    const fake = new FakeLLMClient();
    fake.replies = [AGREE_1];
    fake.hold();
    const session = new ChatSession({
      projectId: "proj-4",
      topic: "t",
      members: makeMembersWithSynthesizer(),
      llm: fake as unknown as LLMClient,
      now: () => 0,
      random: () => 0.5,
      cooldownMs: 10,
      idleTimeoutMs: 20,
      maxRounds: 4,
      onEvent: (e) => events.push(e),
    });

    const p = session.start();
    await vi.waitFor(() => expect(fake.calls.length).toBe(1));
    session.stop();
    fake.release();
    await p;

    expect(session.getStatus()).toBe("terminated");
    expect(events.some((e) => e.type === "done")).toBe(false);
    expect(events.some((e) => e.type === "consensus" && /开始合成/.test(e.data.message))).toBe(false);
  });
});

describe("ChatSession（工单 05：分层上下文组装）", () => {
  const STATIC = {
    worldview: "蒸汽朋克架空世界，帝国与联邦对立",
    characters: "主角林澈，机械师；配角苏婉，情报官",
    current_chapter: "第 10 章：帝国入侵边境",
  };

  function makeMembersWithContext(): ChatMember[] {
    return [
      {
        id: "r1",
        kind: "agent",
        name: "冲突制造者",
        description: "专注戏剧冲突",
        category: "proposer",
        systemPrompt: "你是冲突制造者",
        sharedContextKeys: ["worldview", "characters"],
      },
      { id: "r2", kind: "agent", name: "情感锚点", description: "关注人物情感", category: "proposer", systemPrompt: "你是情感锚点" },
    ];
  }

  it("系统提示含角色定位；静态设定按 sharedContextKeys 注入，无键角色回退全量", async () => {
    const fake = new FakeLLMClient();
    const session = new ChatSession({
      projectId: "proj-5",
      topic: "帝国入侵后的第一反应",
      members: makeMembersWithContext(),
      staticContext: STATIC,
      llm: fake as unknown as LLMClient,
      now: () => 0,
      random: () => 0.5,
      cooldownMs: 10,
      idleTimeoutMs: 20,
      maxRounds: 2,
    });
    await session.start();

    // 第 1 位：冲突制造者（r1），按自己的 sharedContextKeys 注入 worldview / characters
    const first = fake.calls[0]!.userPrompt;
    expect(fake.calls[0]!.systemPrompt).toContain("你是冲突制造者");
    expect(fake.calls[0]!.systemPrompt).toContain("专注戏剧冲突");
    expect(first).toContain("【静态设定】");
    expect(first).toContain("蒸汽朋克架空世界");
    expect(first).toContain("主角林澈");
    expect(first).not.toContain("帝国入侵边境");

    // 第 2 位：情感锚点（r2）无 sharedContextKeys → 回退全量静态设定
    const second = fake.calls[1]!.userPrompt;
    expect(second).toContain("【静态设定】");
    expect(second).toContain("帝国入侵边境");
  });

  it("作者历史指令进入 L3 全局要点，影响后续 Agent 发言", async () => {
    const fake = new FakeLLMClient();
    fake.hold();
    const session = new ChatSession({
      projectId: "proj-5",
      topic: "t",
      members: makeMembers(),
      llm: fake as unknown as LLMClient,
      now: () => 0,
      random: () => 0.5,
      cooldownMs: 10,
      idleTimeoutMs: 20,
      maxRounds: 2,
    });

    const p = session.start();
    await vi.waitFor(() => expect(fake.calls.length).toBe(1));
    await session.sendUserMessage("请确保主角动机自洽");
    fake.release();
    await p;

    expect(fake.calls.length).toBe(2);
    const second = fake.calls[1]!.userPrompt;
    expect(second).toContain("【全局要点】");
    expect(second).toContain("作者历史指令");
    expect(second).toContain("请确保主角动机自洽");
  });

  it("上下文分层顺序：静态设定 → L3 → L2 → L1 → 回应对象 → 任务", async () => {
    const fake = new FakeLLMClient();
    const session = new ChatSession({
      projectId: "proj-5",
      topic: "t",
      members: makeMembersWithContext(),
      staticContext: STATIC,
      llm: fake as unknown as LLMClient,
      now: () => 0,
      random: () => 0.5,
      cooldownMs: 10,
      idleTimeoutMs: 20,
      maxRounds: 4,
      context: { l1Count: 1, l2Count: 2 },
    });
    await session.start();

    // 最后一轮（第 4 次调用）已有足够历史：L2 与 L1 同时出现
    const last = fake.calls[3]!.userPrompt;
    const markers = ["【静态设定】", "【全局要点】", "【近期脉络】", "【最近对话】", "【回应对象】", "请作为"];
    const idx = markers.map((m) => last.indexOf(m));
    for (const i of idx) expect(i).toBeGreaterThanOrEqual(0);
    for (let i = 0; i < idx.length - 1; i++) {
      expect(idx[i]!).toBeLessThan(idx[i + 1]!);
    }
  });

  it("发言携带回应引用：replyTo 指向被回应消息，触发层含原文", async () => {
    const events: ChatSessionEvent[] = [];
    const fake = new FakeLLMClient();
    const session = new ChatSession({
      projectId: "proj-5",
      topic: "t",
      members: makeMembers(),
      llm: fake as unknown as LLMClient,
      now: () => 0,
      random: () => 0.5,
      cooldownMs: 10,
      idleTimeoutMs: 20,
      maxRounds: 3,
      onEvent: (e) => events.push(e),
    });
    await session.start();

    const agentMsgs = events.filter((e) => e.type === "chat_message" && e.data.kind === "agent") as Array<{ data: ChatMessageRecord }>;
    expect(agentMsgs.length).toBe(3);
    expect(agentMsgs[1]!.data.replyTo).toBe(agentMsgs[0]!.data.id);
    const second = fake.calls[1]!.userPrompt;
    expect(second).toContain("【回应对象】");
    expect(second).toContain("这是「冲突制造者」的发言");
  });

  it("超预算时降级：截断静态超长值并保留任务指令", async () => {
    const fake = new FakeLLMClient();
    const longStatic = { worldview: "世".repeat(600), characters: "主角林澈" };
    const session = new ChatSession({
      projectId: "proj-5",
      topic: "t",
      members: makeMembersWithContext(),
      staticContext: longStatic,
      llm: fake as unknown as LLMClient,
      now: () => 0,
      random: () => 0.5,
      cooldownMs: 10,
      idleTimeoutMs: 20,
      maxRounds: 1,
      // askRule 变长后，任务指令占用更多预算；调大预算使「静态截断+保留任务指令」
      // 落在预期降级路径（第②步静态截断生效，避免第④步头部硬截断吞掉「已截断」标记）
      context: { maxTokens: 600, countTokens: (t: string) => Math.ceil(t.length / 2) },
    });
    await session.start();

    const first = fake.calls[0]!.userPrompt;
    expect(first).toContain("已截断");
    expect(first).toContain("请作为");
  });

  it("超预算优先压缩 L2 近期脉络（降级摘要粒度）", async () => {
    const fake = new FakeLLMClient();
    const session = new ChatSession({
      projectId: "proj-5",
      topic: "t",
      members: makeMembers(),
      llm: fake as unknown as LLMClient,
      now: () => 0,
      random: () => 0.5,
      cooldownMs: 10,
      idleTimeoutMs: 20,
      maxRounds: 4,
      context: { l1Count: 1, l2Count: 3, maxTokens: 100, countTokens: (t: string) => Math.ceil(t.length / 2) },
    });
    await session.start();

    const last = fake.calls[3]!.userPrompt;
    expect(last).toContain("近期脉络已压缩");
  });
});

describe("ChatSession（工单 06：Embedding + 向量库）", () => {
  it("话题相关性经向量嵌入真实影响意愿度：高相关成员连续优先发言（跑题拉回）", async () => {
    // r1 画像关键词「危机」，r2 画像关键词「情感」。
    // r1 的第一条发言含「情感」关键词（关键词降级会偏向 r2），
    // 但向量贴近 r1 画像（向量相关性偏向 r1）→ 证明走的是向量而非关键词。
    const route = (text: string): number[] => {
      if (text.includes("危机")) return [1, 0, 0];
      if (text.includes("思考")) return [0.9, 0.1, 0];
      return [0, 1, 0];
    };
    const fake = new FakeLLMClient();
    fake.replies = ["关于情感维度的深入思考", "关于危机维度的深入思考"];
    const members: ChatMember[] = [
      { id: "r1", kind: "agent", name: "危机线", description: "专注危机与转折", category: "proposer", systemPrompt: "你是危机线" },
      { id: "r2", kind: "agent", name: "情感线", description: "专注感情戏", category: "proposer", systemPrompt: "你是情感线" },
    ];
    const session = new ChatSession({
      projectId: "proj-6",
      topic: "主角危机讨论",
      members,
      llm: fake as unknown as LLMClient,
      vector: { embedding: new FakeEmbedding(route), store: new FakeVectorStore() },
      now: () => 0,
      random: () => 0.5,
      cooldownMs: 0,
      idleTimeoutMs: 20,
      maxRounds: 2,
    });
    await session.start();

    const speakers = session
      .getMessages()
      .filter((m) => m.kind === "agent")
      .map((m) => m.memberName);
    expect(speakers[0]).toBe("危机线");
    // 第二轮：最近发言「关于情感维度的深入思考」含「情感」关键词，关键词会偏向情感线；
    // 但向量贴近「危机线」画像 → 危机线再次发言，证明向量相关性生效
    expect(speakers[1]).toBe("危机线");
  });

  it("观点收敛经向量聚类触发共识：无关键词 / 低自评仅凭向量趋同即合成", async () => {
    const route = (text: string): number[] => {
      if (text.includes("主线")) return [1, 0, 0];
      return [0, 1, 0];
    };
    const fake = new FakeLLMClient();
    // 3 条 Agent 发言（都不含共识关键词、不带自评），第 4 条给合成者
    fake.replies = [
      "应当加强主线节奏",
      "主线冲突需要再推进一步",
      "主线节奏与冲突密度再强化",
      "核心共识：主线节奏与冲突密度；综合方案：同步推进情感线。",
    ];
    const session = new ChatSession({
      projectId: "proj-6",
      topic: "主线推进",
      members: makeMembersWithSynthesizer(),
      llm: fake as unknown as LLMClient,
      vector: { embedding: new FakeEmbedding(route), store: new FakeVectorStore() },
      consensus: { requiredStreak: 2 },
      now: () => 0,
      random: () => 0.5,
      cooldownMs: 10,
      idleTimeoutMs: 20,
      maxRounds: 4,
    });
    const events: ChatSessionEvent[] = [];
    session.subscribe((e) => events.push(e));
    await session.start();

    // Agent 发言不含任何共识关键词与自评 → 收敛完全由向量聚类驱动
    const agentMsgs = session
      .getMessages()
      .filter((m) => m.kind === "agent")
      .map((m) => m.content);
    expect(agentMsgs.length).toBe(3);
    expect(agentMsgs.every((c) => !/(同意|一致|共识|认同|无异议|赞成)/.test(c))).toBe(true);
    expect(agentMsgs.every((c) => !/【共识度/.test(c))).toBe(true);

    // 达成共识并触发合成者总结
    expect(events.some((e) => e.type === "consensus" && /开始合成/.test(e.data.message))).toBe(true);
    const done = events.find((e) => e.type === "done") as { data: { status: string; summary?: string } } | undefined;
    expect(done?.data.status).toBe("completed");
    expect(done?.data.summary ?? "").toContain("核心共识");
  });

  it("Embedding 不可用时自动降级：讨论照常完成不报错", async () => {
    const embedding = new FakeEmbedding(() => [1, 0, 0]);
    embedding.ready = false; // ensureReady 返回 false
    const fake = new FakeLLMClient();
    const session = new ChatSession({
      projectId: "proj-6",
      topic: "t",
      members: makeMembers(),
      llm: fake as unknown as LLMClient,
      vector: { embedding, store: new FakeVectorStore(), readyTimeoutMs: 200 },
      now: () => 0,
      random: () => 0.5,
      cooldownMs: 10,
      idleTimeoutMs: 20,
      maxRounds: 2,
    });
    await session.start();

    expect(session.getStatus()).toBe("completed");
    expect(session.getMessages().length).toBe(2);
  });
});

describe("ChatSession（工单 09：流式输出）", () => {
  const AGREE_1 = "我同意这个方案。\n【共识度：0.9】";
  const AGREE_2 = "我也一致认可，可以定稿。\n【共识度：0.95】";
  const SUMMARY =
    "核心共识：第 10 章引入外部威胁。\n主要分歧：敌人身份。\n综合方案：分两幕推进。\n行动建议：先写人物反应。";

  it("发言流式输出：delta 累计递增，最终 chat_message 完整且剥离自评行", async () => {
    const events: ChatSessionEvent[] = [];
    const fake = new FakeLLMClient();
    fake.replies = [AGREE_1];
    const session = new ChatSession({
      projectId: "proj-9",
      topic: "t",
      members: makeMembers(),
      llm: fake as unknown as LLMClient,
      now: () => 0,
      random: () => 0.5,
      cooldownMs: 10,
      idleTimeoutMs: 20,
      maxRounds: 1,
      onEvent: (e) => events.push(e),
    });

    await session.start();
    const deltas = events.filter((e) => e.type === "delta");
    expect(deltas.length).toBeGreaterThan(1);

    // 累计内容：后一帧包含前一帧，逐字增长
    const contents = deltas.map((e) => e.data.content);
    for (let i = 1; i < contents.length; i++) {
      expect(contents[i]!.startsWith(contents[i - 1]!)).toBe(true);
      expect(contents[i]!.length).toBeGreaterThan(contents[i - 1]!.length);
    }

    // 最后一帧为完整原文（含自评行）且标记 done
    expect(contents[contents.length - 1]).toBe(AGREE_1);
    expect(deltas[deltas.length - 1]!.data.done).toBe(true);

    // 最终 chat_message 与 delta 共用 messageId，且剥离自评行
    const msg = events.find((e) => e.type === "chat_message")!;
    expect(msg.data.id).toBe(deltas[0]!.data.messageId);
    expect(msg.data.content).not.toContain("共识度");
    expect(msg.data.content).toContain("我同意这个方案");
  });

  it("合成者总结流式输出：delta 逐段累积，done 带完整 summary", async () => {
    const events: ChatSessionEvent[] = [];
    const fake = new FakeLLMClient();
    fake.replies = [AGREE_1, AGREE_2, SUMMARY];
    const session = new ChatSession({
      projectId: "proj-9",
      topic: "t",
      members: makeMembersWithSynthesizer(),
      llm: fake as unknown as LLMClient,
      now: () => 0,
      random: () => 0.5,
      cooldownMs: 10,
      idleTimeoutMs: 20,
      maxRounds: 4,
      onEvent: (e) => events.push(e),
    });

    await session.start();
    const synthDeltas = events.filter(
      (e) => e.type === "delta" && e.data.memberId === "r3"
    );
    expect(synthDeltas.length).toBeGreaterThan(1);
    expect(synthDeltas[synthDeltas.length - 1]!.data.done).toBe(true);
    expect(synthDeltas[synthDeltas.length - 1]!.data.content).toBe(SUMMARY);

    const done = events.find((e) => e.type === "done")!;
    expect((done.data as { status: string; summary?: string }).summary).toBe(SUMMARY);
  });
});

describe("ChatSession（首条消息激活：标题仅作会话名）", () => {
  it("不调用 start，首条作者消息激活：idle → running → completed，标题不入提示词", async () => {
    const events: ChatSessionEvent[] = [];
    const fake = new FakeLLMClient();
    fake.replies = ["我是「冲突制造者」，基于你的要求给出方案。\n【共识度：0.8】"];
    const session = new ChatSession({
      projectId: "proj-10",
      topic: "t",
      members: makeMembers(),
      llm: fake as unknown as LLMClient,
      now: () => 0,
      random: () => 0.5,
      cooldownMs: 10,
      idleTimeoutMs: 20,
      maxRounds: 1,
      onEvent: (e) => events.push(e),
    });

    expect(session.getStatus()).toBe("idle");
    const authorPromise = session.sendUserMessage("请基于当前剧情给出建议");
    // 首条消息同步完成激活（未注入 vector，无 await 挂起点）
    expect(session.getStatus()).toBe("running");
    await authorPromise;

    // 发言循环后台运行（fire-and-forget），等待会话自然结束
    await vi.waitFor(() => expect(session.getStatus()).toBe("completed"));

    // 业务事件顺序：系统（讨论开始）→ 作者消息 → agent 消息
    const business = events.filter((e) => e.type === "system" || e.type === "chat_message");
    expect(business[0]!.type).toBe("system");
    const authorIdx = business.findIndex((e) => e.type === "chat_message" && e.data.kind === "author");
    const agentIdx = business.findIndex((e) => e.type === "chat_message" && e.data.kind === "agent");
    expect(authorIdx).toBeGreaterThanOrEqual(0);
    expect(agentIdx).toBeGreaterThan(authorIdx);

    // 首条 agent 提示：不注入「讨论主题」，任务要求保留
    const userPrompt = fake.calls[0]!.userPrompt;
    expect(userPrompt).not.toMatch(/讨论主题/);
    expect(userPrompt).toContain("请作为");
  });

  it("idle 会话可被终止（放弃空会话），结束后无法再发消息", async () => {
    const fake = new FakeLLMClient();
    const session = new ChatSession({
      projectId: "proj-10",
      topic: "t",
      members: makeMembers(),
      llm: fake as unknown as LLMClient,
      now: () => 0,
      random: () => 0.5,
    });
    expect(session.getStatus()).toBe("idle");
    session.stop();
    expect(session.getStatus()).toBe("terminated");
    await expect(session.sendUserMessage("hi")).rejects.toThrow(/已结束/);
  });
});

describe("ChatSession（工单 12：不限轮次直到达成共识）", () => {
  const AGREE_1 = "我同意这个方案。\n【共识度：0.9】";
  const AGREE_2 = "我也一致认可，可以定稿。\n【共识度：0.95】";
  const SUMMARY = "核心共识：第 10 章引入外部威胁。\n主要分歧：敌人身份。\n综合方案：分两幕推进。\n行动建议：先写人物反应。";

  it("maxRounds=0 不限轮次：达成共识后提前由合成者收束，不跑满上限", async () => {
    const events: ChatSessionEvent[] = [];
    const fake = new FakeLLMClient();
    fake.replies = [AGREE_1, AGREE_2, SUMMARY];
    const session = new ChatSession({
      projectId: "proj-12",
      topic: "t",
      members: makeMembersWithSynthesizer(),
      llm: fake as unknown as LLMClient,
      now: () => 0,
      random: () => 0.5,
      cooldownMs: 10,
      idleTimeoutMs: 20,
      maxRounds: 0,
      unlimitedMaxRounds: 4,
      onEvent: (e) => events.push(e),
    });

    await session.start();
    expect(session.getStatus()).toBe("completed");

    const done = events.find((e) => e.type === "done")!;
    expect((done.data as { status: string; summary?: string }).summary).toBe(SUMMARY);

    const systemText = events
      .filter((e) => e.type === "system")
      .map((e) => e.data.message)
      .join("\n");
    expect(systemText).toContain("已达成共识");
    expect(systemText).not.toContain("安全上限");
  });

  it("maxRounds=0 不限轮次：始终未达成共识时按安全上限强制合成收束", async () => {
    const events: ChatSessionEvent[] = [];
    const fake = new FakeLLMClient();
    const session = new ChatSession({
      projectId: "proj-12",
      topic: "t",
      members: makeMembersWithSynthesizer(),
      llm: fake as unknown as LLMClient,
      now: () => 0,
      random: () => 0.5,
      cooldownMs: 10,
      idleTimeoutMs: 20,
      maxRounds: 0,
      unlimitedMaxRounds: 3,
      onEvent: (e) => events.push(e),
    });

    await session.start();
    expect(session.getStatus()).toBe("completed");

    const systemText = events
      .filter((e) => e.type === "system")
      .map((e) => e.data.message)
      .join("\n");
    expect(systemText).toContain("安全上限");

    const done = events.find((e) => e.type === "done")!;
    expect((done.data as { status: string; summary?: string }).summary).toBeDefined();
  });
});

describe("ChatSession._extractAskToAuthor（工单 13：正文提问兜底）", () => {
  function makeSession() {
    const fake = new FakeLLMClient();
    const session = new ChatSession({
      projectId: "proj-13",
      topic: "t",
      members: makeMembers(),
      llm: fake as unknown as LLMClient,
      now: () => 0,
      random: () => 0.5,
      cooldownMs: 10,
      maxRounds: 1,
    });
    return { fake, session };
  }

  it("正文含面向作者提问时提取 question 与 A/B 候选", () => {
    const { session } = makeSession();
    const ask = (session as any)._extractAskToAuthor(
      "我建议走都市题材，A. 都市职场 B. 都市异能 C. 都市修仙，你来定一下选哪个。"
    );
    expect(ask).not.toBeNull();
    expect(ask.question).toContain("你来定");
    expect(ask.options.length).toBeGreaterThanOrEqual(1);
  });

  it("正文含「是否采用」问句时同样命中", () => {
    const { session } = makeSession();
    const ask = (session as any)._extractAskToAuthor(
      "我推荐在番茄走轻悬疑路线，是否采用这个方向？"
    );
    expect(ask).not.toBeNull();
    expect(ask.question).toContain("是否采用");
  });

  it("纯陈述、无作者提问信号时不命中", () => {
    const { session } = makeSession();
    expect((session as any)._extractAskToAuthor("我建议主角动机是复仇，这样冲突更强。")).toBeNull();
    expect((session as any)._extractAskToAuthor("")).toBeNull();
    expect((session as any)._extractAskToAuthor("   ")).toBeNull();
  });
});

describe("ChatSession（作者驳回 → 强制回到提案者）", () => {
  /** 按系统提示名区分「调度员」与成员发言的假 LLM：导演返回脚本化 ranking，成员返回脚本化正文。 */
  class RejectionFakeLLM {
    directorScript: string[] = [];
    memberScript: string[] = [];
    count_tokens(): number { return 0; }
    count_text_tokens(text: string): number { return text.length; }
    async achat(messages: Array<{ role: string; content?: string; name?: string | null }>): Promise<{ content: string; model: string }> {
      const name = (messages[0] as { name?: string | null } | undefined)?.name ?? "角色";
      if (name === "调度员") {
        return { content: this.directorScript.shift() ?? "", model: "fake" };
      }
      return { content: this.memberScript.shift() ?? "这是「" + name + "」的发言", model: "fake" };
    }
    async *astream(messages: Array<{ role: string; content?: string; name?: string | null }>): AsyncGenerator<string> {
      const name = (messages[0] as { name?: string | null } | undefined)?.name ?? "角色";
      const content = this.memberScript.shift() ?? "这是「" + name + "」的发言";
      for (const ch of content) yield ch;
    }
    close(): void {}
  }

  function waitFor(cond: () => boolean, timeoutMs = 3000): Promise<void> {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const t = setInterval(() => {
        if (cond()) {
          clearInterval(t);
          resolve();
        } else if (Date.now() - start > timeoutMs) {
          clearInterval(t);
          reject(new Error("waitFor timeout"));
        }
      }, 10);
    });
  }

  it("作者「换个方向」驳回提案后，导演即使选挑刺者也被硬规则强制回提案者", async () => {
    const events: ChatSessionEvent[] = [];
    const fake = new RejectionFakeLLM();
    // 导演脚本：第 1 次选题材舵手；作者驳回后再调度仍选魔鬼代言人（用于验证硬规则覆盖导演）
    fake.directorScript.push(JSON.stringify({ ranking: [{ member: "nav", priority: 1, reason: "提案者先给方向" }] }));
    fake.directorScript.push(JSON.stringify({ ranking: [{ member: "dev", priority: 1, reason: "从未发言，挑刺换方向" }] }));
    // 第 3 次：轮次将尽，导演任意选（合成者收束规则会接管，保证会话正常收尾）
    fake.directorScript.push(JSON.stringify({ ranking: [{ member: 'dev', priority: 1, reason: '再次挑刺' }] }));
    // 题材舵手首次发言含向作者提问 → 触发 ask 挂起；第二次（被强制拉回）给出新方向
    fake.memberScript.push("我建议题材定为都市神豪+直播。请作者确认方向：A. 采用  B. 换一个方向");
    fake.memberScript.push("新方向：都市脑洞+系统流，更契合下沉市场");

    const session = new ChatSession({
      projectId: "proj-rej",
      topic: "题材讨论",
      members: [
        { id: "nav", kind: "agent", name: "题材舵手", description: "定位题材", category: "proposer", systemPrompt: "你是题材舵手" },
        { id: "dev", kind: "agent", name: "魔鬼代言人", description: "挑刺", category: "reviewer", systemPrompt: "你是魔鬼代言人" },
        { id: "syn", kind: "agent", name: "合成者", description: "收束", category: "synthesizer", systemPrompt: "你是合成者" },
      ],
      llm: fake as unknown as LLMClient,
      now: () => 0,
      random: () => 0.5,
      cooldownMs: 10,
      idleTimeoutMs: 20,
      maxRounds: 3,
      schedulerAgent: { enabled: true },
      onEvent: (e) => events.push(e),
    });

    await session.sendUserMessage("帮我定一个适合新手的题材");
    // 题材舵手首次发言带提问 → 触发 ask 挂起等待作者
    await waitFor(() => session.hasPendingAsk);

    // 作者驳回并换方向
    await session.submitAskAnswer("换个方向再讨论");
    await waitFor(() => session.getStatus() === "completed");

    // 作者驳回后下一位 agent 发言必须是提案者「题材舵手」，而不是导演想选的魔鬼代言人
    const agentMsgs = events
      .filter((e): e is { type: "chat_message"; data: ChatMessageRecord } => e.type === "chat_message")
      .map((e) => e.data)
      .filter((m) => m.kind === "agent");
    expect(agentMsgs.length).toBeGreaterThanOrEqual(2);
    // 第 1 条为首次提案（题材舵手）
    expect(agentMsgs[0]!.memberName).toBe("题材舵手");
    // 第 2 条仍应是题材舵手（被强制拉回重新提案），而不是魔鬼代言人
    expect(agentMsgs[1]!.memberName).toBe("题材舵手");
    expect(agentMsgs[1]!.content).toContain("新方向");
    // 魔鬼代言人整场未发言（硬规则覆盖了导演的挑刺选择）
    expect(agentMsgs.some((m) => m.memberName === "魔鬼代言人")).toBe(false);

    // 存在「作者驳回强制回到提案者」的调度探针事件
    // 取触发驳回兜底的探针（turn 0 时驳回尚未发生，首个探针不含驳回态）
    const probe = events.find((e) => e.type === "scheduler_probe" && (e.data as Record<string, unknown>).rejectionForced === true);
    expect(probe).toBeDefined();
    const pd = (probe as { data: Record<string, unknown> }).data;
    expect(pd.rejectedProposerId).toBe("nav");
    expect(pd.rejectionForced).toBe(true);
  });

  /** 门控假 LLM：成员首轮 achat 挂起直到 releaseMember()，成员发言一律以 finish_turn 显式提交结论。 */
  class GatedFinishFakeLLM {
    directorScript: string[] = [];
    memberConclusions: string[] = [];
    private memberCall = 0;
    private gate: Promise<void>;
    private releaseFn: () => void = () => {};
    constructor() {
      this.gate = new Promise<void>((r) => {
        this.releaseFn = r;
      });
    }
    count_tokens(): number {
      return 0;
    }
    count_text_tokens(text: string): number {
      return text.length;
    }
    async achat(messages: Array<{ role: string; content?: string; name?: string | null }>): Promise<{ content: string; function_call?: { name: string; arguments: string }; model: string }> {
      const name = (messages[0] as { name?: string | null } | undefined)?.name ?? "角色";
      if (name === "调度员") {
        return { content: this.directorScript.shift() ?? "", model: "fake" };
      }
      this.memberCall += 1;
      // 模拟 Agent 仍在工具流中：首轮挂起，直到测试放行（证明事务期间未被调度打断）
      if (this.memberCall === 1) await this.gate;
      const conclusion = this.memberConclusions.shift() ?? "「" + name + "」的最终结论";
      return { content: "", function_call: { name: "finish_turn", arguments: JSON.stringify({ conclusion }) }, model: "fake" };
    }
    async *astream(): AsyncGenerator<string> {}
    close(): void {}
    releaseMember(): void {
      this.releaseFn();
    }
    get calls(): number {
      return this.memberCall;
    }
  }

  it("事务内作者「换个方向」排队不抢话筒：当前 Agent 提交后导演才以驳回态调回提案者", async () => {
    const events: ChatSessionEvent[] = [];
    const fake = new GatedFinishFakeLLM();
    fake.directorScript.push(JSON.stringify({ ranking: [{ member: "nav", priority: 1, reason: "提案者先给方向" }] }));
    // 第 2 次调度故意选魔鬼代言人（验证驳回硬规则覆盖导演）；第 3 次会被收束规则接管
    fake.directorScript.push(JSON.stringify({ ranking: [{ member: "dev", priority: 1, reason: "挑刺" }] }));
    fake.directorScript.push(JSON.stringify({ ranking: [{ member: "dev", priority: 1, reason: "再挑刺" }] }));
    fake.memberConclusions.push("初始提案：都市题材");
    fake.memberConclusions.push("按作者反馈调整后的新方向：玄幻题材");

    const session = new ChatSession({
      projectId: "proj-queued-reject",
      topic: "题材讨论",
      members: [
        { id: "nav", kind: "agent", name: "题材舵手", description: "定位题材", category: "proposer", systemPrompt: "你是题材舵手" },
        { id: "dev", kind: "agent", name: "魔鬼代言人", description: "挑刺", category: "reviewer", systemPrompt: "你是魔鬼代言人" },
        { id: "syn", kind: "agent", name: "合成者", description: "收束", category: "synthesizer", systemPrompt: "你是合成者" },
      ],
      llm: fake as unknown as LLMClient,
      now: () => 0,
      random: () => 0.5,
      cooldownMs: 10,
      idleTimeoutMs: 20,
      maxRounds: 3,
      schedulerAgent: { enabled: true },
      onEvent: (e) => events.push(e),
    });

    await session.sendUserMessage("帮我定一个适合新手的题材");
    // 等待题材舵手进入工具流（首轮 achat 已挂起，尚未提交本轮）
    await waitFor(() => fake.calls === 1);

    // 此刻 Agent 事务进行中：作者发「换个方向」，应立即被排队而非改写驳回态 / 触发调度
    await session.sendUserMessage("换个方向再讨论");
    expect(events.some((e) => e.type === "system" && (e.data as { message?: string }).message?.includes("将在当前发言者完成本轮后"))).toBe(true);
    // 事务未提交前：不应出现任何 agent 发言，导演也未进行第二次调度
    const preAgentMsgs = events
      .filter((e): e is { type: "chat_message"; data: ChatMessageRecord } => e.type === "chat_message")
      .filter((e) => e.data.kind === "agent");
    expect(preAgentMsgs.length).toBe(0);
    expect(events.filter((e) => e.type === "scheduler_probe").length).toBe(1);

    // 放行当前事务：题材舵手以 finish_turn 提交结论 → 排空队列合并驳回态 → 下次调度被硬规则拉回提案者
    fake.releaseMember();
    await waitFor(() => session.getStatus() === "completed");

    const agentMsgs = events
      .filter((e): e is { type: "chat_message"; data: ChatMessageRecord } => e.type === "chat_message")
      .map((e) => e.data)
      .filter((m) => m.kind === "agent");
    expect(agentMsgs.length).toBeGreaterThanOrEqual(2);
    expect(agentMsgs[0]!.memberName).toBe("题材舵手");
    // 驳回态强制回到提案者，而非导演选中的魔鬼代言人
    expect(agentMsgs[1]!.memberName).toBe("题材舵手");
    expect(agentMsgs[1]!.content).toContain("新方向");
    expect(agentMsgs.some((m) => m.memberName === "魔鬼代言人")).toBe(false);
    // 兜底探针确认为驳回强拉
    const probe = events.find((e) => e.type === "scheduler_probe" && (e.data as Record<string, unknown>).rejectionForced === true);
    expect(probe).toBeDefined();
    expect((probe as { data: Record<string, unknown> }).data.rejectedProposerId).toBe("nav");
  });

  it("事务内多条作者消息按到达顺序排空：最后一条决定驳回态", async () => {
    const events: ChatSessionEvent[] = [];
    const fake = new GatedFinishFakeLLM();
    fake.directorScript.push(JSON.stringify({ ranking: [{ member: "nav", priority: 1, reason: "提案者先给方向" }] }));
    fake.directorScript.push(JSON.stringify({ ranking: [{ member: "dev", priority: 1, reason: "挑刺" }] }));
    // 第 3、4 次调度剩余轮次<=2，会被收束规则接管，脚本值不影响结果
    fake.directorScript.push(JSON.stringify({ ranking: [{ member: "dev", priority: 1, reason: "再挑刺" }] }));
    fake.directorScript.push(JSON.stringify({ ranking: [{ member: "dev", priority: 1, reason: "收尾挑刺" }] }));
    fake.memberConclusions.push("初始提案：都市题材");
    fake.memberConclusions.push("魔鬼代言人的挑刺：方向A风险过高");
    fake.memberConclusions.push("合成者：综合双方建议收敛方案");

    const session = new ChatSession({
      projectId: "proj-queued-order",
      topic: "题材讨论",
      members: [
        { id: "nav", kind: "agent", name: "题材舵手", description: "定位题材", category: "proposer", systemPrompt: "你是题材舵手" },
        { id: "dev", kind: "agent", name: "魔鬼代言人", description: "挑刺", category: "reviewer", systemPrompt: "你是魔鬼代言人" },
        { id: "syn", kind: "agent", name: "合成者", description: "收束", category: "synthesizer", systemPrompt: "你是合成者" },
      ],
      llm: fake as unknown as LLMClient,
      now: () => 0,
      random: () => 0.5,
      cooldownMs: 10,
      idleTimeoutMs: 20,
      maxRounds: 4,
      schedulerAgent: { enabled: true },
      onEvent: (e) => events.push(e),
    });

    await session.sendUserMessage("帮我定一个适合新手的题材");
    await waitFor(() => fake.calls === 1);

    // 事务中连续两条作者消息：先「换方向」，随后「收回」——按到达顺序排空后，最后一条生效（驳回态被清除）
    await session.sendUserMessage("换个方向再讨论");
    await session.sendUserMessage("算了，还是按你原来的方向来");
    const ackCount = events.filter((e) => e.type === "system" && (e.data as { message?: string }).message?.includes("将在当前发言者完成本轮后")).length;
    expect(ackCount).toBe(2);

    fake.releaseMember();
    await waitFor(() => session.getStatus() === "completed");

    const agentMsgs = events
      .filter((e): e is { type: "chat_message"; data: ChatMessageRecord } => e.type === "chat_message")
      .map((e) => e.data)
      .filter((m) => m.kind === "agent");
    expect(agentMsgs.length).toBeGreaterThanOrEqual(2);
    expect(agentMsgs[0]!.memberName).toBe("题材舵手");
    // 最后一条非驳回信号清除了驳回态 → 导演选择生效，下一位是魔鬼代言人（而非被强制拉回的题材舵手）
    expect(agentMsgs[1]!.memberName).toBe("魔鬼代言人");
    // 整场无「驳回强拉」探针
    expect(events.some((e) => e.type === "scheduler_probe" && (e.data as Record<string, unknown>).rejectionForced === true)).toBe(false);
  });

  /** 纯工具循环假 LLM：成员始终调用工具、从不调 finish_turn，兜底由 astream 散文收敛。 */
  class ToolLoopFakeLLM {
    directorScript: string[] = [];
    memberToolCalls: string[] = [];
    fallbackProse: string[] = [];
    count_tokens(): number {
      return 0;
    }
    count_text_tokens(text: string): number {
      return text.length;
    }
    async achat(messages: Array<{ role: string; content?: string; name?: string | null }>): Promise<{ content: string; function_call?: { name: string; arguments: string }; model: string }> {
      const name = (messages[0] as { name?: string | null } | undefined)?.name ?? "角色";
      if (name === "调度员") {
        return { content: this.directorScript.shift() ?? "", model: "fake" };
      }
      const tool = this.memberToolCalls.shift();
      if (!tool) return { content: "最终结论正文（散文路径）", model: "fake" };
      return { content: "", function_call: { name: tool, arguments: "{}" }, model: "fake" };
    }
    async *astream(messages: Array<{ role: string; content?: string; name?: string | null }>): AsyncGenerator<string> {
      const content = this.fallbackProse.shift() ?? "兜底生成的最终结论";
      for (const ch of content) yield ch;
    }
    close(): void {}
  }

  it("Agent 一直调用工具不调 finish_turn：配额耗尽后强制兜底生成散文结论，会话不卡死", async () => {
    const events: ChatSessionEvent[] = [];
    const fake = new ToolLoopFakeLLM();
    fake.directorScript.push(JSON.stringify({ ranking: [{ member: "nav", priority: 1, reason: "提案者先给方向" }] }));
    // 后续轮次剩余<=2 会被收束规则接管，脚本值不影响结果
    fake.directorScript.push(JSON.stringify({ ranking: [{ member: "dev", priority: 1, reason: "挑刺" }] }));
    fake.directorScript.push(JSON.stringify({ ranking: [{ member: "dev", priority: 1, reason: "再挑刺" }] }));
    // maxToolCalls=2 → 循环执行 3 次：3 次 read_worldview，从不调用 finish_turn
    fake.memberToolCalls.push("read_worldview", "read_worldview", "read_worldview");
    fake.fallbackProse.push("兜底生成的最终结论：题材确定为都市脑洞+系统流");

    const session = new ChatSession({
      projectId: "proj-tool-loop",
      topic: "题材讨论",
      members: [
        { id: "nav", kind: "agent", name: "题材舵手", description: "定位题材", category: "proposer", systemPrompt: "你是题材舵手" },
        { id: "syn", kind: "agent", name: "合成者", description: "收束", category: "synthesizer", systemPrompt: "你是合成者" },
      ],
      llm: fake as unknown as LLMClient,
      now: () => 0,
      random: () => 0.5,
      cooldownMs: 10,
      idleTimeoutMs: 20,
      maxRounds: 3,
      maxToolCalls: 2,
      schedulerAgent: { enabled: true },
      onEvent: (e) => events.push(e),
    });

    await session.sendUserMessage("帮我定一个适合新手的题材");
    await waitFor(() => session.getStatus() === "completed");

    const agentMsgs = events
      .filter((e): e is { type: "chat_message"; data: ChatMessageRecord } => e.type === "chat_message")
      .map((e) => e.data)
      .filter((m) => m.kind === "agent");
    expect(agentMsgs.length).toBeGreaterThanOrEqual(1);
    // 配额耗尽后由 astream 兜底产出散文结论（未走 finish_turn）
    expect(agentMsgs[0]!.memberName).toBe("题材舵手");
    expect(agentMsgs[0]!.content).toBe("兜底生成的最终结论：题材确定为都市脑洞+系统流");
    // 工具确实被反复调用（至少 3 次 tool_call），但没有 finish_turn 提交
    const toolCalls = events.filter((e) => e.type === "tool_call");
    expect(toolCalls.length).toBeGreaterThanOrEqual(3);
    expect(toolCalls.every((e) => (e.data as { tool: string }).tool !== "finish_turn")).toBe(true);
  });
});
