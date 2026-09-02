import { describe, expect, it } from "vitest";
import {
  DEFAULT_STATES,
  getStateNode,
  getStatesByKeys,
  legacyStatusToNew,
} from "../src/storage/states.js";

describe("states（T1）", () => {
  it("默认 7 个流程节点，伏笔不再作为独立横切节点", () => {
    expect(DEFAULT_STATES.length).toBe(7);
    expect(DEFAULT_STATES.map((s) => s.key)).toEqual([
      "ideation", "worldview", "characters", "outline", "writing", "review", "style",
    ]);
    expect(DEFAULT_STATES.some((s) => s.key === "foreshadow")).toBe(false);
  });

  it("legacyStatusToNew 完成旧状态映射", () => {
    expect(legacyStatusToNew("ideation")).toBe("ideation");
    expect(legacyStatusToNew("setting")).toBe("worldview");
    expect(legacyStatusToNew("writing")).toBe("writing");
    expect(legacyStatusToNew("reviewing")).toBe("review");
    expect(legacyStatusToNew("unknown")).toBe("ideation");
  });

  it("getStateNode 未知 key 回退创意孵化", () => {
    expect(getStateNode("writing").label).toBe("正文生成");
    expect(getStateNode("nope").key).toBe("ideation");
  });

  it("getStatesByKeys 支持可扩展状态集", () => {
    const selected = getStatesByKeys(["ideation", "writing"]);
    expect(selected.map((s) => s.key)).toEqual(["ideation", "writing"]);
    expect(getStatesByKeys([]).length).toBe(DEFAULT_STATES.length);
  });
});
