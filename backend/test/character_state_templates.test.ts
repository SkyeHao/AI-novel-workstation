import { describe, expect, it } from "vitest";
import {
  CHARACTER_STATE_TEMPLATES,
  findCharacterStateTemplate,
  resolveCharacterDimensions,
  type CharacterDimension,
} from "../src/assets/character_state_templates.js";

describe("CharacterStateTemplates（人物状态模板）", () => {
  it("内置 10 个题材模板且每条维度非空", () => {
    expect(CHARACTER_STATE_TEMPLATES).toHaveLength(10);
    for (const t of CHARACTER_STATE_TEMPLATES) {
      expect(t.id).toBeTruthy();
      expect(t.label).toBeTruthy();
      expect(t.dimensions.length).toBeGreaterThan(0);
    }
  });

  it("findCharacterStateTemplate 支持按 label / id / 包含匹配", () => {
    expect(findCharacterStateTemplate("都市").id).toBe("urban");
    expect(findCharacterStateTemplate("urban").id).toBe("urban");
    expect(findCharacterStateTemplate("重生都市").id).toBe("urban");
    expect(findCharacterStateTemplate("玄幻").id).toBe("xuanhuan");
    expect(findCharacterStateTemplate("游戏异界").id).toBe("game");
  });

  it("findCharacterStateTemplate 未知题材或空串兜底通用模板", () => {
    const genericId = CHARACTER_STATE_TEMPLATES[CHARACTER_STATE_TEMPLATES.length - 1].id;
    expect(findCharacterStateTemplate("").id).toBe(genericId);
    expect(findCharacterStateTemplate("   ").id).toBe(genericId);
    expect(findCharacterStateTemplate("不存在的题材").id).toBe(genericId);
    expect(findCharacterStateTemplate(undefined as unknown as string).id).toBe(genericId);
  });

  it("resolveCharacterDimensions 自定义维度优先", () => {
    const custom: CharacterDimension[] = [
      { key: "networth", label: "身家", hint: "资产" },
    ];
    const resolved = resolveCharacterDimensions("玄幻", custom);
    expect(resolved).toEqual(custom);
  });

  it("resolveCharacterDimensions 无自定义时按题材模板", () => {
    expect(resolveCharacterDimensions("都市")[0].key).toBe("identity");
    expect(resolveCharacterDimensions("末世生存").some((d) => d.key === "supplies")).toBe(true);
  });

  it("resolveCharacterDimensions 空自定义且未知题材时兜底通用", () => {
    const resolved = resolveCharacterDimensions("神秘题材", []);
    expect(resolved.some((d) => d.key === "identity")).toBe(true);
  });
});

