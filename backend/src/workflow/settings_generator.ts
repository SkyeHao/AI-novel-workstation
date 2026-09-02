/** 设定生成（TS 版，迁移自 workflow/settings_generator.py）。 */
import type { LLMClient } from "../llm/client.js";
import { ChatMessage, Role } from "../llm/models.js";
import type { Project } from "../storage/project_store.js";
import type { SettingsStore } from "../storage/settings_store.js";
import { SETTINGS_GENERATE_PROMPT, SETTINGS_LABELS, SETTINGS_STRUCT_TEMPLATES } from "./prompts.js";
import { findWorldviewTemplate, buildWorldviewSchema } from "../assets/worldview_templates.js";
import { findCharacterTemplate, buildCharacterSchema } from "../assets/character_templates.js";
import { findOutlineTemplate, buildOutlineSchema } from "../assets/outline_templates.js";
import { findStyleTemplate, buildStyleSchema } from "../assets/style_templates.js";
import type { StructuredSettingsStore } from "../storage/structured_settings.js";

function extractJson(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1]! : trimmed;
  try {
    const parsed = JSON.parse(candidate);
    if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
    return null;
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        const parsed = JSON.parse(candidate.slice(start, end + 1));
        if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
      } catch {
        return null;
      }
    }
    return null;
  }
}

export class SettingsGenerator {
  constructor(
    private _client: LLMClient,
    private _settings: SettingsStore,
    private _structured?: StructuredSettingsStore
  ) {}

  async generate(project: Project, settingType: string): Promise<Record<string, unknown>> {
    // 世界观使用模板驱动生成
    if (settingType === "worldview" && this._structured) {
      return this.generateWorldviewFromTemplate(project);
    }

    // 人物使用模板驱动生成
    if (settingType === "characters" && this._structured) {
      return this.generateCharactersFromTemplate(project);
    }

    // 大纲使用模板驱动生成
    if (settingType === "outline" && this._structured) {
      return this.generateOutlineFromTemplate(project);
    }

    // 风格使用模板驱动生成
    if (settingType === "style" && this._structured) {
      return this.generateStyleFromTemplate(project);
    }

    const label = SETTINGS_LABELS[settingType] ?? settingType;
    const template = SETTINGS_STRUCT_TEMPLATES[settingType];
    if (!template) throw new Error(`不支持的设定类型: ${settingType}`);

    const prompt =
      SETTINGS_GENERATE_PROMPT.replace("{setting_label}", label)
        .replace("{project_name}", project.name)
        .replace("{idea}", project.idea || "（项目尚未填写核心梗，依据核心要素生成）") + template;

    const response = await this._client.achat(
      [new ChatMessage(Role.USER, prompt)],
      { temperature: 0.6, max_tokens: 4000, response_format: { type: "json_object" } }
    );
    const data = extractJson(response.content);
    if (!data) throw new Error(`设定生成返回格式异常: ${response.content.slice(0, 200)}`);
    this._settings.save(project.id, settingType, data);
    return data;
  }

  /** 根据模板生成结构化世界观 */
  private async generateWorldviewFromTemplate(project: Project): Promise<Record<string, unknown>> {
    const genre = project.genre || "generic";
    const template = findWorldviewTemplate(genre);

    const schema = buildWorldviewSchema(template);
    const prompt = `你是一位资深的网文世界观设计师。根据项目的核心要素，为「${project.name}」设计世界观。

## 项目信息
- 项目名：${project.name}
- 题材：${genre}
- 核心梗：${project.idea || "（依据核心要素生成）"}

## 世界观模板
本题材的世界观需要包含以下维度：
${template.dimensions.map(d => `- ${d.label}（${d.key}）：${d.hint}${d.required ? " [必填]" : ""}`).join("\n")}

## 输出要求
请输出一个 JSON 对象，严格按照以下结构：
${schema}

注意：
1. template_id 必须是 "${template.id}"
2. dimensions 中的每个 key 必须与模板维度对应
3. 必填维度必须有具体内容，不能为空
4. 内容要具体、有细节，符合题材特征
5. 只输出 JSON，不要输出其他文字`;

    const response = await this._client.achat(
      [new ChatMessage(Role.USER, prompt)],
      { temperature: 0.7, max_tokens: 4000, response_format: { type: "json_object" } }
    );
    
    const data = extractJson(response.content);
    if (!data) throw new Error(`世界观生成返回格式异常: ${response.content.slice(0, 200)}`);

    // 验证并保存
    const worldviewData = {
      template_id: template.id,
      dimensions: (data.dimensions || data) as Record<string, any>,
    };

    const validation = this._structured!.validateWorldview(worldviewData, template);
    if (!validation.valid) {
      console.warn("世界观验证失败:", validation.errors);
      // 仍然保存，但记录警告
    }

    this._structured!.saveWorldview(project.id, worldviewData);
    
    // 同时保存到旧的 settings 存储，保持兼容
    this._settings.save(project.id, "worldview", worldviewData as any);
    
    return worldviewData as any;
  }
  /** 根据模板生成结构化人物 */
  private async generateCharactersFromTemplate(project: Project): Promise<Record<string, unknown>> {
    const genre = project.genre || "generic";
    const template = findCharacterTemplate(genre);

    const schema = buildCharacterSchema(template);
    const prompt = `你是一位资深的网文人物设计师。根据项目的核心要素，为「${project.name}」设计主要人物。

## 项目信息
- 项目名：${project.name}
- 题材：${genre}
- 核心梗：${project.idea || "（依据核心要素生成）"}

## 人物模板
本题材的人物需要包含以下维度：
${template.dimensions.map(d => `- ${d.label}（${d.key}）：${d.hint}${d.required ? " [必填]" : ""}`).join("\n")}

## 输出要求
请输出一个 JSON 对象，严格按照以下结构：
${schema}

注意：
1. template_id 必须是 "${template.id}"
2. 至少生成 3 个人物（主角 + 2 个配角/反派）
3. 每个人物的 dimensions 中的每个 key 必须与模板维度对应
4. 必填维度必须有具体内容，不能为空
5. relations 中的人物关系要合理
6. 只输出 JSON，不要输出其他文字`;

    const response = await this._client.achat(
      [new ChatMessage(Role.USER, prompt)],
      { temperature: 0.7, max_tokens: 4000, response_format: { type: "json_object" } }
    );
    
    const data = extractJson(response.content);
    if (!data) throw new Error(`人物生成返回格式异常: ${response.content.slice(0, 200)}`);

    const charactersData = {
      template_id: template.id,
      characters: (data.characters || []) as any[],
    };

    this._structured!.saveCharacters(project.id, charactersData);
    this._settings.save(project.id, "characters", charactersData as any);
    
    return charactersData as any;
  }
  /** 根据模板生成结构化大纲 */
  private async generateOutlineFromTemplate(project: Project): Promise<Record<string, unknown>> {
    const template = findOutlineTemplate();  // 默认使用三幕式

    const schema = buildOutlineSchema(template);
    const prompt = `你是一位资深的网文大纲设计师。根据项目的核心要素，为「${project.name}」设计故事大纲。

## 项目信息
- 项目名：${project.name}
- 题材：${project.genre || "通用"}
- 核心梗：${project.idea || "（依据核心要素生成）"}

## 大纲模板
本题材的大纲需要包含以下结构：
- 故事层：书名、一句话概括、详细梗概
- 卷层：卷名、核心任务、目标字数
- 篇章层：篇章名、篇章目标
- 章节层：章节标题、核心事件、剧情功能、出场人物、伏笔

## 输出要求
请输出一个 JSON 对象，严格按照以下结构：
${schema}

注意：
1. template_id 必须是 "${template.id}"
2. 至少生成 2-3 卷，每卷 2-3 个篇章，每个篇章 3-5 章
3. 每个节点的属性必须与模板定义对应
4. 章节的 event 必须具体、有戏剧性
5. 伏笔要前后呼应
6. 只输出 JSON，不要输出其他文字`;

    const response = await this._client.achat(
      [new ChatMessage(Role.USER, prompt)],
      { temperature: 0.7, max_tokens: 6000, response_format: { type: "json_object" } }
    );
    
    const data = extractJson(response.content);
    if (!data) throw new Error(`大纲生成返回格式异常: ${response.content.slice(0, 200)}`);

    const rawRoot =
      data.root && typeof data.root === "object" ? (data.root as Record<string, unknown>) : data;
    const outlineData = {
      template_id: template.id,
      root: { type: "total", ...rawRoot },
    };

    this._structured!.saveOutline(project.id, outlineData);
    this._settings.save(project.id, "outline", outlineData as any);
    
    return outlineData as any;
  }

  // ========== 风格生成 ==========

  private async generateStyleFromTemplate(project: Project): Promise<Record<string, unknown>> {
    const template = findStyleTemplate();  // 默认使用通用模板

    const schema = buildStyleSchema(template);
    const prompt = `你是一位资深的写作风格设计师。根据项目的核心要素，为「${project.name}」设计写作风格规范。

## 项目信息
- 项目名：${project.name}
- 题材：${project.genre || "通用"}
- 核心梗：${project.idea || "（依据核心要素生成）"}

## 风格模板
本项目的风格需要包含以下维度：
${template.dimensions.map(d => `- ${d.label}（${d.key}）：${d.hint}${d.required ? " [必填]" : ""}`).join("\n")}

## 输出要求
请输出一个 JSON 对象，严格按照以下结构：
${schema}

注意：
1. template_id 必须是 "${template.id}"
2. dimensions 中的每个 key 必须与模板维度对应
3. 必填维度必须有具体内容，不能为空
4. 风格描述要具体、可操作，能指导实际写作
5. 只输出 JSON，不要输出其他文字`;

    const response = await this._client.achat(
      [new ChatMessage(Role.USER, prompt)],
      { temperature: 0.7, max_tokens: 4000, response_format: { type: "json_object" } }
    );
    
    const data = extractJson(response.content);
    if (!data) throw new Error(`风格生成返回格式异常: ${response.content.slice(0, 200)}`);

    const styleData = {
      template_id: template.id,
      dimensions: (data.dimensions || data) as Record<string, any>,
    };

    this._structured!.saveStyle(project.id, styleData);
    this._settings.save(project.id, "style", styleData as any);
    
    return styleData as any;
  }
}

export async function generateAll(
  client: LLMClient,
  settings: SettingsStore,
  project: Project,
  structured?: StructuredSettingsStore
): Promise<Record<string, Record<string, unknown>>> {
  const gen = new SettingsGenerator(client, settings, structured);
  const results: Record<string, Record<string, unknown>> = {};
  for (const type of ["worldview", "characters", "outline", "style"] as const) {
    results[type] = await gen.generate(project, type);
  }
  return results;
}







