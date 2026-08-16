/** 核心要素（Core Elements）：创意共创的唯一事实源（TS 版，迁移自 workflow/core_elements.py）。 */
import * as fs from "node:fs";
import * as path from "node:path";

export const CORE_ELEMENTS_FILENAME = "核心要素.json";

export const CORE_ELEMENTS_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  properties: {
    "主线": {
      type: "object",
      properties: {
        "核心冲突": { type: "array", items: { type: "string" } },
        "翻盘方式": { type: "string" },
        "大结局方向": { type: "string" },
      },
      required: ["核心冲突", "翻盘方式", "大结局方向"],
    },
    "愿景": {
      type: "object",
      properties: {
        "一句话核心梗": { type: "string" },
        "目标读者感受": { type: "string" },
      },
      required: ["一句话核心梗", "目标读者感受"],
    },
    "风格": {
      type: "object",
      properties: {
        "风格基调": { type: "string" },
        "节奏爽点": { type: "string" },
      },
      required: ["风格基调", "节奏爽点"],
    },
    "世界观": {
      type: "object",
      properties: {
        "题材类型": { type: "string" },
        "时代背景": { type: "string" },
      },
      required: ["题材类型", "时代背景"],
    },
  },
  required: ["主线", "愿景", "风格", "世界观"],
  additionalProperties: true,
} as const;

export function coreElementsPath(projectRoot: string): string {
  return path.join(projectRoot, CORE_ELEMENTS_FILENAME);
}

/** 轻量结构校验（主要字段存在且非空） */
export function validateCoreElements(data: Record<string, unknown>): string[] {
  const errors: string[] = [];
  const requiredGroups = {
    "主线": ["核心冲突", "翻盘方式", "大结局方向"],
    "愿景": ["一句话核心梗", "目标读者感受"],
    "风格": ["风格基调", "节奏爽点"],
    "世界观": ["题材类型", "时代背景"],
  };
  for (const [group, fields] of Object.entries(requiredGroups)) {
    const g = data[group] as Record<string, unknown> | undefined;
    if (!g || typeof g !== "object") {
      errors.push(`${group}: 缺失`);
      continue;
    }
    for (const f of fields) {
      const v = g[f];
      const empty = v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
      if (empty) errors.push(`${group}.${f}: 为空`);
    }
  }
  return errors;
}

export function loadCoreElements(projectRoot: string): Record<string, unknown> {
  const p = coreElementsPath(projectRoot);
  if (!fs.existsSync(p)) return {};
  try {
    const data = JSON.parse(fs.readFileSync(p, "utf-8"));
    if (data && typeof data === "object") return data as Record<string, unknown>;
  } catch (err) {
    console.warn(`读取核心要素失败: ${p}: ${err}`);
  }
  return {};
}

export function saveCoreElements(projectRoot: string, data: Record<string, unknown>): string {
  const p = coreElementsPath(projectRoot);
  fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf-8");
  return p;
}
