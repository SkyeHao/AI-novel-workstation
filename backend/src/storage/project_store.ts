/** 项目存储（TS 版，迁移自 storage/project_store.py）。 */
import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { safeResolve } from "./path_safety.js";

export const STATUS_IDEATION = "ideation";
export const STATUS_SETTING = "setting";
export const STATUS_WRITING = "writing";
export const STATUS_REVIEWING = "reviewing";

export const VALID_STATUSES: string[] = [
  STATUS_IDEATION,
  STATUS_SETTING,
  STATUS_WRITING,
  STATUS_REVIEWING,
  "worldview",
  "characters",
  "outline",
  "review",
  "foreshadow",
];

export class ProjectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectError";
  }
}

export class ProjectNotFoundError extends ProjectError {
  constructor(message: string) {
    super(message);
    this.name = "ProjectNotFoundError";
  }
}

export interface ProjectData {
  id: string;
  name: string;
  status: string;
  target_words: number;
  platform: string;
  genre: string;
  idea: string;
  work_unit: string;
  states_enabled: string[];
  created_at: string;
  updated_at: string;
}

function nowSeconds(): string {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

export class Project {
  id: string;
  name: string;
  status: string;
  target_words: number;
  platform: string;
  genre: string;
  idea: string;
  work_unit: string;
  states_enabled: string[];
  created_at: string;
  updated_at: string;

  constructor(init: {
    name: string;
    id?: string | null;
    status?: string;
    target_words?: number;
    platform?: string;
    genre?: string;
    idea?: string;
    work_unit?: string;
    states_enabled?: string[];
    created_at?: string | null;
    updated_at?: string | null;
  }) {
    const now = nowSeconds();
    this.id = init.id || randomUUID();
    this.name = init.name;
    this.status = init.status ?? STATUS_IDEATION;
    this.target_words = init.target_words ?? 0;
    this.platform = init.platform ?? "";
    this.genre = init.genre ?? "";
    this.idea = init.idea ?? "";
    this.work_unit = init.work_unit ?? "";
    this.states_enabled = init.states_enabled ?? [];
    this.created_at = init.created_at ?? now;
    this.updated_at = init.updated_at ?? now;
  }

  toDict(): ProjectData {
    return {
      id: this.id,
      name: this.name,
      status: this.status,
      target_words: this.target_words,
      platform: this.platform,
      genre: this.genre,
      idea: this.idea,
      work_unit: this.work_unit,
      states_enabled: this.states_enabled,
      created_at: this.created_at,
      updated_at: this.updated_at,
    };
  }

  static fromDict(data: Record<string, unknown>): Project {
    return new Project({
      id: (data.id as string) ?? (data.name as string) ?? "",
      name: (data.name as string) ?? "",
      status: (data.status as string) ?? STATUS_IDEATION,
      target_words: Number(data.target_words ?? 0),
      platform: (data.platform as string) ?? "",
      genre: (data.genre as string) ?? "",
      idea: (data.idea as string) ?? "",
      work_unit: (data.work_unit as string) ?? "",
      states_enabled: Array.isArray(data.states_enabled) ? (data.states_enabled as string[]) : [],
      created_at: (data.created_at as string | null) ?? null,
      updated_at: (data.updated_at as string | null) ?? null,
    });
  }
}

export class ProjectStore {
  private _baseDir: string;

  constructor(baseDir: string) {
    this._baseDir = baseDir;
    fs.mkdirSync(baseDir, { recursive: true });
  }

  get baseDir(): string {
    return this._baseDir;
  }

  project_root(projectId: string): string {
    return safeResolve(this._baseDir, projectId);
  }

  meta_path(projectId: string): string {
    return path.join(this.project_root(projectId), "project.json");
  }

  resolve(projectId: string, relPath: string): string {
    return safeResolve(this.project_root(projectId), relPath);
  }

  list(): Project[] {
    const projects: Project[] = [];
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(this._baseDir, { withFileTypes: true });
    } catch {
      entries = [];
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const meta = path.join(this._baseDir, entry.name, "project.json");
      if (fs.existsSync(meta)) {
        try {
          projects.push(Project.fromDict(JSON.parse(fs.readFileSync(meta, "utf-8"))));
        } catch {
          console.warn(`读取项目元数据失败: ${meta}`);
        }
      }
    }
    projects.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
    return projects;
  }

  get(projectId: string): Project {
    const root = this.project_root(projectId);
    if (!fs.existsSync(root)) throw new ProjectNotFoundError(`项目不存在: ${projectId}`);
    const meta = path.join(root, "project.json");
    if (fs.existsSync(meta)) {
      return Project.fromDict(JSON.parse(fs.readFileSync(meta, "utf-8")));
    }
    return new Project({ name: projectId, id: projectId });
  }

  exists(projectId: string): boolean {
    try {
      return fs.existsSync(this.project_root(projectId));
    } catch {
      return false;
    }
  }

  create(name: string, idea = "", extra: Partial<ProjectData> = {}): Project {
    const clean = cleanName(name);
    if (!clean) throw new ProjectError("项目名称不能为空");
    const root = this.project_root(clean);
    if (fs.existsSync(root)) throw new ProjectError(`项目已存在: ${clean}`);

    const project = new Project({
      name: clean,
      idea,
      id: clean,
      status: extra.status,
      target_words: extra.target_words,
      platform: extra.platform,
      genre: extra.genre,
    });
    initDirectories(root);
    this.save(project);
    return project;
  }

  save(project: Project): void {
    project.updated_at = nowSeconds();
    const root = this.project_root(project.name);
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, "project.json"), JSON.stringify(project.toDict(), null, 2), "utf-8");
  }

  update(projectId: string, fields: Partial<ProjectData>): Project {
    const project = this.get(projectId);
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined && value !== null && key in project) {
        (project as unknown as Record<string, unknown>)[key] = value;
      }
    }
    if (fields.status !== undefined && fields.status !== null) project.status = fields.status;
    this.save(project);
    return project;
  }

  delete(projectId: string): void {
    const root = this.project_root(projectId);
    if (!fs.existsSync(root)) throw new ProjectNotFoundError(`项目不存在: ${projectId}`);
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch (err) {
      throw new ProjectError(`删除项目失败: ${err}`);
    }
  }
}

export function cleanName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\s]+/g, "").trim();
  return cleaned.slice(0, 64);
}

export function initDirectories(root: string): void {
  for (const sub of ["ideation/sessions", "settings", "chapters", "memory/summaries", "review"]) {
    fs.mkdirSync(path.join(root, sub), { recursive: true });
  }
}



