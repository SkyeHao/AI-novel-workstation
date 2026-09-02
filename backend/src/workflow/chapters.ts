/** 正文创作管线（ADR-0005 / T9）。
 * 正文四步：前置检测 → 组装上下文 → 写章落盘 → L1 摘要。
 * 章状态机：PENDING → GENERATED → REVIEWED/FINALIZED，修改回 GENERATED。 */
import * as fs from "node:fs";
import * as path from "node:path";
import type { LLMClient } from "../llm/client.js";
import { ChatMessage, Role } from "../llm/models.js";
import type { ProjectStore, Project } from "../storage/project_store.js";
import type { MemoryStore } from "../storage/memory_store.js";
import type { SettingsStore } from "../storage/settings_store.js";
import { ContextOrchestrator } from "../agent/orchestrator.js";
import { getStateNode } from "../storage/states.js";
import { DynamicSettingsStore } from "../storage/dynamic_settings.js";

export type ChapterStatus = "PENDING" | "GENERATED" | "REVIEWED" | "FINALIZED";

export interface ChapterRecord {
  no: number;
  title: string;
  status: ChapterStatus;
  words: number;
  created_at: string;
  updated_at: string;
  outline_ref?: string;
}

export interface ChapterIndex {
  chapters: ChapterRecord[];
}

const INDEX_FILE = "index.json";

function nowSeconds(): string {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

export class ChapterStore {
  constructor(private _projectStore: ProjectStore) {}

  chaptersDir(projectId: string): string {
    return this._projectStore.resolve(projectId, "chapters");
  }

  indexPath(projectId: string): string {
    return path.join(this.chaptersDir(projectId), INDEX_FILE);
  }

  loadIndex(projectId: string): ChapterIndex {
    const p = this.indexPath(projectId);
    if (!fs.existsSync(p)) return { chapters: [] };
    try {
      return JSON.parse(fs.readFileSync(p, "utf-8")) as ChapterIndex;
    } catch {
      return { chapters: [] };
    }
  }

  saveIndex(projectId: string, index: ChapterIndex): void {
    fs.writeFileSync(this.indexPath(projectId), JSON.stringify(index, null, 2), "utf-8");
  }

  getChapter(projectId: string, no: number): { record: ChapterRecord | null; content: string; path: string } {
    const index = this.loadIndex(projectId);
    const record = index.chapters.find((c) => c.no === no) ?? null;
    const filePath = path.join(this.chaptersDir(projectId), `${no}.md`);
    const content = record && fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf-8") : "";
    return { record, content, path: filePath };
  }

  upsertChapter(projectId: string, no: number, title: string, content: string): ChapterRecord {
    const index = this.loadIndex(projectId);
    const now = nowSeconds();
    let record = index.chapters.find((c) => c.no === no);
    const dir = this.chaptersDir(projectId);
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, `${no}.md`);
    if (record) {
      record.title = title || record.title;
      record.updated_at = now;
      record.words = content.replace(/\s/g, "").length;
      if (record.status === "REVIEWED" || record.status === "FINALIZED") record.status = "GENERATED";
    } else {
      record = {
        no,
        title: title || `第 ${no} 章`,
        status: "PENDING",
        words: content.replace(/\s/g, "").length,
        created_at: now,
        updated_at: now,
      };
      index.chapters.push(record);
    }
    fs.writeFileSync(filePath, content, "utf-8");
    index.chapters.sort((a, b) => a.no - b.no);
    this.saveIndex(projectId, index);
    return record;
  }

  setStatus(projectId: string, no: number, status: ChapterStatus): ChapterRecord | null {
    const index = this.loadIndex(projectId);
    const record = index.chapters.find((c) => c.no === no);
    if (!record) return null;
    record.status = status;
    record.updated_at = nowSeconds();
    this.saveIndex(projectId, index);
    return record;
  }
}

/** 前置检测（T2 软提示 + 硬拦截开关） */
export function prereqCheck(settings: SettingsStore, projectId: string): { complete: boolean; missing: string[]; details: Record<string, boolean> } {
  const checks: Record<string, string> = {
    worldview: "世界观设定",
    characters: "人物卡片",
    outline: "章纲规划",
    style: "风格设定",
  };
  const details: Record<string, boolean> = {};
  const missing: string[] = [];
  for (const [key, label] of Object.entries(checks)) {
    const ok = settings.exists(projectId, key);
    details[key] = ok;
    if (!ok) missing.push(label);
  }
  return { complete: missing.length === 0, missing, details };
}

export interface WriteChapterResult {
  success: boolean;
  chapter_no: number;
  title: string;
  content: string;
  words: number;
  summary: string;
  error: string;
  blocked: boolean;
}

/** 正文四步：前置检测 → 组装上下文 → 写章落盘 → L1 摘要 */
export async function writeChapterFlow(opts: {
  client: LLMClient;
  projectStore: ProjectStore;
  memory: MemoryStore;
  settingsStore: SettingsStore;
  projectId: string;
  no: number;
  title?: string;
  note?: string;
  blockWhenIncomplete?: boolean;
}): Promise<WriteChapterResult> {
  const { client, projectStore, memory, settingsStore, projectId, no, blockWhenIncomplete = false } = opts;
  const project = projectStore.get(projectId);

  // 1 前置检测
  const prereq = prereqCheck(settingsStore, projectId);
  if (blockWhenIncomplete && !prereq.complete) {
    return {
      success: false, chapter_no: no, title: "", content: "", words: 0, summary: "",
      blocked: true,
      error: `前置设定不完整，缺少：${prereq.missing.join("、")}。请先在对应状态完成设定。`,
    };
  }

  // 2 组装上下文（按 writing 状态规则）
  const retriever = await import("../storage/retriever.js").then((m) => m.createRetriever(memory));
  const dynamicStore = new DynamicSettingsStore(projectStore);
  const orchestrator = new ContextOrchestrator(
    client,
    memory,
    retriever,
    (pid, type) => (settingsStore.exists(pid, type) ? settingsStore.get(pid, type) : null),
    dynamicStore
  );
  const outline = settingsStore.exists(projectId, "outline") ? settingsStore.get(projectId, "outline") : null;
  const chapterHint = buildChapterHint(outline, no, opts.note ?? "");
  const stateNode = getStateNode("writing");
  const assembled = await orchestrator.process(
    [
      new ChatMessage(Role.SYSTEM, WRITING_SYSTEM_PROMPT),
      new ChatMessage(Role.USER, chapterHint),
    ],
    { project_id: projectId, state: "writing" }
  );

  // 3 写章落盘
  const response = await client.achat(assembled, { temperature: 0.8, max_tokens: 6000 });
  const content = stripChapterMeta(response.content.trim());
  const title = opts.title ?? `第 ${no} 章`;
  const store = new ChapterStore(projectStore);
  store.upsertChapter(projectId, no, title, content);

  // 4 L1 摘要（自动驱动分层摘要）
  let summary = "";
  try {
    const sumResp = await client.achat(
      [
        new ChatMessage(Role.SYSTEM, "你是小说章节摘要器。用 3-5 句话概括本章情节推进、关键信息与悬念钩子，中文输出。"),
        new ChatMessage(Role.USER, content.slice(0, 8000)),
      ],
      { temperature: 0.3, max_tokens: 500 }
    );
    summary = sumResp.content.trim();
    memory.saveSummary(projectId, 1, summary, `ch${no}`);
    memory.addFact(projectId, `第${no}章《${title}》已完成：${summary}`, `ch${no}`, "writing");
  } catch (err) {
    console.warn(`L1 摘要生成失败: ${err}`);
  }

  return {
    success: true,
    chapter_no: no,
    title,
    content,
    words: content.replace(/\s/g, "").length,
    summary,
    error: "",
    blocked: false,
  };
}

function buildChapterHint(outline: Record<string, unknown> | null, no: number, note: string): string {
  const lines: string[] = [`请创作第 ${no} 章正文。`];
  if (outline) {
    const root = outline.root as Record<string, unknown> | undefined;
    const findChapter = (node: Record<string, unknown> | undefined): Record<string, unknown> | null => {
      if (!node) return null;
      if (node.type === "chapter" && Number(node.no) === no) return node;
      const children = node.children as Array<Record<string, unknown>> | undefined;
      if (children) {
        for (const c of children) {
          const found = findChapter(c);
          if (found) return found;
        }
      }
      return null;
    };
    const ch = findChapter(root);
    if (ch) {
      lines.push(`本章章纲：事件=${ch.event ?? ""}；功能=${ch.function ?? ""}；出场人物=${(ch.cast as string[] | undefined)?.join("、") ?? ""}`);
      if (ch.foreshadow_plant) lines.push(`本章需埋下伏笔：${(ch.foreshadow_plant as string[]).join("；")}`);
      if (ch.foreshadow_reap) lines.push(`本章需回收伏笔：${(ch.foreshadow_reap as string[]).join("；")}`);
    }
  }
  if (note) lines.push(`作者补充要求：${note}`);
  return lines.join("\n");
}

export const WRITING_SYSTEM_PROMPT = `你是一位成熟的网文作者。根据项目世界观、人物卡、章纲与记忆中已埋伏笔，创作本章正文。

创作要求：
- 符合本书风格基调与节奏爽点，3章一小爽、10章一大爽
- 注意人物性格一致性与对话口吻
- 尊重已确定的正典事实，不得冲突；需要新增设定时先说明再写入
- 章节结尾以正文叙事自然留钩子（除非是收束卷）
- 正文只包含读者看到的内容：不得输出任何元信息、章末说明、"本章完/（第N章完）"等完本标注、钩子说明或与剧情无关的提示
- 直接输出正文 Markdown（可含小节标题），不要输出任何解释`;

/** 剥离正文末尾的完本标注（如"（第3章完）"、"本章完"、"（全书完）"），保证正文文件只含读者看到的内容。 */
export function stripChapterMeta(content: string): string {
  let lines = content.split(/\r?\n/);
  const endMark = /^(?:（[^）]*完[^）]*）|（第?\s*\d*\s*章?\s*预告[^）]*）|第?\s*\d*\s*章\s*完|本章完|全书完|（完）|【章尾钩子】.*)$/;
  while (lines.length > 0) {
    const last = lines[lines.length - 1];
    if (last === undefined) break;
    const trimmed = last.trim();
    if (trimmed === "" || endMark.test(trimmed)) {
      lines.pop();
    } else {
      break;
    }
  }
  return lines.join("\n");
}
export interface RewriteResult {
  success: boolean;
  original: string;
  rewritten: string;
  error: string;
}

/** 选段修改：生成 原文/改写 对比（T9） */
export async function rewriteSelectionFlow(opts: {
  client: LLMClient;
  projectStore: ProjectStore;
  projectId: string;
  no: number;
  selection: string;
  instruction: string;
}): Promise<RewriteResult> {
  const { client, projectStore, projectId, no, selection, instruction } = opts;
  const store = new ChapterStore(projectStore);
  const { content } = store.getChapter(projectId, no);
  if (!content) return { success: false, original: "", rewritten: "", error: "章节不存在" };

  const prompt = `请按要求改写以下小说选段（只输出改写后的段落，不要解释）：

作者修改要求：${instruction}

原文选段：
"""${selection}"""

改写后：`;
  const response = await client.achat([new ChatMessage(Role.USER, prompt)], { temperature: 0.7, max_tokens: 2000 });
  return { success: true, original: selection, rewritten: response.content.trim(), error: "" };
}

/** 应用改写：替换选段并回 GENERATED */
export function applyRewriteFlow(opts: {
  projectStore: ProjectStore;
  projectId: string;
  no: number;
  selection: string;
  rewritten: string;
}): { success: boolean; error: string } {
  const { projectStore, projectId, no, selection, rewritten } = opts;
  const store = new ChapterStore(projectStore);
  const { record, content } = store.getChapter(projectId, no);
  if (!record) return { success: false, error: "章节不存在" };
  const idx = content.indexOf(selection);
  if (idx < 0) return { success: false, error: "未在章节中找到所选原文（可能已被修改），请重新选择" };
  const next = content.slice(0, idx) + rewritten + content.slice(idx + selection.length);
  store.upsertChapter(projectId, no, record.title, next);
  store.setStatus(projectId, no, "GENERATED");
  return { success: true, error: "" };
}
