/** 工作流路由（TS 版）：设定生成 / 正文四步 / 选段修改 / 审阅五步。 */
import type { FastifyInstance } from "fastify";
import { getProjectStore, getClientForState } from "../state.js";
import { SettingsStore } from "../../storage/settings_store.js";
import { MemoryStore } from "../../storage/memory_store.js";
import { ChapterStore, prereqCheck, writeChapterFlow, rewriteSelectionFlow, applyRewriteFlow } from "../../workflow/chapters.js";
import { reviewChapterFlow, applyReviewSuggestion, markReviewed } from "../../workflow/review.js";
import { generateAll, SettingsGenerator } from "../../workflow/settings_generator.js";
import { ProjectNotFoundError } from "../../storage/project_store.js";


function settingTypeToState(settingType: string): string {
  const map: Record<string, string> = {
    worldview: "worldview",
    characters: "characters",
    outline: "outline",
    style: "worldview",
  };
  return map[settingType] ?? "worldview";
}

export async function workflowRoutes(app: FastifyInstance): Promise<void> {
  const store = () => getProjectStore();

  // ---- 设定生成 ----
  app.post<{ Params: { id: string }; Body: { setting_type?: string } }>("/:id/settings/generate", async (req, reply) => {
    let project;
    try {
      project = store().get(req.params.id);
    } catch (err) {
      if (err instanceof ProjectNotFoundError) return reply.code(404).send({ error: err.message });
      throw err;
    }
    let client;
    try {
      client = getClientForState(settingTypeToState(req.body?.setting_type ?? "all"));
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
    const settings = new SettingsStore(store());
    try {
      const settingType = req.body?.setting_type ?? "all";
      if (settingType === "all") {
        const results = await generateAll(client, settings, project);
        return { success: true, settings: results };
      }
      const data = await new SettingsGenerator(client, settings).generate(project, settingType);
      return { success: true, settings: { [settingType]: data } };
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      client.close();
    }
  });

  // ---- 章节列表 / 详情 ----
  app.get<{ Params: { id: string } }>("/:id/chapters", async (req, reply) => {
    try {
      const cs = new ChapterStore(store());
      const index = cs.loadIndex(req.params.id);
      const memory = new MemoryStore(store());
      return { chapters: index.chapters, prereq: prereqCheck(new SettingsStore(store()), req.params.id), memory_stats: memory.stats(req.params.id) };
    } catch (err) {
      return reply.code(404).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.get<{ Params: { id: string; no: string } }>("/:id/chapters/:no", async (req, reply) => {
    try {
      const cs = new ChapterStore(store());
      const { record, content, path: filePath } = cs.getChapter(req.params.id, Number(req.params.no));
      if (!record) return reply.code(404).send({ error: "章节不存在" });
      return { record, content, path: filePath };
    } catch (err) {
      return reply.code(404).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ---- 正文四步（T9） ----
  app.post<{ Params: { id: string; no: string }; Body: { title?: string; note?: string; block_when_incomplete?: boolean } }>("/:id/chapters/:no/write", async (req, reply) => {
    let client;
    try {
      client = getClientForState("writing");
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
    try {
      const result = await writeChapterFlow({
        client,
        projectStore: store(),
        memory: new MemoryStore(store()),
        settingsStore: new SettingsStore(store()),
        projectId: req.params.id,
        no: Number(req.params.no),
        title: req.body?.title,
        note: req.body?.note,
        blockWhenIncomplete: req.body?.block_when_incomplete ?? false,
      });
      if (result.blocked) return reply.code(400).send(result);
      return result;
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      client.close();
    }
  });

  // ---- 选段修改（T9） ----
  app.post<{ Params: { id: string; no: string }; Body: { selection?: string; instruction?: string } }>("/:id/chapters/:no/rewrite", async (req, reply) => {
    const selection = String(req.body?.selection ?? "").trim();
    const instruction = String(req.body?.instruction ?? "").trim();
    if (!selection) return reply.code(400).send({ success: false, original: "", rewritten: "", error: "selection 不能为空" });
    if (!instruction) return reply.code(400).send({ success: false, original: "", rewritten: "", error: "instruction 不能为空" });
    let client;
    try {
      client = getClientForState("writing");
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
    try {
      const result = await rewriteSelectionFlow({
        client,
        projectStore: store(),
        projectId: req.params.id,
        no: Number(req.params.no),
        selection,
        instruction,
      });
      return result;
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      client.close();
    }
  });

  app.post<{ Params: { id: string; no: string }; Body: { selection?: string; rewritten?: string } }>("/:id/chapters/:no/rewrite/apply", async (req, reply) => {
    const result = applyRewriteFlow({
      projectStore: store(),
      projectId: req.params.id,
      no: Number(req.params.no),
      selection: String(req.body?.selection ?? ""),
      rewritten: String(req.body?.rewritten ?? ""),
    });
    if (!result.success) return reply.code(400).send(result);
    return result;
  });

  // ---- 审阅五步（T9） ----
  app.post<{ Params: { id: string; no: string } }>("/:id/chapters/:no/review", async (req, reply) => {
    let client;
    try {
      client = getClientForState("review");
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
    try {
      const result = await reviewChapterFlow({
        client,
        projectStore: store(),
        memory: new MemoryStore(store()),
        settingsStore: new SettingsStore(store()),
        projectId: req.params.id,
        no: Number(req.params.no),
      });
      if (!result.success) return reply.code(404).send(result);
      return result;
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      client.close();
    }
  });

  app.post<{ Params: { id: string; no: string }; Body: Record<string, unknown> }>("/:id/chapters/:no/review/apply", async (req, reply) => {
    const suggestion = req.body?.suggestion as { original?: string; rewritten?: string } | undefined;
    if (!suggestion) return reply.code(400).send({ success: false, error: "缺少 suggestion" });
    const result = applyReviewSuggestion({
      projectStore: store(),
      projectId: req.params.id,
      no: Number(req.params.no),
      suggestion: {
        id: "manual",
        location: "",
        issue: "",
        suggestion: "",
        original: String(suggestion.original ?? ""),
        rewritten: String(suggestion.rewritten ?? ""),
      },
    });
    if (!result.success) return reply.code(400).send(result);
    return result;
  });

  app.post<{ Params: { id: string; no: string } }>("/:id/chapters/:no/review/approve", async (req, reply) => {
    const result = markReviewed({ projectStore: store(), projectId: req.params.id, no: Number(req.params.no) });
    if (!result.success) return reply.code(404).send(result);
    return result;
  });
}
