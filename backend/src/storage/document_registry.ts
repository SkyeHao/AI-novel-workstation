/** 文档登记表与节点域文档矩阵（ADR-0009）。
 * 每种文档 kind 有标准存储路径，Agent 通过 save_document / read_document 访问，
 * 路径完全由程序决定，模型不能传任意路径。写入即登记到 settings/documents.json，
 * 前端按 kind 查询，去掉硬编码文件名；登记表为空时扫描标准路径回填兜底。 */
import * as fs from "node:fs";
import * as path from "node:path";
import type { ProjectStore } from "./project_store.js";
import { ChapterStore } from "../workflow/chapters.js";

export type DocumentKind =
  | "core-elements"
  | "vision"
  | "worldview"
  | "characters"
  | "outline"
  | "chapter"
  | "review"
  | "style"
  | "plan";

export const DOCUMENT_KINDS: DocumentKind[] = [
  "core-elements",
  "vision",
  "worldview",
  "characters",
  "outline",
  "chapter",
  "review",
  "style",
  "plan",
];

export interface DocumentEntry {
  kind: DocumentKind;
  title: string;
  /** 相对项目根路径（/ 分隔） */
  path: string;
  work_unit: string | null;
  modified: number;
}

interface RegistryFile {
  documents: DocumentEntry[];
}

export const REGISTRY_RELPATH = "settings/documents.json";

/** 节点 × kind 可写矩阵 */
export const NODE_WRITABLE: Record<string, DocumentKind[]> = {
  ideation: ["core-elements", "vision"],
  worldview: ["worldview"],
  characters: ["characters"],
  outline: ["outline"],
  writing: ["chapter"],
  review: ["review"],
  style: ["style", "chapter"],
};

/** 节点 × kind 可读矩阵 */
export const NODE_READABLE: Record<string, DocumentKind[]> = {
  ideation: ["core-elements", "vision"],
  worldview: ["core-elements", "vision", "worldview"],
  characters: ["core-elements", "vision", "worldview", "characters"],
  outline: ["core-elements", "vision", "worldview", "characters", "outline"],
  writing: ["outline", "style", "chapter"],
  review: ["chapter", "worldview", "characters", "outline", "style"],
  style: ["chapter", "style", "characters"],
};

export const KIND_LABELS: Record<DocumentKind, string> = {
  "core-elements": "核心要素",
  vision: "故事愿景文档",
  worldview: "世界观设定文档",
  characters: "人物设定文档",
  outline: "大纲设定文档",
  chapter: "章节正文",
  review: "审阅报告",
  style: "风格规范文档",
  plan: "群聊讨论方案",
};

/** 静态文档的标准文件名（相对项目根） */
export const STATIC_DOC_FILES: Partial<Record<DocumentKind, string>> = {
  "core-elements": "核心要素.json",
  vision: "故事愿景文档.md",
  worldview: "世界观设定文档.md",
  characters: "人物设定文档.md",
  outline: "大纲设定文档.md",
  style: "风格规范文档.md",
};

/** 是否 JSON 格式（目前仅 core-elements） */
export function isJsonKind(kind: DocumentKind): boolean {
  return kind === "core-elements";
}

/** 是否需要 work_unit（chapter / review） */
export function isWorkUnitKind(kind: DocumentKind): boolean {
  return kind === "chapter" || kind === "review";
}

/** 解析工作单元（ch3 / 3 / 第3章 → 3），非法返回 null */
export function parseWorkUnit(workUnit: string): number | null {
  const raw = String(workUnit ?? "").trim().toLowerCase();
  if (!raw) return null;
  const m = raw.match(/(?:ch|第)?\s*(\d+)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** 由 work_unit 派生 chapter / review 的存储信息 */
export function dynamicDocInfo(kind: DocumentKind, workUnit: string): { relPath: string; title: string; no: number } | null {
  const no = parseWorkUnit(workUnit);
  if (no === null) return null;
  if (kind === "chapter") {
    return { relPath: "chapters/" + no + ".md", title: "第 " + no + " 章", no };
  }
  if (kind === "review") {
    return { relPath: "review/" + no + "-审阅报告.md", title: "第 " + no + " 章审阅报告", no };
  }
  return null;
}

export class DocumentRegistry {
  private _projectStore: ProjectStore;

  constructor(projectStore: ProjectStore) {
    this._projectStore = projectStore;
  }

  private _registryFile(projectId: string): string {
    return this._projectStore.resolve(projectId, REGISTRY_RELPATH);
  }

  private _readFile(projectId: string): RegistryFile {
    const p = this._registryFile(projectId);
    if (!fs.existsSync(p)) return { documents: [] };
    try {
      const data = JSON.parse(fs.readFileSync(p, "utf-8")) as RegistryFile;
      return { documents: Array.isArray(data.documents) ? data.documents : [] };
    } catch {
      return { documents: [] };
    }
  }

  private _writeFile(projectId: string, registry: RegistryFile): void {
    const p = this._registryFile(projectId);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(registry, null, 2), "utf-8");
  }

  /** 列出文档（按 kind 过滤可选）；登记表为空时扫描标准路径回填 */
  list(projectId: string, kind?: DocumentKind): DocumentEntry[] {
    let registry = this._readFile(projectId);
    if (registry.documents.length === 0) {
      registry = { documents: this._scanBackfill(projectId) };
      this._writeFile(projectId, registry);
    }
    const docs = kind ? registry.documents.filter((d) => d.kind === kind) : registry.documents;
    return [...docs].sort((a, b) => a.path.localeCompare(b.path));
  }

  /** 写入即登记：把该 kind 的标准文件登记进登记表（新增或更新） */
  register(projectId: string, kind: DocumentKind, relPath: string, title: string, workUnit: string | null): DocumentEntry {
    const full = this._projectStore.resolve(projectId, relPath);
    const modified = fs.existsSync(full) ? fs.statSync(full).mtimeMs : Date.now();
    const entry: DocumentEntry = {
      kind,
      title,
      path: relPath.split("\\").join("/"),
      work_unit: workUnit,
      modified,
    };
    const registry = this._readFile(projectId);
    const idx = registry.documents.findIndex(
      (d) => d.kind === kind && (d.work_unit ?? "") === (entry.work_unit ?? "")
    );
    if (idx >= 0) {
      registry.documents[idx] = { ...registry.documents[idx]!, ...entry };
    } else {
      registry.documents.push(entry);
    }
    this._writeFile(projectId, registry);
    return entry;
  }

  /** 解析 kind + work_unit → 存储路径；非法时抛错 */
  resolvePath(projectId: string, kind: DocumentKind, workUnit?: string): { relPath: string; title: string } {
    if (isWorkUnitKind(kind)) {
      const info = dynamicDocInfo(kind, String(workUnit ?? "").trim());
      if (!info) {
        throw new Error(KIND_LABELS[kind] + "需要有效的 work_unit（如 ch3 / 3）");
      }
      return { relPath: info.relPath, title: info.title };
    }
    const fileName = STATIC_DOC_FILES[kind];
    if (!fileName) throw new Error("未知文档类型: " + kind);
    return { relPath: fileName, title: KIND_LABELS[kind] };
  }

  /** 读取标准文件内容（不存在返回 null） */
  read(projectId: string, kind: DocumentKind, workUnit?: string): { relPath: string; content: string } | null {
    const { relPath } = this.resolvePath(projectId, kind, workUnit);
    const full = this._projectStore.resolve(projectId, relPath);
    if (!fs.existsSync(full)) return null;
    return { relPath, content: fs.readFileSync(full, "utf-8") };
  }

  /** 扫描标准路径回填（兼容旧数据：无登记表时也能展示） */
  private _scanBackfill(projectId: string): DocumentEntry[] {
    const entries: DocumentEntry[] = [];
    const root = this._projectStore.project_root(projectId);
    for (const kind of DOCUMENT_KINDS) {
      if (kind === "plan") {
        const dir = path.join(root, "memory", "discussions");
        if (fs.existsSync(dir)) {
          for (const f of fs.readdirSync(dir)) {
            if (!/^方案-.+\.md$/.test(f)) continue;
            const full = path.join(dir, f);
            if (!fs.statSync(full).isFile()) continue;
            entries.push({
              kind,
              title: f.replace(/\.md$/, ""),
              path: "memory/discussions/" + f,
              work_unit: null,
              modified: fs.statSync(full).mtimeMs,
            });
          }
        }
        continue;
      }
      if (!isWorkUnitKind(kind)) {
        const fileName = STATIC_DOC_FILES[kind]!;
        const full = path.join(root, fileName);
        if (fs.existsSync(full)) {
          entries.push({
            kind,
            title: KIND_LABELS[kind],
            path: fileName,
            work_unit: null,
            modified: fs.statSync(full).mtimeMs,
          });
        }
        continue;
      }
      if (kind === "chapter") {
        const store = new ChapterStore(this._projectStore);
        for (const rec of store.loadIndex(projectId).chapters) {
          const full = path.join(root, "chapters/" + rec.no + ".md");
          if (fs.existsSync(full)) {
            entries.push({
              kind,
              title: rec.title || "第 " + rec.no + " 章",
              path: "chapters/" + rec.no + ".md",
              work_unit: "ch" + rec.no,
              modified: fs.statSync(full).mtimeMs,
            });
          }
        }
      } else {
        const dir = path.join(root, "review");
        if (fs.existsSync(dir)) {
          for (const f of fs.readdirSync(dir)) {
            const m = f.match(/^(\d+)-审阅报告\.md$/);
            if (!m) continue;
            const full = path.join(dir, f);
            entries.push({
              kind,
              title: "第 " + m[1] + " 章审阅报告",
              path: "review/" + f,
              work_unit: "ch" + m[1],
              modified: fs.statSync(full).mtimeMs,
            });
          }
        }
      }
    }
    return entries;
  }
}
