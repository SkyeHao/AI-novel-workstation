/** 单书记忆存储（ADR-0005 / T5，TS 版，迁移自 storage/memory_store.py）。
 * 四类记忆：facts.jsonl / characters.json / foreshadow.jsonl / summaries/L1..L5.json */
import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { ProjectNotFoundError, type ProjectStore } from "./project_store.js";

export const FACTS_FILE = "facts.jsonl";
export const FORESHADOW_FILE = "foreshadow.jsonl";
export const CHARACTERS_FILE = "characters.json";
export const SUMMARIES_DIR = "summaries";
export const SUMMARY_LEVELS = [1, 2, 3, 4, 5];

export class MemoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MemoryError";
  }
}

function nowSeconds(): string {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

export class MemoryStore {
  private _projectStore: ProjectStore;

  constructor(projectStore: ProjectStore) {
    this._projectStore = projectStore;
  }

  private _memoryDir(projectId: string): string {
    const root = this._projectStore.project_root(projectId);
    if (!fs.existsSync(root)) throw new ProjectNotFoundError(`项目不存在: ${projectId}`);
    const d = path.join(root, "memory");
    fs.mkdirSync(d, { recursive: true });
    return d;
  }

  private _summariesDir(projectId: string): string {
    const d = path.join(this._memoryDir(projectId), SUMMARIES_DIR);
    fs.mkdirSync(d, { recursive: true });
    return d;
  }

  // ---------- 正典事实（append-only） ----------

  addFact(
    projectId: string,
    fact: string,
    source = "",
    state = "",
    knownBy: string[] | null = null,
    supersedes: string | null = null
  ): Record<string, unknown> {
    const record: Record<string, unknown> = {
      id: randomUUID(),
      ts: nowSeconds(),
      fact,
      source,
      state,
      known_by: knownBy ?? [],
      supersedes,
    };
    appendRecord(this._memoryDir(projectId), FACTS_FILE, record);
    return record;
  }

  listFacts(projectId: string): Record<string, unknown>[] {
    return readRecords(this._memoryDir(projectId), FACTS_FILE);
  }

  findFacts(projectId: string, opts: { state?: string; source?: string; keyword?: string } = {}): Record<string, unknown>[] {
    const records = this.listFacts(projectId);
    const out: Record<string, unknown>[] = [];
    for (const r of records) {
      if (opts.state && r.state !== opts.state) continue;
      if (opts.source && r.source !== opts.source) continue;
      if (opts.keyword && typeof r.fact === "string" && !r.fact.includes(opts.keyword)) continue;
      out.push(r);
    }
    return out;
  }

  // ---------- 伏笔台账（append-only） ----------

  addForeshadow(
    projectId: string,
    desc: string,
    plantedAt = "",
    plannedReap = "",
    status = "planted"
  ): Record<string, unknown> {
    const record: Record<string, unknown> = {
      id: randomUUID(),
      ts: nowSeconds(),
      desc,
      planted_at: plantedAt,
      reaped_at: "",
      planned_reap: plannedReap,
      status,
    };
    appendRecord(this._memoryDir(projectId), FORESHADOW_FILE, record);
    return record;
  }

  listForeshadow(projectId: string): Record<string, unknown>[] {
    return readRecords(this._memoryDir(projectId), FORESHADOW_FILE);
  }

  activeForeshadow(projectId: string): Record<string, unknown>[] {
    return this.listForeshadow(projectId).filter((r) => r.status !== "reaped");
  }

  /** 收/兑现伏笔：按 id 修改状态（追加一条修正记录并即时重写 jsonl） */
  updateForeshadow(projectId: string, id: string, status: "planted" | "reaped" | "dropped", reapInfo = ""): Record<string, unknown> | null {
    const records = this.listForeshadow(projectId);
    const idx = records.findIndex((r) => r.id === id);
    if (idx < 0) return null;
    const rec = records[idx]!;
    rec.status = status;
    if (status === "reaped") rec.reaped_at = nowSeconds();
    if (reapInfo) rec.reap_info = reapInfo;
    writeRecords(this._memoryDir(projectId), FORESHADOW_FILE, records);
    return rec;
  }

  // ---------- 人物/关系快照（json 重写） ----------

  saveCharacters(projectId: string, data: Record<string, unknown>): Record<string, unknown> {
    if (!data.characters) data.characters = [];
    const p = path.join(this._memoryDir(projectId), CHARACTERS_FILE);
    fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf-8");
    return data;
  }

  loadCharacters(projectId: string): Record<string, unknown> {
    const p = path.join(this._memoryDir(projectId), CHARACTERS_FILE);
    if (!fs.existsSync(p)) return { characters: [] };
    try {
      const data = JSON.parse(fs.readFileSync(p, "utf-8"));
      if (data && typeof data === "object") return data;
    } catch {
      console.warn(`人物快照损坏，返回默认: ${p}`);
    }
    return { characters: [] };
  }

  // ---------- 分层摘要（json 原子重写） ----------

  saveSummary(projectId: string, level: number, content: string, state = ""): Record<string, unknown> {
    validateLevel(level);
    const p = path.join(this._summariesDir(projectId), `L${level}.json`);
    const data = { level, ts: nowSeconds(), state, content };
    fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf-8");
    return data;
  }

  loadSummary(projectId: string, level: number): string {
    validateLevel(level);
    const p = path.join(this._summariesDir(projectId), `L${level}.json`);
    if (!fs.existsSync(p)) return "";
    try {
      const data = JSON.parse(fs.readFileSync(p, "utf-8")) as { content?: string };
      return data.content ?? "";
    } catch {
      console.warn(`分层摘要损坏: ${p}`);
      return "";
    }
  }

  /** 完整性检视：返回当前单书记忆统计（供工作台/审阅展示） */
  stats(projectId: string): Record<string, number> {
    return {
      facts: this.listFacts(projectId).length,
      foreshadow: this.listForeshadow(projectId).length,
      characters: (this.loadCharacters(projectId).characters as unknown[] | undefined)?.length ?? 0,
      summaries: SUMMARY_LEVELS.filter((l) => this.loadSummary(projectId, l) !== "").length,
    };
  }
}

function validateLevel(level: number): void {
  if (!SUMMARY_LEVELS.includes(level)) throw new MemoryError(`不支持的摘要层级: ${level}（允许 1..5）`);
}

export function appendRecord(memoryDir: string, file: string, record: Record<string, unknown>): void {
  const p = path.join(memoryDir, file);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.appendFileSync(p, JSON.stringify(record) + "\n", "utf-8");
}

export function readRecords(memoryDir: string, file: string): Record<string, unknown>[] {
  const p = path.join(memoryDir, file);
  if (!fs.existsSync(p)) return [];
  const records: Record<string, unknown>[] = [];
  const lines = fs.readFileSync(p, "utf-8").split(/\r?\n/);
  for (const lineRaw of lines) {
    const line = lineRaw.trim();
    if (!line) continue;
    try {
      records.push(JSON.parse(line) as Record<string, unknown>);
    } catch {
      console.warn(`忽略损坏记录行: ${p}: ${line.slice(0, 60)}`);
    }
  }
  return records;
}

export function writeRecords(memoryDir: string, file: string, records: Record<string, unknown>[]): void {
  const p = path.join(memoryDir, file);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, records.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf-8");
}
