/** 设定生成（TS 版，迁移自 workflow/settings_generator.py）。 */
import type { LLMClient } from "../llm/client.js";
import { ChatMessage, Role } from "../llm/models.js";
import type { Project } from "../storage/project_store.js";
import type { SettingsStore } from "../storage/settings_store.js";
import { SETTINGS_GENERATE_PROMPT, SETTINGS_LABELS, SETTINGS_STRUCT_TEMPLATES } from "./prompts.js";

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
    private _settings: SettingsStore
  ) {}

  async generate(project: Project, settingType: string): Promise<Record<string, unknown>> {
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
}

export async function generateAll(
  client: LLMClient,
  settings: SettingsStore,
  project: Project
): Promise<Record<string, Record<string, unknown>>> {
  const gen = new SettingsGenerator(client, settings);
  const results: Record<string, Record<string, unknown>> = {};
  for (const type of ["worldview", "characters", "outline", "style"] as const) {
    results[type] = await gen.generate(project, type);
  }
  return results;
}
