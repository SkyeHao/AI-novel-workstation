import { describe, expect, it } from "vitest";
import {
  buildSchedulerUserPrompt,
  parseSchedulerResponse,
  probeSchedulerDecision,
  type SchedulerAgentInput,
} from "../src/workflow/scheduler_agent.js";
import type { LLMClient } from "../src/llm/client.js";
import type { ChatMember, ChatMessageRecord } from "../src/workflow/chat_session.js";

const members: ChatMember[] = [
  { id: "a", kind: "agent", name: "阿创", description: "擅长给出新方向，推动讨论前进", category: "proposer" },
  { id: "b", kind: "agent", name: "老挑", description: "擅长找漏洞与反例", category: "reviewer" },
  { id: "c", kind: "agent", name: "合叔", description: "擅长收束总结并落地", category: "synthesizer" },
];

const triggerMsg: ChatMessageRecord = {
  id: "m1",
  sessionId: "s1",
  memberId: "a",
  memberName: "阿创",
  kind: "agent",
  content: "我认为应该把设定方向定在克苏鲁风格",
  timestamp: "2026-01-01T00:00:00.000Z",
};

function makeInput(overrides: Partial<SchedulerAgentInput> = {}): SchedulerAgentInput {
  return {
    topic: "讨论世界观核心方向",
    memberInfo: members.map((m, i) => ({
      member: m,
      speakCount: i === 0 ? 2 : 0,
      roundsSince: i === 0 ? 0 : -1,
    })),
    historySummary: "更早的讨论：阿创提出了三条可选路线。",
    recentMessages: [triggerMsg],
    triggerMessage: triggerMsg,
    maxRounds: 6,
    turnsUsed: 1,
    ...overrides,
  };
}

class FakeLLM {
  replies: Array<{ content?: string; throwError?: Error; delayMs?: number }> = [];
  calls = 0;
  async achat(
    _messages: unknown[],
    _kwargs: Record<string, unknown> = {},
    _signal?: AbortSignal
  ): Promise<{ content: string; model: string; usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number }; finish_reason: string; raw: null }> {
    this.calls += 1;
    const reply = this.replies.shift() ?? { content: "" };
    if (reply.throwError) throw reply.throwError;
    if (reply.delayMs) await new Promise((r) => setTimeout(r, reply.delayMs));
    return {
      content: reply.content ?? "",
      model: "fake",
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      finish_reason: "stop",
      raw: null,
    };
  }
}

const asLLM = (fake: FakeLLM): LLMClient => fake as unknown as LLMClient;

describe("parseSchedulerResponse", () => {
  const valid = new Set(["a", "b", "c"]);

  it("过滤非法成员、去重、按优先级排序并取前 3", () => {
    const raw = JSON.stringify({
      ranking: [
        { member: "b", priority: 1, reason: "补充漏洞" },
        { member: "z", priority: 1, reason: "不存在的人" },
        { member: "a", priority: 3, reason: "新方向" },
        { member: "b", priority: 2, reason: "重复项（首次出现优先）" },
        { member: "c", priority: 4, reason: "收束" },
        { member: "a", priority: 5, reason: "再来一次" },
      ],
    });
    const d = parseSchedulerResponse(raw, valid);
    expect(d).not.toBeNull();
    expect(d!.ranking.map((r) => r.memberId)).toEqual(["b", "a", "c"]);
    expect(d!.ranking[0].priority).toBe(1);
    expect(d!.ranking.length).toBeLessThanOrEqual(3);
    expect(d!.ranking.every((r) => valid.has(r.memberId))).toBe(true);
  });

  it("缺 priority 归为 99、缺 reason 为空字符串", () => {
    const raw = JSON.stringify({ ranking: [{ member: "a" }] });
    const d = parseSchedulerResponse(raw, valid);
    expect(d!.ranking[0].priority).toBe(99);
    expect(d!.ranking[0].reason).toBe("");
  });

  it("非 JSON 文本返回 null", () => {
    expect(parseSchedulerResponse("抱歉，我无法输出 JSON。", valid)).toBeNull();
  });

  it("ranking 为空或全部非法时返回 null", () => {
    expect(parseSchedulerResponse(JSON.stringify({ ranking: [] }), valid)).toBeNull();
    expect(parseSchedulerResponse(JSON.stringify({ ranking: [{ member: "zz" }] }), valid)).toBeNull();
  });

  it("note 字段透传", () => {
    const raw = JSON.stringify({ ranking: [{ member: "a", priority: 1, reason: "x" }], note: "请先给方向" });
    const d = parseSchedulerResponse(raw, valid);
    expect(d!.note).toBe("请先给方向");
  });

  it("模型误填成员名字时按名字兜底匹配", () => {
    const nameMap = new Map<string, string>([
      ["阿创", "a"],
      ["老挑", "b"],
      ["合叔", "c"],
    ]);
    const raw = JSON.stringify({ ranking: [{ member: "阿创", priority: 1, reason: "给出新方向" }] });
    const d = parseSchedulerResponse(raw, valid, nameMap);
    expect(d).not.toBeNull();
    expect(d!.ranking[0].memberId).toBe("a");
  });

  it("按名字兜底后仍过滤不存在的名字", () => {
    const nameMap = new Map<string, string>([["阿创", "a"]]);
    const raw = JSON.stringify({ ranking: [{ member: "不存在的角色", priority: 1, reason: "x" }] });
    expect(parseSchedulerResponse(raw, valid, nameMap)).toBeNull();
  });
});

describe("buildSchedulerUserPrompt", () => {
  it("包含主题、成员统计、近期发言与状态", () => {
    const p = buildSchedulerUserPrompt(makeInput());
    expect(p).toContain("[TOPIC] 讨论世界观核心方向");
    expect(p).toContain("「阿创」");
    expect(p).toContain("已发言 2 次");
    expect(p).toContain("从未发言");
    expect(p).toContain("[TRIGGER]");
    expect(p).toContain("已用 1 轮");
  });

  it("maxRounds<=0 时状态行提示不限轮次直到达成共识", () => {
    const p = buildSchedulerUserPrompt(makeInput({ maxRounds: 0, turnsUsed: 3 }));
    expect(p).toContain("[STATUS] 讨论不限轮次，直到达成共识");
    expect(p).toContain("当前已进行 3 轮");
    expect(p).not.toContain("剩余");
  });

  it("设置 rejectedProposerId 时渲染 [AUTHOR_REJECTION] 软约束块", () => {
    const p = buildSchedulerUserPrompt(
      makeInput({ rejectedProposerId: "a", rejectedProposerCount: 1 })
    );
    expect(p).toContain("[AUTHOR_REJECTION]");
    expect(p).toContain("「阿创」");
    expect(p).toContain("已被连续驳回 1 次");
    expect(p).toContain("优先安排「阿创」重新给出新方向");
  });

  it("未设置 rejectedProposerId 时不渲染 [AUTHOR_REJECTION] 块", () => {
    const p = buildSchedulerUserPrompt(makeInput());
    expect(p).not.toContain("[AUTHOR_REJECTION]");
  });
});

describe("probeSchedulerDecision", () => {
  it("解析成功返回决策", async () => {
    const fake = new FakeLLM();
    fake.replies.push({
      content: JSON.stringify({ ranking: [{ member: "c", priority: 1, reason: "该收束了" }], note: "请给出结论" }),
    });
    const r = await probeSchedulerDecision(asLLM(fake), makeInput());
    expect(r.parseOk).toBe(true);
    expect(r.decision!.ranking[0].memberId).toBe("c");
    expect(r.decision!.note).toBe("请给出结论");
    expect(fake.calls).toBe(1);
  });

  it("超时回退：decision null、parseOk false", async () => {
    const fake = new FakeLLM();
    fake.replies.push({
      content: JSON.stringify({ ranking: [{ member: "a", priority: 1, reason: "x" }] }),
      delayMs: 200,
    });
    const r = await probeSchedulerDecision(asLLM(fake), makeInput(), { timeoutMs: 20 });
    expect(r.decision).toBeNull();
    expect(r.parseOk).toBe(false);
  });

  it("LLM 抛错时回退：decision null、parseOk false", async () => {
    const fake = new FakeLLM();
    fake.replies.push({ throwError: new Error("boom") });
    const r = await probeSchedulerDecision(asLLM(fake), makeInput());
    expect(r.decision).toBeNull();
    expect(r.parseOk).toBe(false);
  });

  it("导演输出成员名字时也能正确解析为成员 id", async () => {
    const fake = new FakeLLM();
    fake.replies.push({
      content: JSON.stringify({ ranking: [{ member: "合叔", priority: 1, reason: "该收束了" }], note: "请给出结论" }),
    });
    const r = await probeSchedulerDecision(asLLM(fake), makeInput());
    expect(r.parseOk).toBe(true);
    expect(r.decision!.ranking[0].memberId).toBe("c");
    expect(r.decision!.note).toBe("请给出结论");
  });
});
