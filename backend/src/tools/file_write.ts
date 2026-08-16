/** 文件写入工具（TS 版，迁移自 tools/file_write.py）。
 * 绑定项目根后所有写出路径均在项目沙箱内；未绑定时使用进程 cwd。 */
import * as fs from "node:fs";
import * as path from "node:path";
import { AbstractTool, ToolResult } from "./base.js";
import { safeResolve } from "../storage/path_safety.js";

export class FileWriteTool extends AbstractTool {
  private _root: string | null;

  constructor(root: string | null = null) {
    super();
    this._root = root;
  }

  readonly name = "write_file";
  readonly description = "写入文本文件（自动创建目录）。用于保存设定、大纲、章节正文、审阅报告等。";
  readonly parameters = [
    { name: "path", type: "string", description: "文件路径（相对项目根或绝对路径）", required: true, default: null },
    { name: "content", type: "string", description: "完整文件内容", required: true, default: null },
  ];

  async execute(kwargs: Record<string, unknown>): Promise<ToolResult> {
    const raw = String(kwargs.path ?? "").trim();
    const content = String(kwargs.content ?? "");
    if (!raw) return new ToolResult(false, "", "path 不能为空");
    const base = this._root ?? process.cwd();
    let target: string;
    try {
      target = path.isAbsolute(raw) ? safeResolve(base, raw) : safeResolve(base, raw);
    } catch (err) {
      return new ToolResult(false, "", err instanceof Error ? err.message : String(err));
    }
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content, "utf-8");
      return new ToolResult(true, `已写入 ${raw}（${content.length} 字符）`);
    } catch (err) {
      return new ToolResult(false, "", err instanceof Error ? err.message : String(err));
    }
  }
}

/** 绑定到某项目根的工具（供项目内 Agent 快捷使用） */
export function createProjectFileWrite(root: string): FileWriteTool {
  return new FileWriteTool(root);
}
