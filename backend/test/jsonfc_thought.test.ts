import { describe, expect, it } from "vitest";
import { extractThoughtDelta } from "../src/agent/react.js";

describe("jsonfc thought 增量提取（思考气泡推送）", () => {
  it("完整 thought 提取", () => {
    expect(extractThoughtDelta('{"thought": "我在思考", "done": false}', 0)).toBe("我在思考");
  });

  it("流式增量：第二次只返回新增部分", () => {
    const c1 = '{"thought": "我在';
    const d1 = extractThoughtDelta(c1, 0);
    expect(d1).toBe("我在");
    const c2 = '{"thought": "我在思考", "done": false}';
    const d2 = extractThoughtDelta(c2, d1!.length);
    expect(d2).toBe("思考");
  });

  it("处理 JSON 转义（换行与引号）", () => {
    const raw = '{"thought": "第一行\\n第二行\\"引用\\"", "done": true}';
    const d = extractThoughtDelta(raw, 0);
    expect(d).toBe('第一行\n第二行"引用"');
  });

  it("无 thought 字段返回 null，长度未增长返回 null", () => {
    expect(extractThoughtDelta('{"done": true}', 0)).toBeNull();
    expect(extractThoughtDelta('{"thought": "ab"}', 2)).toBeNull();
  });
});
