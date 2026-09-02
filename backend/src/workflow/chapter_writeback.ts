/** 正文章末回写与章尾钩子（工单 03）。
 * 正文生成后自动回写 8 类账本，每章结尾生成章尾钩子落盘到章节记录。 */
import { DynamicSettingsStore, type DynamicAccount } from "../storage/dynamic_settings.js";
import { findCharacterStateTemplate, resolveCharacterDimensions } from "../assets/character_state_templates.js";

export interface Hook {
  type: "悬念" | "反转" | "期待";
  content: string;
}

export interface WritebackData {
  chapter: number;
  content: string;
  hook: Hook | null;
  characterUpdates: Array<Record<string, unknown>>;
  locationUpdates: Array<Record<string, unknown>>;
  itemUpdates: Array<Record<string, unknown>>;
  events: Array<Record<string, unknown>>;
  timeline: Array<Record<string, unknown>>;
  foreshadowUpdates: Array<Record<string, unknown>>;
  infoPerspective: {
    truth: Array<Record<string, unknown>>;
    display: Array<Record<string, unknown>>;
  };
  chapterSummary: string;
}


/** 实体账本（人物/地点/物品）名称归一化：去首尾与内部空白，作为复合主键基础。 */
function normalizeEntityName(name: unknown): string {
  return String(name ?? "").trim().replace(/\s+/g, "");
}

/** 实体账本复合主键：账本类型 + 归一化名称，不再依赖模型自产 id。 */
function entityKeyOf(account: string, name: unknown): string {
  return account + "::" + normalizeEntityName(name);
}

/** 内容指纹：用于流式/台账账本的幂等去重。 */
function contentKey(...parts: unknown[]): string {
  return parts.map((p) => JSON.stringify(p ?? "")).join("|");
}
export class ChapterEndWriteback {
  private _dynamicStore: DynamicSettingsStore;

  constructor(dynamicStore: DynamicSettingsStore) {
    this._dynamicStore = dynamicStore;
  }

  /** 执行章末回写 */
  execute(projectId: string, data: WritebackData): void {
    const now = new Date().toISOString();
    const chapter = data.chapter;

    // 实体账本：人物/地点/物品 —— 按「类型+归一化名称」复合主键合并，稳定收敛重复实体
    this._mergeEntities(projectId, "characters", data.characterUpdates, chapter, now);
    this._mergeEntities(projectId, "locations", data.locationUpdates, chapter, now);
    this._mergeEntities(projectId, "items", data.itemUpdates, chapter, now);

    // 流式/台账账本：事件流 / 时间线 / 伏笔 —— 按内容指纹去重后追加，避免重复执行翻倍
    this._appendDedup(projectId, "events", data.events, ["chapter", "description"], chapter, now);
    this._appendDedup(projectId, "timeline", data.timeline, ["time", "event"], chapter, now);
    this._appendDedup(projectId, "foreshadow", data.foreshadowUpdates, ["planted_chapter", "description"], chapter, now);

    // 信息视角：truth/display 按 fact 指纹去重后追加
    this._mergeInfoPerspective(projectId, data.infoPerspective, chapter, now);

    // 章节摘要：一章一条，按章幂等覆盖（含章尾钩子）
    this._upsertChapterSummary(projectId, chapter, data.chapterSummary, data.hook, now);

    // 章尾钩子独立账本：一章一条，按章幂等覆盖（保留已衔接生命周期）
    this._upsertHook(projectId, chapter, data.hook, now);
    // 上一章钩子标记为已衔接（写下一章即消费上一章钩子）
    this._reapPreviousHook(projectId, chapter, now);
  }

  /** 计算并推进账本 meta（上次回写章节 + 更新时间）。 */
  private _bumpMeta(
    existing: DynamicAccount | null,
    chapter: number,
    now: string
  ): { last_chapter: number; updated_at: string } {
    const prev = (existing?.meta as { last_chapter?: number } | undefined) ?? {};
    return {
      last_chapter: Math.max(Number(prev.last_chapter ?? 0), chapter),
      updated_at: now,
    };
  }

  /** 实体账本合并：按复合主键 key（或归一化名称/旧 id）命中后合并，否则追加并落 key。 */
  private _mergeEntities(
    projectId: string,
    account: "characters" | "locations" | "items",
    updates: Array<Record<string, unknown>>,
    chapter: number,
    now: string
  ): void {
    const existing = this._dynamicStore.load(projectId, account);
    const entries = existing?.entries ? [...existing.entries] : [];
    for (const update of updates) {
      const key = entityKeyOf(account, update.name ?? update.id);
      const idx = entries.findIndex(
        (e) =>
          e.key === key ||
          (e.name !== undefined && normalizeEntityName(e.name) === normalizeEntityName(update.name)) ||
          (e.id !== undefined && update.id !== undefined && e.id === update.id)
      );
      if (idx >= 0) {
        entries[idx] = { ...entries[idx], ...update, key };
      } else {
        entries.push({ ...update, key });
      }
    }
    this._dynamicStore.update(projectId, account, {
      entries,
      meta: this._bumpMeta(existing, chapter, now),
    });
  }

  /** 流式/台账账本追加：按指定字段组的内容指纹全局去重。 */
  private _appendDedup(
    projectId: string,
    account: "events" | "timeline" | "foreshadow",
    updates: Array<Record<string, unknown>>,
    keyFields: string[],
    chapter: number,
    now: string
  ): void {
    const existing = this._dynamicStore.load(projectId, account);
    const entries = existing?.entries ? [...existing.entries] : [];
    const seen = new Set<string>(entries.map((e) => contentKey(...keyFields.map((k) => e[k]))));
    for (const update of updates) {
      const ck = contentKey(...keyFields.map((k) => update[k]));
      if (seen.has(ck)) continue;
      seen.add(ck);
      entries.push(update);
    }
    this._dynamicStore.update(projectId, account, {
      entries,
      meta: this._bumpMeta(existing, chapter, now),
    });
  }

  /** 信息视角合并：truth/display 分别按 fact 去重后追加。 */
  private _mergeInfoPerspective(
    projectId: string,
    info: { truth: Array<Record<string, unknown>>; display: Array<Record<string, unknown>> },
    chapter: number,
    now: string
  ): void {
    const existing = this._dynamicStore.load(projectId, "info_perspective");
    const truth = existing?.truth ? [...existing.truth] : [];
    const truthSeen = new Set<string>(truth.map((f) => contentKey(f.fact)));
    for (const t of info.truth ?? []) {
      const ck = contentKey(t.fact);
      if (truthSeen.has(ck)) continue;
      truthSeen.add(ck);
      truth.push(t);
    }
    const display = existing?.display ? [...existing.display] : [];
    const displaySeen = new Set<string>(display.map((f) => contentKey(f.fact)));
    for (const d of info.display ?? []) {
      const ck = contentKey(d.fact);
      if (displaySeen.has(ck)) continue;
      displaySeen.add(ck);
      display.push(d);
    }
    this._dynamicStore.update(projectId, "info_perspective", {
      truth,
      display,
      meta: this._bumpMeta(existing, chapter, now),
    });
  }

  /** 章节摘要：一章一条，按章幂等覆盖并按章节升序排列。 */
  private _upsertChapterSummary(
    projectId: string,
    chapter: number,
    summary: string,
    hook: Hook | null,
    now: string
  ): void {
    const existing = this._dynamicStore.load(projectId, "chapter_summaries");
    const entries = existing?.entries
      ? existing.entries.filter((e) => Number(e.chapter) !== chapter)
      : [];
    entries.push({ chapter, summary, hook: hook ?? null });
    entries.sort((a, b) => Number(a.chapter) - Number(b.chapter));
    this._dynamicStore.update(projectId, "chapter_summaries", {
      entries,
      meta: this._bumpMeta(existing, chapter, now),
    });
  }

  /** 章尾钩子独立账本：一章一条，按章幂等覆盖；已衔接（reaped）状态不被新回写重置。 */
  private _upsertHook(projectId: string, chapter: number, hook: Hook | null, now: string): void {
    const existing = this._dynamicStore.load(projectId, "hooks");
    const prev = existing?.entries?.find((e) => Number(e.chapter) === chapter);
    const entries = existing?.entries
      ? existing.entries.filter((e) => Number(e.chapter) !== chapter)
      : [];
    if (hook) {
      entries.push({
        chapter,
        type: hook.type,
        content: hook.content,
        status: prev?.status === "reaped" ? "reaped" : "open",
        reaped_chapter: prev?.reaped_chapter ?? null,
        created_at: prev?.created_at ?? now,
      });
    }
    entries.sort((a, b) => Number(a.chapter) - Number(b.chapter));
    this._dynamicStore.update(projectId, "hooks", {
      entries,
      meta: this._bumpMeta(existing, chapter, now),
    });
  }

  /** 写下一章时，把上一章的钩子标记为已衔接（reaped）。 */
  private _reapPreviousHook(projectId: string, chapter: number, now: string): void {
    if (chapter <= 1) return;
    const existing = this._dynamicStore.load(projectId, "hooks");
    if (!existing?.entries) return;
    const entries = [...existing.entries];
    let changed = false;
    for (const e of entries) {
      if (Number(e.chapter) === chapter - 1 && e.status !== "reaped") {
        e.status = "reaped";
        e.reaped_chapter = chapter;
        changed = true;
      }
    }
    if (changed) {
      this._dynamicStore.update(projectId, "hooks", {
        entries,
        meta: this._bumpMeta(existing, chapter, now),
      });
    }
  }
}
import type { LLMClient } from "../llm/client.js";
import { ChatMessage, Role } from "../llm/models.js";
import type { ProjectStore } from "../storage/project_store.js";
import type { MemoryStore } from "../storage/memory_store.js";
import type { SettingsStore } from "../storage/settings_store.js";

/** 解析 LLM 产出的回写 JSON（容忍 markdown 代码块包裹与前后杂文本） */
function parseWritebackJson(text: string): Record<string, unknown> | null {
  if (!text) return null;
  const cleaned = text.replace(/```(?:json)?\s*/gi, "").replace(/```/g, "").trim();
  try {
    const data = JSON.parse(cleaned);
    return data && typeof data === "object" ? (data as Record<string, unknown>) : null;
  } catch {
    /* 尝试截取首个 { ... } */
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        const data = JSON.parse(cleaned.slice(start, end + 1));
        return data && typeof data === "object" ? (data as Record<string, unknown>) : null;
      } catch {
        return null;
      }
    }
    return null;
  }
}

function asArray(v: unknown): Array<Record<string, unknown>> {
  return Array.isArray(v) ? (v as Array<Record<string, unknown>>) : [];
}

/** 正文章末自动串联（ADR-0009）：由 LLM 产出回写数据 → 章尾钩子 → 8 账本回写 → L1 摘要。
 * 正文由模型产出后，save_document(kind=chapter) 自动调用本函数；失败不影响正文落盘。 */
export async function runChapterAutoWriteback(opts: {
  client: LLMClient;
  projectStore: ProjectStore;
  memory: MemoryStore;
  settingsStore: SettingsStore;
  projectId: string;
  no: number;
  title: string;
  content: string;
  signal?: AbortSignal;
}): Promise<{ success: boolean; summary: string; hook: Hook | null; error: string }> {
  const { client, projectStore, projectId, no, title, content, signal } = opts;
  try {
    // 上下文提示：人物/世界观/大纲片段，帮助模型产出与设定一致的账本更新
    const hints: string[] = [];
    const chars = opts.settingsStore.exists(projectId, "characters") ? opts.settingsStore.get(projectId, "characters") : null;
    if (chars) hints.push("人物设定：" + JSON.stringify(chars).slice(0, 1200));
    const wv = opts.settingsStore.exists(projectId, "worldview") ? opts.settingsStore.get(projectId, "worldview") : null;
    if (wv) hints.push("世界观设定：" + JSON.stringify(wv).slice(0, 1200));

    // 题材维度模板：驱动人物状态字段（非硬约束，模型可自由追加字段）；项目自定义维度优先
    const project = projectStore.get(projectId);
    const genre = project?.genre ?? "";
    const baseTemplate = findCharacterStateTemplate(genre);
    const templateDims = resolveCharacterDimensions(genre, project?.character_dimensions);
    const charSchemaFields = templateDims
      .map((d) => '"' + d.key + '": "' + d.hint + '的变化"')
      .join(", ");
    const charUpdatesExample =
      '{"id": "人物id或姓名", "name": "姓名", "status": "当前状态一句话", ' + charSchemaFields + ", ...其他相关字段}";
    hints.push(
      "本作题材：" + baseTemplate.label + "。人物状态重点关注维度：" + templateDims.map((d) => d.label).join("、") + "。"
    );

    const system = `你是一本网络小说的"世界真相层"记录员。根据本章正文，产出严格 JSON（不要输出任何其他文字、不要 markdown 代码块）：
{
  \"hook\": {\"type\": \"悬念|反转|期待\", \"content\": \"章尾钩子一句话\"} 或 null（终章可空）, 
  \"characterUpdates\": [${charUpdatesExample}],
  \"locationUpdates\": [{\"id\": \"\", \"name\": \"地点/势力名\", \"status\": \"当前状态\"}],
  \"itemUpdates\": [{\"id\": \"\", \"name\": \"物品名\", \"owner\": \"持有者\", \"status\": \"\"}],
  \"events\": [{\"chapter\": ${no}, \"description\": \"本章发生的事件\"}],
  \"timeline\": [{\"time\": \"故事时间\", \"event\": \"事件\"}],
  \"foreshadowUpdates\": [{\"planted_chapter\": 数值, \"expected_chapter\": 数值, \"status\": \"埋设|悬置|消费|超期\", \"description\": \"伏笔内容\"}],
  \"infoPerspective\": {\"truth\": [{\"fact\": \"世界实际事实\"}], \"display\": [{\"fact\": \"读者已被告知的信息\"}]},
  \"chapterSummary\": \"3-5 句本章摘要（含悬念钩子），中文\"
}`;
    const resp = await client.achat(
      [
        new ChatMessage(Role.SYSTEM, system),
        new ChatMessage(Role.USER, (hints.length ? hints.join("\n\n") + "\n\n" : "") + "## 第 " + no + " 章正文\n" + content.slice(0, 20000)),
      ],
      { temperature: 0.3, max_tokens: 2500, response_format: { type: "json_object" } },
      signal
    );
    const data = parseWritebackJson(resp.content);
    if (!data) return { success: false, summary: "", hook: null, error: "无法解析回写 JSON" };

    const hookRaw = data.hook as Record<string, unknown> | null | undefined;
    const hook: Hook | null =
      hookRaw && typeof hookRaw === "object" && typeof hookRaw.content === "string"
        ? { type: (hookRaw.type as Hook["type"]) ?? "悬念", content: hookRaw.content }
        : null;
    const writebackData: WritebackData = {
      chapter: no,
      content,
      hook,
      characterUpdates: asArray(data.characterUpdates),
      locationUpdates: asArray(data.locationUpdates),
      itemUpdates: asArray(data.itemUpdates),
      events: asArray(data.events),
      timeline: asArray(data.timeline),
      foreshadowUpdates: asArray(data.foreshadowUpdates),
      infoPerspective: {
        truth: asArray((data.infoPerspective as Record<string, unknown> | undefined)?.truth),
        display: asArray((data.infoPerspective as Record<string, unknown> | undefined)?.display),
      },
      chapterSummary: String(data.chapterSummary ?? ""),
    };

    const dynamicStore = new DynamicSettingsStore(projectStore);
    const writeback = new ChapterEndWriteback(dynamicStore);
    writeback.execute(projectId, writebackData);

    // L1 摘要入库（与 writeChapterFlow 语义一致）
    const summary = writebackData.chapterSummary || (content.slice(0, 200) + "...");
    try {
      opts.memory.saveSummary(projectId, 1, summary, "ch" + no);
      opts.memory.addFact(projectId, "第" + no + "章《" + title + "》已完成：" + summary.slice(0, 300), "ch" + no, "writing");
    } catch (err) {
      console.warn("L1 摘要入库失败: " + err);
    }
    return { success: true, summary, hook, error: "" };
  } catch (err) {
    return { success: false, summary: "", hook: null, error: err instanceof Error ? err.message : String(err) };
  }
}

