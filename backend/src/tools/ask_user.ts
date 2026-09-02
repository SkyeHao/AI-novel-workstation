/** 向用户提问工具（T3 人机交互，TS 版，迁移自 tools/ask_user.py）。
 * Agent 需要作者拍板时调用：前端展示结构化选择卡片（单选/多选/自定义），等待回答后继续。 */
import { AbstractTool, ToolResult } from "./base.js";

export type AskFn = (question: string, options: string[], multiple: boolean, allowCustom: boolean) => Promise<string>;

function toBool(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return ["true", "1", "yes", "y", "是"].includes(value.trim().toLowerCase());
  return Boolean(value);
}

function toList(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") {
    const s = value.trim();
    if (!s) return [];
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      /* 忽略 */
    }
    return s.split(",").map((x) => x.trim()).filter((x) => x);
  }
  return [String(value)];
}

export class AskUserTool extends AbstractTool {
  private _askFn: AskFn;

  constructor(askFn: AskFn) {
    super();
    this._askFn = askFn;
  }

  readonly name = "ask_user";

  readonly description =
    "当需要作者做出选择（如题材、平台、设定偏好、创作方向等）时调用本工具，" +
    "向作者展示选项并等待其回答。支持：单选（multiple=false）、多选（multiple=true，" +
    "例如需要作者同时确认多个创作方向或设定维度时）。options 应提供 2-6 个候选选项，" +
    "候选不足时系统会自动补足默认选项；系统还会在选项末尾自动追加一个“自定义回答”入口，" +
    "供作者自由输入，因此无需担心选项不完整（无需设置 allow_custom）。" +
    "适合在创作方向不确定、需要作者拍板时使用。";

  readonly parameters = [
    { name: "question", type: "string", description: "向作者提出的问题", required: true, default: null },
    { name: "options", type: "array", description: "候选选项列表，如 [\"玄幻\", \"都市\"]", required: false, default: [] },
    { name: "multiple", type: "boolean", description: "是否允许多选（true=作者可勾选多个选项后一并提交）", required: false, default: false },
    { name: "allow_custom", type: "boolean", description: "是否允许作者输入自定义文本（true=选项旁提供自定义输入入口）", required: false, default: true },
  ];

  async execute(kwargs: Record<string, unknown>): Promise<ToolResult> {
    const question = String(kwargs.question ?? "").trim() || "请做出选择";
    const options = toList(kwargs.options);
    const multiple = toBool(kwargs.multiple);
    const allowCustom = toBool(kwargs.allow_custom);
    const answer = await this._askFn(question, options, multiple, allowCustom);
    return new ToolResult(true, `作者的选择：${answer}`);
  }
}
