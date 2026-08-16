/** 审阅管线（ADR-0005 / T9）。
 * 审阅五步：审阅报告 → 去AI味建议 → 对比应用 → 标记 REVIEWED。
 * 报告与建议落盘 review/；对比应用由前端确认后调用 apply。 */
import * as fs from "node:fs";
import * as path from "node:path";
import type { LLMClient } from "../llm/client.js";
import { ChatMessage, Role } from "../llm/models.js";
import type { ProjectStore } from "../storage/project_store.js";
import type { MemoryStore } from "../storage/memory_store.js";
import type { SettingsStore } from "../storage/settings_store.js";
import { ChapterStore, applyRewriteFlow } from "./chapters.js";

export interface ReviewSuggestion {
  id: string;
  location: string;
  issue: string;
  suggestion: string;
  original: string;
  rewritten: string;
}

export interface ReviewResult {
  success: boolean;
  chapter_no: number;
  title: string;
  report: string;
  suggestions: ReviewSuggestion[];
  error: string;
}

const REVIEW_DIR = "review";

function safeFile(projectStore: ProjectStore, projectId: string, name: string): string {
  return path.join(projectStore.resolve(projectId, REVIEW_DIR), name);
}

function parseSuggestions(text: string): ReviewSuggestion[] {
  const out: ReviewSuggestion[] = [];
  try {
    const parsed = JSON.parse(text) as { suggestions?: UnknownSuggestion[] };
    if (Array.isArray(parsed.suggestions)) {
      return (parsed.suggestions as UnknownSuggestion[]).map((s, i) => ({
        id: `s${i + 1}`,
        location: String(s.location ?? ""),
        issue: String(s.issue ?? ""),
        suggestion: String(s.suggestion ?? ""),
        original: String(s.original ?? ""),
        rewritten: String(s.rewritten ?? ""),
      }));
    }
  } catch {
    /* 非 JSON 时按文本切分 */
    const sections = text.split(/\n(?=\d+[.、])/).filter((s) => s.trim());
    for (let i = 0; i < sections.length; i++) {
      out.push({ id: `s${i + 1}`, location: "", issue: sections[i]!.trim().slice(0, 200), suggestion: "", original: "", rewritten: "" });
    }
  }
  return out;
}

interface UnknownSuggestion {
  location?: string;
  issue?: string;
  suggestion?: string;
  original?: string;
  rewritten?: string;
}

/** 审阅五步（报告 + 去AI味建议自动产出；对比应用与 REVIEWED 由路由/前端确认后执行） */
export async function reviewChapterFlow(opts: {
  client: LLMClient;
  projectStore: ProjectStore;
  memory: MemoryStore;
  settingsStore: SettingsStore;
  projectId: string;
  no: number;
}): Promise<ReviewResult> {
  const { client, projectStore, memory, settingsStore, projectId, no } = opts;
  const store = new ChapterStore(projectStore);
  const { record, content } = store.getChapter(projectId, no);
  if (!record) return { success: false, chapter_no: no, title: "", report: "", suggestions: [], error: "章节不存在" };

  const style = settingsStore.exists(projectId, "style") ? settingsStore.get(projectId, "style") : null;
  const styleHint = style && style.style ? `本书风格设定：${String(style.style).slice(0, 800)}` : "";

  // 1 审阅报告
  const reportResp = await client.achat(
    [
      new ChatMessage(
        Role.SYSTEM,
        "你是一位严苛的网文编辑。请审阅本章正文，输出审阅报告（中文 Markdown），覆盖：情节连贯性、" +
          "人物一致性、节奏爽点、逻辑漏洞、伏笔处理（结合已登记伏笔）、与设定冲突，并给出修改优先级。" +
          (styleHint ? "\n" + styleHint : "")
      ),
      new ChatMessage(Role.USER, content.slice(0, 12000)),
    ],
    { temperature: 0.3, max_tokens: 2500 }
  );
  const report = reportResp.content.trim();

  // 2 去AI味建议（结构化 JSON）
  const suggResp = await client.achat(
    [
      new ChatMessage(
        Role.SYSTEM,
        "你是资深编辑，专治“AI味”。请找出本章中最明显的 AI 痕迹（过度排比、机械总结、“总而言之”式收束、“它/他”指代混乱、空洞形容词、“缓缓/微微/仿佛”滥用、每段都小结等），" +
          "输出严格 JSON：{\"suggestions\":[{\"location\":\"段落/位置描述\",\"issue\":\"问题\",\"suggestion\":\"改法\",\"original\":\"原文片段（≤300字）\",\"rewritten\":\"改写后（≤300字）\"}]}，最多 5 条，只输出 JSON。"
      ),
      new ChatMessage(Role.USER, content.slice(0, 12000)),
    ],
    { temperature: 0.3, max_tokens: 2500, response_format: { type: "json_object" } }
  );
  const suggestions = parseSuggestions(suggResp.content);

  // 落盘报告与建议
  fs.writeFileSync(safeFile(projectStore, projectId, `${no}-审阅报告.md`), report, "utf-8");
  fs.writeFileSync(safeFile(projectStore, projectId, `${no}-建议.json`), JSON.stringify(suggestions, null, 2), "utf-8");

  // 3+4 对比应用与 REVIEWED 由路由按需调用 applyReviewSuggestion / markReviewed
  return { success: true, chapter_no: no, title: record.title, report, suggestions, error: "" };
}

/** 应用单条审阅建议（替换原文片段） */
export function applyReviewSuggestion(opts: {
  projectStore: ProjectStore;
  projectId: string;
  no: number;
  suggestion: ReviewSuggestion;
}): { success: boolean; error: string } {
  if (!opts.suggestion.original || !opts.suggestion.rewritten) {
    return { success: false, error: "建议缺少原文或改写内容" };
  }
  return applyRewriteFlow({
    projectStore: opts.projectStore,
    projectId: opts.projectId,
    no: opts.no,
    selection: opts.suggestion.original,
    rewritten: opts.suggestion.rewritten,
  });
}

/** 标记审阅完成（REVIEWED） */
export function markReviewed(opts: {
  projectStore: ProjectStore;
  projectId: string;
  no: number;
}): { success: boolean; error: string } {
  const store = new ChapterStore(opts.projectStore);
  const record = store.setStatus(opts.projectId, opts.no, "REVIEWED");
  if (!record) return { success: false, error: "章节不存在" };
  return { success: true, error: "" };
}

