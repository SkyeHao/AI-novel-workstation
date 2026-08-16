import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ProjectStore } from "../src/storage/project_store.js";
import { MemoryStore } from "../src/storage/memory_store.js";
import { createRetriever, KeywordMemoryRetriever } from "../src/storage/retriever.js";

let dir: string;
let store: ProjectStore;
let memory: MemoryStore;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "anw-mem-"));
  store = new ProjectStore(dir);
  memory = new MemoryStore(store);
  store.create("书A", "测试书", { status: "writing" });
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("MemoryStore（T5）", () => {
  it("正典事实 append-only + 过滤 + supersedes", () => {
    const r1 = memory.addFact("书A", "主角叫林一", "ch1", "writing");
    memory.addFact("书A", "林一的金手指是时间回溯", "ch2", "writing");
    const supersedes = memory.addFact("书A", "金手指改为空间折叠", "ch3", "writing", null, r1.id);
    const facts = memory.listFacts("书A");
    expect(facts.length).toBe(3);
    expect(facts.some((f) => f.supersedes === r1.id)).toBe(true);
    const onlyWriting = memory.findFacts("书A", { state: "writing" });
    expect(onlyWriting.length).toBe(3);
    const kw = memory.findFacts("书A", { keyword: "时间回溯" });
    expect(kw.length).toBe(1);
    expect(supersedes.id).toBeTruthy();
  });

  it("伏笔台账 埋/收/活跃", () => {
    memory.addForeshadow("书A", "主角捡到的玉佩藏着秘密", "第1章", "第20章");
    const f2 = memory.addForeshadow("书A", "老宅地下的青铜门", "第3章", "结尾卷");
    memory.updateForeshadow("书A", f2.id, "reaped", "在结局卷揭晓");
    const active = memory.activeForeshadow("书A");
    expect(active.length).toBe(1);
    expect(active[0]!.desc).toBe("主角捡到的玉佩藏着秘密");
  });

  it("人物快照读写", () => {
    memory.saveCharacters("书A", { characters: [{ id: "c1", name: "林一" }] });
    const loaded = memory.loadCharacters("书A");
    expect((loaded.characters as unknown[]).length).toBe(1);
  });

  it("分层摘要 L1..L5 读写", () => {
    memory.saveSummary("书A", 1, "第一章摘要", "ch1");
    memory.saveSummary("书A", 2, "第一卷摘要", "vol1");
    expect(memory.loadSummary("书A", 1)).toBe("第一章摘要");
    expect(memory.loadSummary("书A", 5)).toBe("");
    const stats = memory.stats("书A");
    expect(stats.summaries).toBe(2);
  });

  it("损坏行被忽略", () => {
    const p = path.join(dir, "书A", "memory", "facts.jsonl");
    fs.appendFileSync(p, "{bad json}\n", "utf-8");
    expect(memory.listFacts("书A").length).toBe(0);
  });
});

describe("MemoryRetriever（T6）", () => {
  it("keyword 三管召回：fact + foreshadow 去重截断", () => {
    memory.addFact("书A", "主角名字林一", "ch1", "writing");
    memory.addFact("书A", "反派出卖主角", "ch4", "writing");
    memory.addForeshadow("书A", "林一腰间的令牌", "第2章", "第9章");
    const retriever = createRetriever(memory);
    expect(retriever).toBeInstanceOf(KeywordMemoryRetriever);
    const hits = retriever.retrieve("书A", { query: "林一", limit: 10 });
    expect(hits.some((h) => h.kind === "fact")).toBe(true);
    expect(hits.some((h) => h.kind === "foreshadow")).toBe(true);
    const injected = retriever.injectAll("书A", { state: "writing", limit: 10 });
    expect(injected.some((h) => h.kind === "active_foreshadow")).toBe(true);
  });
});
