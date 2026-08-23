/**
 * 群聊最终方案应用（工单 08）。
 *
 * 把 ChatSession 达成共识后由合成者产出的最终方案（summary，markdown）落地到三类目标：
 *   document    —— 保存为 Markdown 参考文档（memory/discussions/方案-<sessionId前8>.md）并登记到文档登记表；
 *   outline     —— 结合既有大纲，让 LLM 把方案中大纲相关决策合并为结构化 OutlineData 写入 settings/outline.json；
 *   characters  —— 结合既有人设，让 LLM 把方案中人物相关决策合并为结构化 CharactersData 写入 settings/characters.json。
 *
 * 黑盒可测：注入 fake LLM + 临时 ProjectStore，断言落盘文件 / 设定内容。
 */
import * as nodeFs from "node:fs";
import * as nodePath from "node:path";
import type { ProjectStore } from "../storage/project_store.js";
import type { LLMClient } from "../llm/client.js";
import { ChatMessage, Role } from "../llm/models.js";
import { DocumentRegistry } from "../storage/document_registry.js";
import { SettingsStore } from "../storage/settings_store.js";

export type ChatApplyTarget = "document" | "outline" | "characters";

export const CHAT_APPLY_TARGETS: readonly ChatApplyTarget[] = ["document", "outline", "characters"];

export interface ChatApplyResult {
  target: ChatApplyTarget;
  ok: boolean;
  message: string;
  /** document 目标：保存文件的相对项目根路径 */
  relPath?: string;
  /** outline / characters 目标：写入的设定数据（供前端展示 / 验证） */
  data?: Record<string, unknown>;
}

export class ChatApplyError extends Error {}

export interface ChatApplyOptions {
  projectId: string;
  sessionId: string;
  topic: string;
  summary: string;
  target: ChatApplyTarget;
  llm: LLMClient;
  projectStore: ProjectStore;
}

/** 从 LLM 输出中提取 JSON 对象（容忍围栏代码块与前后杂文）。 */
function extractJson(text: string): Record<string, unknown> | null {
  const trimmed = String(text ?? "").trim();
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
    return null;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        const parsed = JSON.parse(trimmed.slice(start, end + 1));
        if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
      } catch {
        return null;
      }
    }
    return null;
  }
}

/** 组装参考文档 markdown。 */
function buildPlanMarkdown(opts: ChatApplyOptions): string {
  const now = new Date().toISOString();
  const lines: string[] = [];
  lines.push("# 群聊讨论方案：" + opts.topic);
  lines.push("");
  lines.push("> 讨论会话：" + opts.sessionId);
  lines.push("> 生成时间：" + now);
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push(opts.summary.trim());
  lines.push("");
  return lines.join("\n");
}

function applyAsDocument(opts: ChatApplyOptions): ChatApplyResult {
  const prefix = opts.sessionId.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 8) || "session";
  const relPath = "memory/discussions/方案-" + prefix + ".md";
  const full = opts.projectStore.resolve(opts.projectId, relPath);
  nodeFs.mkdirSync(nodePath.dirname(full), { recursive: true });
  nodeFs.writeFileSync(full, buildPlanMarkdown(opts), "utf-8");
  new DocumentRegistry(opts.projectStore).register(
    opts.projectId,
    "plan",
    relPath,
    "群聊方案：" + opts.topic,
    null
  );
  return { target: "document", ok: true, message: "已保存为参考文档", relPath };
}

/** 让 LLM 把方案中与大纲相关的决策合并进既有大纲，返回完整 OutlineData。 */
async function applyToOutline(opts: ChatApplyOptions): Promise<ChatApplyResult> {
  const settings = new SettingsStore(opts.projectStore);
  const current = settings.get(opts.projectId, "outline");

  const prompt = [
    "你是网文大纲设计师。下面给出讨论最终方案与该作品当前的大纲设定（JSON）。",
    "请把方案中「涉及大纲」的决策合并进现有大纲，输出完整的新大纲 JSON（不要只输出差异）。",
    "要求：",
    "1. 保持现有结构（root.type 必须为 total；children 为卷/篇章/章节节点树）。",
    "2. 若方案未涉及大纲，则原样返回现有大纲。",
    "3. 只输出 JSON 对象，不要输出其他文字。",
    "",
    "## 当前大纲设定",
    JSON.stringify(current, null, 2),
    "",
    "## 讨论最终方案",
    opts.summary.trim(),
  ].join("\n");

  const resp = await opts.llm.achat([new ChatMessage(Role.USER, prompt)], { temperature: 0.3 });
  const data = extractJson(resp.content ?? "");
  if (!data || !data.root || typeof data.root !== "object") {
    throw new ChatApplyError("应用到大纲失败：模型输出格式异常（缺少 root 节点）");
  }
  const root = data.root as Record<string, unknown>;
  const outlineData = {
    template_id: String(data.template_id ?? (current.template_id as string) ?? ""),
    root: { type: "total", ...root },
  };
  settings.save(opts.projectId, "outline", outlineData);
  return { target: "outline", ok: true, message: "已应用到大纲设定", data: outlineData };
}

/** 让 LLM 把方案中与人物相关的决策合并进既有人设，返回完整 CharactersData。 */
async function applyToCharacters(opts: ChatApplyOptions): Promise<ChatApplyResult> {
  const settings = new SettingsStore(opts.projectStore);
  const current = settings.get(opts.projectId, "characters");

  const prompt = [
    "你是网文人物设计师。下面给出讨论最终方案与该作品当前的人物设定（JSON）。",
    "请把方案中「涉及人物」的决策合并进现有设定，输出完整的新人物设定 JSON（不要只输出差异）。",
    "要求：",
    "1. characters 必须是数组，每项含 id / name / role / dimensions（必要时含 relations）。",
    "2. 方案提到的新人物请新增，既有的人物请合并其变化。",
    "3. 若方案未涉及人物，则原样返回现有设定。",
    "4. 只输出 JSON 对象，不要输出其他文字。",
    "",
    "## 当前人物设定",
    JSON.stringify(current, null, 2),
    "",
    "## 讨论最终方案",
    opts.summary.trim(),
  ].join("\n");

  const resp = await opts.llm.achat([new ChatMessage(Role.USER, prompt)], { temperature: 0.3 });
  const data = extractJson(resp.content ?? "");
  if (!data || !Array.isArray(data.characters)) {
    throw new ChatApplyError("应用到人设失败：模型输出格式异常（缺少 characters 数组）");
  }
  const charactersData = {
    template_id: String(data.template_id ?? (current.template_id as string) ?? ""),
    characters: data.characters as Array<Record<string, unknown>>,
  };
  settings.save(opts.projectId, "characters", charactersData);
  return { target: "characters", ok: true, message: "已应用到人物设定", data: charactersData };
}

/** 统一入口：按目标应用最终方案。 */
export async function applyChatSessionPlan(opts: ChatApplyOptions): Promise<ChatApplyResult> {
  if (!opts.summary || !opts.summary.trim()) {
    throw new ChatApplyError("无最终方案可应用");
  }
  switch (opts.target) {
    case "document":
      return applyAsDocument(opts);
    case "outline":
      return applyToOutline(opts);
    case "characters":
      return applyToCharacters(opts);
    default:
      throw new ChatApplyError("未知应用目标: " + String(opts.target));
  }
}
