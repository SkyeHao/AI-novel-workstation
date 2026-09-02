import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ProjectStore } from "../src/storage/project_store.js";
import { MemoryStore } from "../src/storage/memory_store.js";
import { SettingsStore } from "../src/storage/settings_store.js";
import { SaveDocumentTool, ReadDocumentTool, type DocumentToolContext } from "../src/tools/document_tools.js";
import type { LLMClient } from "../src/llm/client.js";

let dir: string;
let store: ProjectStore;
let ctx: DocumentToolContext;
const projectId = "书A";

function makeCtx(state: string, workUnit = ""): DocumentToolContext {
  return {
    projectId,
    projectStore: store,
    memory: new MemoryStore(store),
    settingsStore: new SettingsStore(store),
    client: {} as unknown as LLMClient,
    getCurrentState: () => state,
    getWorkUnit: () => workUnit,
  };
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "anw-tool-"));
  store = new ProjectStore(dir);
  store.create(projectId, "", { genre: "玄幻" });
  ctx = makeCtx("ideation");
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("节点域文档工具（ADR-0009）", () => {
 it("save_document 当前节点不可写时拒绝", async () => {
   const tool = new SaveDocumentTool(ctx);
   const res = await tool.execute({ kind: "worldview", content: "# 世界观" });
    expect(res.success).toBe(false);
    expect(res.error.includes("不可写")).toBe(true);
 });

 it("save_document 写愿景文档并登记，read_document 读回", async () => {
   const save = new SaveDocumentTool(ctx);
   const sres = await save.execute({ kind: "vision", content: "# 愿景文档", title: "故事愿景" });
    expect(sres.success).toBe(true);
   expect(fs.existsSync(path.join(dir, projectId, "故事愿景文档.md"))).toBe(true);
   const read = new ReadDocumentTool(ctx);
   const rres = await read.execute({ kind: "vision" });
    expect(rres.success).toBe(true);
    expect(rres.output).toContain("愿景文档");
 });

 it("read_document 当前节点不可读时拒绝", async () => {
   const tool = new ReadDocumentTool(ctx);
   const res = await tool.execute({ kind: "chapter", work_unit: "ch1" });
    expect(res.success).toBe(false);
    expect(res.error.includes("不可读")).toBe(true);
 });

 it("core-elements 必须为合法 JSON", async () => {
   const tool = new SaveDocumentTool(ctx);
   const bad = await tool.execute({ kind: "core-elements", content: "not json" });
    expect(bad.success).toBe(false);
   const good = await tool.execute({ kind: "core-elements", content: JSON.stringify({ main: "A" }) });
    expect(good.success).toBe(true);
 });

 it("worldview 节点可写世界观文档", async () => {
   const wctx = makeCtx("worldview");
   const tool = new SaveDocumentTool(wctx);
   const res = await tool.execute({ kind: "worldview", content: "# 世界观" });
    expect(res.success).toBe(true);
 });
});
