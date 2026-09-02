import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ProjectStore } from "../src/storage/project_store.js";
import { DocumentRegistry, NODE_WRITABLE, NODE_READABLE, DOCUMENT_KINDS, parseWorkUnit, dynamicDocInfo } from "../src/storage/document_registry.js";

let dir: string;
let store: ProjectStore;
let registry: DocumentRegistry;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "anw-doc-"));
  store = new ProjectStore(dir);
  store.create("书A", "", { genre: "玄幻" });
  registry = new DocumentRegistry(store);
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("DocumentRegistry（ADR-0009 节点域文档）", () => {
  it("登记表按 kind 过滤，写入即登记", () => {
    const p = store.create("书B");
    fs.writeFileSync(path.join(dir, p.id, "世界观设定文档.md"), "# 世界观", "utf-8");
    registry.register(p.id, "worldview", "世界观设定文档.md", "世界观设定文档", null);
    const all = registry.list(p.id);
    const wv = registry.list(p.id, "worldview");
    expect(all.some((d) => d.kind === "worldview")).toBe(true);
    expect(wv.length).toBe(1);
    expect(wv[0]!.title).toBe("世界观设定文档");
  });

  it("静态文档解析为标准路径", () => {
    const r = registry.resolvePath("书A", "worldview");
    expect(r.relPath).toBe("世界观设定文档.md");
    const r2 = registry.resolvePath("书A", "core-elements");
    expect(r2.relPath).toBe("核心要素.json");
  });

  it("chapter / review 需 work_unit 且解析为分章路径", () => {
    const ch = registry.resolvePath("书A", "chapter", "ch3");
    expect(ch.relPath).toBe("chapters/3.md");
    const rv = registry.resolvePath("书A", "review", "3");
    expect(rv.relPath).toBe("review/3-审阅报告.md");
    expect(() => registry.resolvePath("书A", "chapter", "")).toThrow();
  });

  it("read 读取标准文件内容，未生成返回 null", () => {
    expect(registry.read("书A", "worldview")).toBeNull();
    fs.writeFileSync(path.join(dir, "书A", "世界观设定文档.md"), "# 世界观内容", "utf-8");
    const doc = registry.read("书A", "worldview");
    expect(doc).not.toBeNull();
    expect(doc!.content).toContain("世界观内容");
  });

  it("节点 × kind 矩阵完整覆盖 8 类文档", () => {
    const all = Array.from(new Set([...Object.values(NODE_WRITABLE).flat(), ...Object.values(NODE_READABLE).flat()]));
    expect(all.sort()).toEqual([...DOCUMENT_KINDS].filter((k) => k !== "plan").sort());
    expect(DOCUMENT_KINDS).toContain("plan");
    expect(NODE_WRITABLE.ideation).toContain("core-elements");
    expect(NODE_READABLE.writing).toContain("outline");
    expect(NODE_WRITABLE.writing).toContain("chapter");
  });

  it("parseWorkUnit 支持 ch3 / 第3章 / 3", () => {
    expect(parseWorkUnit("ch3")).toBe(3);
    expect(parseWorkUnit("第3章")).toBe(3);
    expect(parseWorkUnit("3")).toBe(3);
    expect(parseWorkUnit("abc")).toBeNull();
    expect(dynamicDocInfo("chapter", "ch3")!.relPath).toBe("chapters/3.md");
  });

  it("登记表为空时扫描标准路径回填", () => {
    const p = store.create("书C");
    fs.writeFileSync(path.join(dir, p.id, "风格规范文档.md"), "# 风格", "utf-8");
    const docs = registry.list(p.id);
    const style = docs.find((d) => d.kind === "style");
    expect(style).toBeDefined();
    expect(style!.path).toBe("风格规范文档.md");
  });

  it("plan 文档登记表为空时可扫描回填", () => {
    const p = store.create("书D");
    const disc = path.join(dir, p.id, "memory", "discussions");
    fs.mkdirSync(disc, { recursive: true });
    fs.writeFileSync(path.join(disc, "方案-abc123.md"), "# 方案", "utf-8");
    const docs = registry.list(p.id, "plan");
    expect(docs.length).toBe(1);
    expect(docs[0]!.kind).toBe("plan");
    expect(docs[0]!.path).toBe("memory/discussions/方案-abc123.md");
  });
});
