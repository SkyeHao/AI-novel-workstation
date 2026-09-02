import { describe, expect, it } from "vitest";
import { ASK_CUSTOM_OPTION, ASK_FALLBACK_OPTIONS, AskResolver, normalizeAskOptions } from "../src/agent/react.js";

describe("normalizeAskOptions（工单 14：ask 始终给几个可点选项 + 一个自定义入口）", () => {
  it("Agent 未提供选项时用兜底选项补足，并追加自定义回答入口", () => {
    const opts = normalizeAskOptions([]);
    expect(opts.length).toBeGreaterThanOrEqual(3);
    expect(opts).toContain(ASK_CUSTOM_OPTION);
    expect(opts.slice(0, 2)).toEqual(ASK_FALLBACK_OPTIONS);
  });

  it("Agent 只给 1 个选项时补足到至少 2 个候选 + 自定义入口", () => {
    const opts = normalizeAskOptions(["都市文"]);
    expect(opts.length).toBeGreaterThanOrEqual(3);
    expect(opts[0]).toBe("都市文");
    expect(opts).toContain(ASK_CUSTOM_OPTION);
  });

  it("Agent 给了 2-6 个选项时原样保留，仅追加自定义入口", () => {
    const given = ["都市职场", "都市异能"];
    const opts = normalizeAskOptions(given);
    expect(opts.slice(0, 2)).toEqual(given);
    expect(opts).toContain(ASK_CUSTOM_OPTION);
    expect(opts).not.toContain(ASK_FALLBACK_OPTIONS[0]);
  });

  it("超过 6 个选项时截断，自定义入口始终在末尾", () => {
    const opts = normalizeAskOptions(Array.from({ length: 9 }, (_, i) => "选项" + (i + 1)));
    expect(opts.length).toBe(7);
    expect(opts[opts.length - 1]).toBe(ASK_CUSTOM_OPTION);
  });

  it("重复/空值被过滤，自定义标记不重复追加", () => {
    const opts = normalizeAskOptions(["", "A", "A", ASK_CUSTOM_OPTION, "B"]);
    expect(opts.filter((o) => o === ASK_CUSTOM_OPTION).length).toBe(1);
    expect(opts).toContain("A");
    expect(opts).toContain("B");
  });
});

describe("AskResolver.ask 输出归一化选项（工单 14）", () => {
  it("onAsk 回调收到的选项已归一化：几个候选 + 自定义入口 + allow_custom=true", async () => {
    const captured: unknown[] = [];
    const resolver = new AskResolver((q) => captured.push(q));
    const p = resolver.ask("选个题材", [], false, false);
    const q = captured[0] as { question: string; options: string[]; multiple: boolean; allow_custom: boolean };
    expect(q.question).toBe("选个题材");
    expect(q.options.length).toBeGreaterThanOrEqual(3);
    expect(q.options[q.options.length - 1]).toBe(ASK_CUSTOM_OPTION);
    expect(q.allow_custom).toBe(true);
    resolver.submitAnswer("都市文");
    expect(await p).toBe("都市文");
  });

  it("peek 恢复的待答问题同样携带归一化选项", async () => {
    const resolver = new AskResolver(null);
    const p = resolver.ask("采用哪个方案？", ["方案A", "方案B"], false, false);
    const peeked = resolver.peek();
    expect(peeked?.options.length).toBeGreaterThanOrEqual(3);
    expect(peeked?.options).toContain(ASK_CUSTOM_OPTION);
    resolver.submitAnswer("方案A");
    await p;
  });
});
