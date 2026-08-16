/** 设定存储（TS 版，迁移自 storage/settings_store.py）。 */
import * as fs from "node:fs";
import * as path from "node:path";
import { ProjectNotFoundError, type ProjectStore } from "./project_store.js";

export const SETTING_FILES: Record<string, string> = {
  worldview: "worldview.json",
  characters: "characters.json",
  outline: "outline.json",
  style: "style.json",
};

export const DEFAULT_SETTINGS: Record<string, Record<string, unknown>> = {
  worldview: { sections: { era: "", rules: "", geography: "", factions: "", history: "" } },
  characters: { characters: [] },
  outline: { root: { type: "total", summary_short: "", summary_long: "", children: [] } },
  style: { style: "" },
};

export class SettingsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SettingsError";
  }
}

export class SettingsStore {
  private _projectStore: ProjectStore;

  constructor(projectStore: ProjectStore) {
    this._projectStore = projectStore;
  }

  private _settingsDir(projectId: string): string {
    const root = this._projectStore.project_root(projectId);
    if (!fs.existsSync(root)) throw new ProjectNotFoundError(`项目不存在: ${projectId}`);
    const d = path.join(root, "settings");
    fs.mkdirSync(d, { recursive: true });
    return d;
  }

  get(projectId: string, settingType: string): Record<string, unknown> {
    const file = SETTING_FILES[settingType];
    if (!file) throw new SettingsError(`不支持的设定类型: ${settingType}`);
    const p = path.join(this._settingsDir(projectId), file);
    if (!fs.existsSync(p)) return JSON.parse(JSON.stringify(DEFAULT_SETTINGS[settingType] ?? {}));
    try {
      const data = JSON.parse(fs.readFileSync(p, "utf-8"));
      if (data && typeof data === "object") return data;
    } catch {
      console.warn(`设定文件损坏，返回默认: ${p}`);
    }
    return JSON.parse(JSON.stringify(DEFAULT_SETTINGS[settingType] ?? {}));
  }

  save(projectId: string, settingType: string, data: Record<string, unknown>): Record<string, unknown> {
    const file = SETTING_FILES[settingType];
    if (!file) throw new SettingsError(`不支持的设定类型: ${settingType}`);
    const p = path.join(this._settingsDir(projectId), file);
    fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf-8");
    return data;
  }

  exists(projectId: string, settingType: string): boolean {
    const file = SETTING_FILES[settingType];
    if (!file) return false;
    const p = path.join(this._settingsDir(projectId), file);
    return fs.existsSync(p);
  }
}

/** 设定快照（判定非空） */
export class SettingSnapshot {
  static is_empty(data: Record<string, unknown>, settingType: string): boolean {
    if (settingType === "worldview") {
      const sections = (data.sections as Record<string, string> | undefined) ?? {};
      return !Object.values(sections).some((v) => v);
    }
    if (settingType === "characters") {
      const chars = (data.characters as unknown[] | undefined) ?? [];
      return chars.length === 0;
    }
    if (settingType === "outline") {
      const root = (data.root as Record<string, unknown> | undefined) ?? {};
      const children = (root.children as unknown[] | undefined) ?? [];
      return !(root.summary_short || root.summary_long || children.length > 0);
    }
    if (settingType === "style") return !data.style;
    return Object.keys(data).length === 0;
  }
}
