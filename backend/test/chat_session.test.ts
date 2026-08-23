import { describe, expect, it, vi } from "vitest";
import { ChatSession } from "../src/workflow/chat_session.js";
import type { ChatSessionEvent, ChatMember, ChatMessageRecord } from "../src/workflow/chat_session.js";
import { SpeakerScheduler } from "../src/workflow/speaker_scheduler.js";
import type { LLMClient } from "../src/llm/client.js";

class FakeLLMClient {
  config = { model: "fake", apiKey: "fake", baseUrl: "fake", temperature: 0, maxTokens: 100, timeout: 10, maxRetries: 0 };
  calls: Array<{ content: string }> = [];
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
    this.calls.push({ content: name });
    if (this.gate) await this.gate;
    if (this.failWith) throw this.failWith;
    const content = this.replies.length > 0 ? this.replies.shift()! : "这是「" + name + "」的发言";
    return { content, model: "fake" };
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
