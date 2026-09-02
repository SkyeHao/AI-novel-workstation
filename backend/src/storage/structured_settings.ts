/**
 * 结构化设定存储层。
 * 负责读写结构化 JSON 设定数据（世界观、人物、大纲等）。
 * 与 SettingsStore 的区别：SettingsStore 存储原始 JSON，本层提供类型安全的访问和验证。
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { ProjectStore } from "./project_store.js";
import { findWorldviewTemplate, type WorldviewTemplate } from "../assets/worldview_templates.js";
import { findCharacterTemplate, type CharacterTemplate } from "../assets/character_templates.js";
import { findOutlineTemplate, type OutlineTemplate } from "../assets/outline_templates.js";
import { findStyleTemplate, type StyleTemplate } from "../assets/style_templates.js";

export interface CharacterRelation {
  target_id: string;
  target_name: string;
  type: string;
  description?: string;
}

export interface CharacterEntry {
  id: string;
  name: string;
  role: "protagonist" | "supporter" | "antagonist" | "neutral";
  dimensions: Record<string, any>;
  relations?: CharacterRelation[];
}

export interface CharactersData {
  template_id: string;
  characters: CharacterEntry[];
}

export interface WorldviewData {
  template_id: string;
  dimensions: Record<string, any>;
}

export interface OutlineNode {
  type: string;
  [key: string]: any;
  children?: OutlineNode[];
}

export interface OutlineData {
  template_id: string;
  root: OutlineNode;
}

export interface StyleData {
  template_id: string;
  dimensions: Record<string, any>;
}

export class StructuredSettingsStore {
  private _projectStore: ProjectStore;

  constructor(projectStore: ProjectStore) {
    this._projectStore = projectStore;
  }

  // ========== 世界观数据 ==========

  saveWorldview(projectId: string, data: WorldviewData): void {
    const filePath = this._projectStore.resolve(projectId, "settings/worldview.json");
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  }

  loadWorldview(projectId: string): WorldviewData | null {
    const filePath = this._projectStore.resolve(projectId, "settings/worldview.json");
    if (!fs.existsSync(filePath)) return null;
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      return JSON.parse(content) as WorldviewData;
    } catch {
      return null;
    }
  }

  getWorldviewTemplate(projectId: string, genre?: string): WorldviewTemplate {
    const data = this.loadWorldview(projectId);
    if (data?.template_id) {
      const template = findWorldviewTemplate(data.template_id);
      if (template) return template;
    }
    return findWorldviewTemplate(genre || "generic");
  }

  validateWorldview(data: WorldviewData, template: WorldviewTemplate): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    for (const dim of template.dimensions) {
      if (dim.required) {
        const value = data.dimensions[dim.key];
        if (value === undefined || value === null || value === "") {
          errors.push(`缺少必填维度: ${dim.label} (${dim.key})`);
        }
      }
    }
    return { valid: errors.length === 0, errors };
  }

  // ========== 人物数据 ==========

  saveCharacters(projectId: string, data: CharactersData): void {
    const filePath = this._projectStore.resolve(projectId, "settings/characters.json");
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  }

  loadCharacters(projectId: string): CharactersData | null {
    const filePath = this._projectStore.resolve(projectId, "settings/characters.json");
    if (!fs.existsSync(filePath)) return null;
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      return JSON.parse(content) as CharactersData;
    } catch {
      return null;
    }
  }

  getCharacterTemplate(projectId: string, genre?: string): CharacterTemplate {
    const data = this.loadCharacters(projectId);
    if (data?.template_id) {
      const template = findCharacterTemplate(data.template_id);
      if (template) return template;
    }
    return findCharacterTemplate(genre || "generic");
  }

  // ========== 大纲数据 ==========

  saveOutline(projectId: string, data: OutlineData): void {
    const filePath = this._projectStore.resolve(projectId, "settings/outline.json");
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  }

  loadOutline(projectId: string): OutlineData | null {
    const filePath = this._projectStore.resolve(projectId, "settings/outline.json");
    if (!fs.existsSync(filePath)) return null;
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      return JSON.parse(content) as OutlineData;
    } catch {
      return null;
    }
  }

  getOutlineTemplate(projectId: string, templateId?: string): OutlineTemplate {
    const data = this.loadOutline(projectId);
    if (data?.template_id) {
      const template = findOutlineTemplate(data.template_id);
      if (template) return template;
    }
    return findOutlineTemplate(templateId);
  }

  // ========== 风格数据 ==========

  saveStyle(projectId: string, data: StyleData): void {
    const filePath = this._projectStore.resolve(projectId, "settings/style.json");
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  }

  loadStyle(projectId: string): StyleData | null {
    const filePath = this._projectStore.resolve(projectId, "settings/style.json");
    if (!fs.existsSync(filePath)) return null;
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      return JSON.parse(content) as StyleData;
    } catch {
      return null;
    }
  }

  getStyleTemplate(projectId: string, templateId?: string): StyleTemplate {
    const data = this.loadStyle(projectId);
    if (data?.template_id) {
      const template = findStyleTemplate(data.template_id);
      if (template) return template;
    }
    return findStyleTemplate(templateId);
  }
}

