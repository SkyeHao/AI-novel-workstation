/** 文件读取工具（TS 版，迁移自 tools/file_read.py）。
 * 绑定项目根后所有路径均在项目沙箱内解析；未绑定时使用进程 cwd。 */
import * as fs from "node:fs";
import * as path from "node:path";
import { AbstractTool, ToolResult } from "./base.js";
import { safeResolve } from "../storage/path_safety.js";

export class FileReadTool extends AbstractTool {
  private _root: string | null;

  constructor(root: string | null = null) {
    super();
    this._root = root;
  }

  readonly name = "read_file";
  readonly description = "读取文本文件内容（相对项目根路径或绝对路径）。用于查看已生成的设定、大纲、章节正文等。";
  readonly parameters = [
    { name: "path", type: "string", description: "文件路径（相对项目根或绝对路径）", required: true, default: null },
    { name: "max_chars", type: "integer", description: "最大读取字符数（默认 20000）", required: false, default: 20000 },
  ];

  async execute(kwargs: Record<string, unknown>): Promise<ToolResult> {
    const raw = String(kwargs.path ?? "").trim();
    if (!raw) return new ToolResult(false, "", "path 不能为空");
    const maxChars = Number(kwargs.max_chars ?? 20000);
    const base = this._root ?? process.cwd();
    let target: string;
    try {
      target = path.isAbsolute(raw) ? safeResolve(base, raw) : safeResolve(base, raw);
    } catch (err) {
      return new ToolResult(false, "", err instanceof Error ? err.message : String(err));
    }
    if (!fs.existsSync(target)) return new ToolResult(false, "", `文件不存在: ${raw}`);
    if (fs.statSync(target).isDirectory()) return new ToolResult(false, "", `是目录而非文件: ${raw}`);
    try {
      let content = fs.readFileSync(target, "utf-8");
      if (content.length > maxChars) {
        content = content.slice(0, maxChars) + `\n...[已截断，共 ${content.length} 字符]`;
      }
      return new ToolResult(true, content);
    } catch (err) {
      return new ToolResult(false, "", err instanceof Error ? err.message : String(err));
    }
  }
}

/** 绑定到某项目根的工具（供项目内 Agent 快捷使用） */
export function createProjectFileRead(root: string): FileReadTool {
  return new FileReadTool(root);
}
