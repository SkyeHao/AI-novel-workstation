/** 节点域文档工具（ADR-0009）：save_document / read_document。
 * 替代通用 read_file / write_file：kind 决定标准存储路径，模型不能传任意路径；
 * 节点 × kind 权限矩阵控制可写/可读；写入即登记到文档登记表。
 * 正文节点（kind=chapter）写入后自动执行 章尾钩子→L1摘要→8账本回写。 */
import * as fs from "node:fs";
import * as path from "node:path";
import { AbstractTool, ToolResult } from "./base.js";
import { DocumentRegistry, NODE_WRITABLE, NODE_READABLE, isJsonKind, isWorkUnitKind, dynamicDocInfo } from "../storage/document_registry.js";
import { ChapterStore } from "../workflow/chapters.js";
import { runChapterAutoWriteback } from "../workflow/chapter_writeback.js";
import type { ProjectStore } from "../storage/project_store.js";
import type { MemoryStore } from "../storage/memory_store.js";
import type { SettingsStore } from "../storage/settings_store.js";
import type { LLMClient } from "../llm/client.js";

export interface DocumentToolContext {
  projectId: string;
  projectStore: ProjectStore;
  memory: MemoryStore;
  settingsStore: SettingsStore;
  client: LLMClient;
  getCurrentState(): string;
  getWorkUnit(): string;
}

const KNOWN_KINDS = Array.from(new Set([...Object.values(NODE_WRITABLE).flat(), ...Object.values(NODE_READABLE).flat()]));

function kindListError(prefix: string, kinds: string[]): string {
  return prefix + (kinds.length ? "（" + kinds.join("/") + "）" : "");
}

/** 保存标准文档工具 */
export class SaveDocumentTool extends AbstractTool {
  constructor(private ctx: DocumentToolContext) {
    super();
  }

  readonly name = "save_document";
  readonly description =
    "把内容写入当前节点可写的标准文档（核心要素/故事愿景/世界观/人物/大纲/章节正文/审阅报告/风格规范）。" +
    "kind 决定存储位置，路径由系统管理；正文节点保存章节后系统自动执行章尾钩子与动态设定回写。";
  readonly parameters = [
    { name: "kind", type: "string", description: "文档类型：core-elements/vision/worldview/characters/outline/chapter/review/style", required: true, default: null },
    { name: "content", type: "string", description: "完整文档内容（Markdown 或 JSON）", required: true, default: null },
    { name: "title", type: "string", description: "可选标题（用于登记表展示）", required: false, default: null },
    { name: "work_unit", type: "string", description: "工作单元（chapter/review 必填，如 ch3）", required: false, default: null },
    { name: "mode", type: "string", description: "write=覆盖（默认）/ append=追加（仅 Markdown 文档，支持长文分段）", required: false, default: "write" },
  ];

  async execute(kwargs: Record<string, unknown>): Promise<ToolResult> {
    const kind = String(kwargs.kind ?? "").trim() as never;
    const content = String(kwargs.content ?? "");
    const title = String(kwargs.title ?? "").trim();
    const workUnit = String(kwargs.work_unit ?? "").trim() || this.ctx.getWorkUnit();
    const mode = String(kwargs.mode ?? "write").trim() === "append" ? "append" : "write";
    if (!kind) return new ToolResult(false, "", "kind 不能为空");
    if (!content) return new ToolResult(false, "", "content 不能为空");
    if (!KNOWN_KINDS.includes(kind)) return new ToolResult(false, "", "未知文档类型: " + kind);

    const node = this.ctx.getCurrentState();
    const writable = NODE_WRITABLE[node] ?? [];
    if (!writable.includes(kind)) {
      return new ToolResult(false, "", `当前节点（${node}）不可写 ${kind}${kindListError("，可写：", writable)}`);
    }

    try {
      const registry = new DocumentRegistry(this.ctx.projectStore);
      const { relPath } = registry.resolvePath(this.ctx.projectId, kind, workUnit || undefined);

      // JSON 文档（core-elements）必须为合法 JSON
      if (isJsonKind(kind)) {
        try {
          JSON.parse(content);
        } catch {
          return new ToolResult(false, "", "核心要素（core-elements）必须是合法 JSON 对象");
        }
      }

      const full = this.ctx.projectStore.resolve(this.ctx.projectId, relPath);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      if (mode === "append" && fs.existsSync(full)) {
        fs.appendFileSync(full, "\n" + content, "utf-8");
      } else {
        fs.writeFileSync(full, content, "utf-8");
      }

      const finalTitle = title || (isWorkUnitKind(kind) ? "" : "");
      registry.register(this.ctx.projectId, kind, relPath, finalTitle || this._defaultTitle(kind, workUnit), workUnit || null);

      // 正文节点：并入章节索引 + 自动回写
      let writebackNote = "";
      if (kind === "chapter") {
        const info = dynamicDocInfo(kind, String(workUnit || this.ctx.getWorkUnit()));
        if (!info) return new ToolResult(false, "", "章节正文需要有效的 work_unit（如 ch3）");
        const store = new ChapterStore(this.ctx.projectStore);
        const no = info.no;
        const chTitle = title || "第 " + no + " 章";
        store.upsertChapter(this.ctx.projectId, no, chTitle, content);
        try {
          const wb = await runChapterAutoWriteback({
            client: this.ctx.client,
            projectStore: this.ctx.projectStore,
            memory: this.ctx.memory,
            settingsStore: this.ctx.settingsStore,
            projectId: this.ctx.projectId,
            no,
            title: chTitle,
            content,
          });
          writebackNote = wb.success ? "（章末回写与摘要完成）" : "（章末回写失败，正文已保存: " + wb.error + "）";
        } catch (err) {
          writebackNote = "（章末回写异常，正文已保存: " + (err instanceof Error ? err.message : String(err)) + "）";
        }
      }

      const op = mode === "append" ? "已追加到" : "已写入";
      return new ToolResult(true, op + relPath + "（" + content.length + " 字符）" + writebackNote);
    } catch (err) {
      return new ToolResult(false, "", err instanceof Error ? err.message : String(err));
    }
  }

  private _defaultTitle(kind: string, workUnit: string): string {
    if (kind === "chapter") return "章节正文" + (workUnit ? "（" + workUnit + "）" : "");
    if (kind === "review") return "审阅报告" + (workUnit ? "（" + workUnit + "）" : "");
    return String(kind);
  }
}

/** 读取标准文档工具 */
export class ReadDocumentTool extends AbstractTool {
  constructor(private ctx: DocumentToolContext) {
    super();
  }

  readonly name = "read_document";
  readonly description =
    "读取当前节点可读的标准文档内容（核心要素/故事愿景/世界观/人物/大纲/章节正文/审阅报告/风格规范）。" +
    "kind 决定读取路径，路径由系统管理。";
  readonly parameters = [
    { name: "kind", type: "string", description: "文档类型：core-elements/vision/worldview/characters/outline/chapter/review/style", required: true, default: null },
    { name: "work_unit", type: "string", description: "工作单元（chapter/review 必填，如 ch3）", required: false, default: null },
    { name: "max_chars", type: "integer", description: "最大读取字符数（默认 20000）", required: false, default: 20000 },
  ];

  async execute(kwargs: Record<string, unknown>): Promise<ToolResult> {
    const kind = String(kwargs.kind ?? "").trim() as never;
    const workUnit = String(kwargs.work_unit ?? "").trim() || this.ctx.getWorkUnit();
    const maxChars = Number(kwargs.max_chars ?? 20000);
    if (!kind) return new ToolResult(false, "", "kind 不能为空");
    if (!KNOWN_KINDS.includes(kind)) return new ToolResult(false, "", "未知文档类型: " + kind);

    const node = this.ctx.getCurrentState();
    const readable = NODE_READABLE[node] ?? [];
    if (!readable.includes(kind)) {
      return new ToolResult(false, "", `当前节点（${node}）不可读 ${kind}${kindListError("，可读：", readable)}`);
    }

    try {
      const registry = new DocumentRegistry(this.ctx.projectStore);
      const doc = registry.read(this.ctx.projectId, kind, workUnit || undefined);
      if (!doc) return new ToolResult(true, "（该文档尚未生成）");
      let content = doc.content;
      if (content.length > maxChars) {
        content = content.slice(0, maxChars) + "\n...[已截断，共 " + doc.content.length + " 字符]";
      }
      return new ToolResult(true, content);
    } catch (err) {
      return new ToolResult(false, "", err instanceof Error ? err.message : String(err));
    }
  }
}
