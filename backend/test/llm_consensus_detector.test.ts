import { describe, expect, it } from "vitest";
import {
  buildUserPrompt,
  LLMConsensusDetector,
  type JudgeMember,
  type JudgeMessage,
} from "../src/workflow/llm_consensus_detector.js";
import type { LLMClient } from "../src/llm/client.js";

const members: JudgeMember[] = [
  { id: "a", kind: "agent", name: "阿创", description: "新方向", category: "proposer" },
  { id: "b", kind: "agent", name: "老挑", description: "找漏洞", category: "reviewer" },
  { id: "c", kind: "agent", name: "合叔", description: "收束", category: "synthesizer" },
];

function msg(id: string, memberId: string, memberName: string, content: string): JudgeMessage {
  return { id, memberId, memberName, content };
}

class FakeLLM {
  replies: Array<{ content?: string; throwError?: Error }> = [];
  calls = 0;
  async achat(
    _messages: unknown[],
    _kwargs: Record<string, unknown> = {},
    _signal?: AbortSignal
  ): Promise<{ content: string; model: string; usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number }; finish_reason: string; raw: null }> {
    this.calls += 1;
    const reply = this.replies.shift() ?? { content: "" };
    if (reply.throwError) throw reply.throwError;
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

describe("buildUserPrompt - 成员当前立场区段", () => {
  it("包含每位成员最近一次发言（含尚未发言占位），顺序与成员列表一致", () => {
    const recent = [
      msg("m1", "a", "阿创", "我认为主角动机应该是复仇"),
      msg("m2", "b", "老挑", "但复仇动机在第三幕会站不住脚"),
    ];
    const memberLast = new Map([
      ["a", msg("m1", "a", "阿创", "我认为主角动机应该是复仇")],
      ["b", msg("m2", "b", "老挑", "但复仇动机在第三幕会站不住脚")],
    ]);
    const p = buildUserPrompt("讨论主角动机", members, recent, memberLast);
    expect(p).toContain("各角色当前立场");
    expect(p).toContain("- 阿创（proposer）：我认为主角动机应该是复仇");
    expect(p).toContain("- 老挑（reviewer）：但复仇动机在第三幕会站不住脚");
    expect(p).toContain("- 合叔（synthesizer）：尚未发言");
    // 最近消息区段不受影响
    expect(p).toContain("1. 「阿创」：我认为主角动机应该是复仇");
  });

  it("发言超长时压缩至约 160 字，避免窗口刷屏问题", () => {
    const long = "甲".repeat(500);
    const memberLast = new Map([["a", msg("m1", "a", "阿创", long)]]);
    const p = buildUserPrompt("t", members, [], memberLast);
    expect(p).toContain("- 阿创（proposer）：");
    const line = p.split("\n").find((l) => l.startsWith("- 阿创"));
    expect(line!.length).toBeLessThan(200);
  });
});

describe("LLMConsensusDetector - evaluate 维护成员最近发言", () => {
  it("判定提示词包含各成员最后发言，且按 memberId 覆盖", async () => {
    const fake = new FakeLLM();
    fake.replies.push({
      content: JSON.stringify({
        level: 0.9,
        verdict: "reached",
        agree_members: ["阿创", "老挑", "合叔"],
        dissent_members: [],
        unresolved: [],
        reason: "全员一致",
      }),
    });
    const det = new LLMConsensusDetector(asLLM(fake), "讨论主角动机", members);
    await det.evaluate(msg("m1", "a", "阿创", "我认为主角动机是复仇"));
    await det.evaluate(msg("m2", "a", "阿创", "我改主意了，改为救赎"));
    await det.evaluate(msg("m3", "b", "老挑", "救赎动机我同意"));
    // 直接断言：第二次与第三次评估后，成员立场应是最新发言（阿创=救赎，老挑=同意）
    // 通过重新构造 evaluate 并捕获提示词验证
    const captured: string[] = [];
    const fake2 = new FakeLLM();
    fake2.achat = async (messages: unknown[]) => {
      captured.push(String((messages[1] as any).content));
      return {
        content: JSON.stringify({ level: 0.5, verdict: "near", agree_members: [], dissent_members: [], unresolved: ["x"], reason: "x" }),
        model: "fake",
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        finish_reason: "stop",
        raw: null,
      };
    };
    const det2 = new LLMConsensusDetector(fake2 as unknown as LLMClient, "讨论主角动机", members);
    await det2.evaluate(msg("m1", "a", "阿创", "我认为主角动机是复仇"));
    await det2.evaluate(msg("m2", "a", "阿创", "我改主意了，改为救赎"));
    await det2.evaluate(msg("m3", "b", "老挑", "救赎动机我同意"));
    const finalPrompt = captured[captured.length - 1];
    expect(finalPrompt).toContain("- 阿创（proposer）：我改主意了，改为救赎");
    expect(finalPrompt).toContain("- 老挑（reviewer）：救赎动机我同意");
    expect(finalPrompt).toContain("- 合叔（synthesizer）：尚未发言");
  });

  it("LLM 失败时回退为未达成，streak 清零", async () => {
    const fake = new FakeLLM();
    fake.replies.push({ throwError: new Error("boom") });
    const det = new LLMConsensusDetector(asLLM(fake), "t", members, { timeoutMs: 500 });
    const r = await det.evaluate(msg("m1", "a", "阿创", "x"));
    expect(r.verdict).toBe("none");
    expect(r.triggered).toBe(false);
    expect(det.shouldSynthesize).toBe(false);
  });
});

describe("LLMConsensusDetector - 作者待拍板项不阻塞共识（工单 13）", () => {
  it("unresolved 仅含「等待作者确认」时，near 自动升级为 reached 并触发", async () => {
    const fake = new FakeLLM();
    fake.replies.push({
      content: JSON.stringify({
        level: 0.7,
        verdict: "near",
        agree_members: ["阿创", "老挑"],
        dissent_members: [],
        unresolved: ["等待作者确认题材方向"],
        reason: "agent 已同意，只等作者拍板",
      }),
    });
    const det = new LLMConsensusDetector(asLLM(fake), "讨论题材", members, { timeoutMs: 500 });
    const r = await det.evaluate(msg("m1", "a", "阿创", "建议都市文，等作者确认"));
    expect(r.verdict).toBe("reached");
    expect(r.triggered).toBe(true);
    expect(r.streak).toBe(1);
    expect(r.unresolved).toEqual([]);
    expect(det.shouldSynthesize).toBe(false); // 需连续 2 轮
  });

  it("dissent 理由为「待作者拍板」时同样被剥离，不阻塞共识", async () => {
    const fake = new FakeLLM();
    fake.replies.push({
      content: JSON.stringify({
        level: 0.7,
        verdict: "near",
        agree_members: ["阿创", "老挑"],
        dissent_members: [{ member: "合叔", reason: "等作者拍板选哪个题材" }],
        unresolved: [],
        reason: "2 人同意，合叔提示待作者选择",
      }),
    });
    const det = new LLMConsensusDetector(asLLM(fake), "讨论题材", members, { timeoutMs: 500 });
    const r = await det.evaluate(msg("m1", "a", "阿创", "建议都市文"));
    expect(r.verdict).toBe("reached");
    expect(r.triggered).toBe(true);
    expect(r.dissent_members).toEqual([]);
    expect(r.reason).toContain("作者待决策项不阻塞共识");
  });

  it("真实 agent 分歧（不含作者待决）仍不触发", async () => {
    const fake = new FakeLLM();
    fake.replies.push({
      content: JSON.stringify({
        level: 0.6,
        verdict: "near",
        agree_members: ["阿创"],
        dissent_members: [{ member: "老挑", reason: "主角动机不成立" }],
        unresolved: ["主角动机是否可信"],
        reason: "老挑仍保留意见",
      }),
    });
    const det = new LLMConsensusDetector(asLLM(fake), "讨论主角动机", members, { timeoutMs: 500 });
    const r = await det.evaluate(msg("m1", "b", "老挑", "主角动机不成立"));
    expect(r.verdict).toBe("near");
    expect(r.triggered).toBe(false);
    expect(r.streak).toBe(0);
    expect(r.dissent_members.length).toBe(1);
    expect(r.unresolved).toEqual(["主角动机是否可信"]);
  });

  it("LLM 已判 reached 但存在真实 agent 分歧时，自动降级为 near", async () => {
    const fake = new FakeLLM();
    fake.replies.push({
      content: JSON.stringify({
        level: 0.9,
        verdict: "reached",
        agree_members: ["阿创", "合叔"],
        dissent_members: [{ member: "老挑", reason: "冲突烈度还达不到黄金三章" }],
        unresolved: ["开局冲突强度不足"],
        reason: "多数同意但老挑反对",
      }),
    });
    const det = new LLMConsensusDetector(asLLM(fake), "讨论开局", members, { timeoutMs: 500 });
    const r = await det.evaluate(msg("m1", "b", "老挑", "冲突烈度不足"));
    expect(r.verdict).toBe("near");
    expect(r.triggered).toBe(false);
    expect(r.level).toBeLessThanOrEqual(0.65);
  });
});
