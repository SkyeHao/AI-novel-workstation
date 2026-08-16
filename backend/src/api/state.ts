/** API 全局状态管理（TS 版，迁移自 api/state.py）。
 * 模型池 / 任务分配 / 项目目录 / 搜索配置；持久化于 data/app-state.json 与用户配置 .env。 */
import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { PROJECT_ROOT, getEnvFilePath } from "../config/paths.js";
import { getSettings, type LLMModelConfig } from "../config/settings.js";
import { LLMClient } from "../llm/client.js";
import { LLMConfigError, LLMError } from "../llm/exceptions.js";
import { ChatMessage } from "../llm/models.js";
import { LLMClientManager, type TaskType } from "../llm/manager.js";
import { InteractionLogger } from "../llm/interaction_logger.js";
import { ProjectStore } from "../storage/project_store.js";
import { DEFAULT_STATE_KEYS, DEFAULT_STATES, STATE_TO_TASK } from "../storage/states.js";

interface ModelEntryData {
  id: string;
  name: string;
  provider_id: string;
  api_key: string;
  base_url: string;
  model: string;
  temperature: number;
  max_tokens: number | null;
  timeout: number;
  max_retries: number;
  status: string;
  last_tested: string | null;
}

interface AppStateFile {
  project_dir: string;
  models: ModelEntryData[];
  assignments: Partial<Record<string, string | null>>;
}

const STATE_FILE = process.env.AI_NOVEL_STATE_FILE ?? path.join(PROJECT_ROOT, "data", "app-state.json");
const ASSIGNMENT_DEFAULTS: Partial<Record<TaskType, string>> = {};

function defaultProjectDir(): string {
  return path.join(PROJECT_ROOT, "data", "projects");
}

function loadState(): AppStateFile {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const data = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8")) as AppStateFile;
      const state = {
        project_dir: data.project_dir || defaultProjectDir(),
        models: Array.isArray(data.models) ? data.models : [],
        assignments: data.assignments ?? {},
      };
      migrateLegacyAssignments(state);
      return state;
    }
  } catch (err) {
    console.warn(`读取 app-state.json 失败: ${err}`);
  }
  return { project_dir: defaultProjectDir(), models: [], assignments: {} };
}

function saveState(): void {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify({ project_dir: _state.project_dir, models: _state.models, assignments: _state.assignments }, null, 2), "utf-8");
}

const _state: AppStateFile = loadState();
const _modelClients = new Map<string, LLMClient>();
let _manager: LLMClientManager | null = null;

function getManager(): LLMClientManager {
  if (_manager === null) _manager = LLMClientManager.fromSettings();
  return _manager;
}

export function getProjectDirPath(): string {
  return _state.project_dir;
}

export function setProjectDirPath(dir: string): string {
  _state.project_dir = path.resolve(dir);
  saveState();
  return _state.project_dir;
}

// ------------------------------------------------------------------
// 模型池
// ------------------------------------------------------------------

export function maskKey(key: string): string {
  if (!key) return "";
  if (key.length <= 12) return "***";
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

export function listModels(): ModelEntryData[] {
  return _state.models.map((m) => ({ ...m, api_key: maskKey(m.api_key) }));
}

export function getModel(id: string): ModelEntryData | null {
  return _state.models.find((m) => m.id === id) ?? null;
}

export function createModel(data: Omit<ModelEntryData, "id" | "status" | "last_tested">): ModelEntryData {
  const entry: ModelEntryData = {
    ...data,
    api_key: data.api_key.trim(),
    id: randomUUID(),
    status: "untested",
    last_tested: null,
  };
  _state.models.push(entry);
  saveState();
  return { ...entry, api_key: maskKey(entry.api_key) };
}

export function updateModel(id: string, patch: Partial<Omit<ModelEntryData, "id">>): ModelEntryData | null {
  const entry = _state.models.find((m) => m.id === id);
  if (!entry) return null;
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || v === null) continue;
    if (k === "api_key" && String(v).trim() === "") continue; // 留空不修改
    (entry as unknown as Record<string, unknown>)[k] = v;
  }
  saveState();
  rebuildAssignedClients();
  return { ...entry, api_key: maskKey(entry.api_key) };
}

export function deleteModel(id: string): boolean {
  const idx = _state.models.findIndex((m) => m.id === id);
  if (idx < 0) return false;
  _state.models.splice(idx, 1);
  for (const key of Object.keys(_state.assignments)) {
    if (_state.assignments[key] === id) _state.assignments[key] = null;
  }
  _modelClients.delete(id);
  saveState();
  return true;
}

export async function testModel(id: string): Promise<{ success: boolean; message: string; model: string; elapsed_ms: number }> {
  const entry = _state.models.find((m) => m.id === id);
  if (!entry) throw new Error("模型不存在");
  const start = Date.now();
  try {
    const client = new LLMClient(toConfig(entry));
    const resp = await client.achat([new ChatMessage("user", "你好，请回复：ok")], { max_tokens: 10 });
    entry.status = "ok";
    entry.last_tested = new Date().toISOString();
    saveState();
    return { success: true, message: "连接成功", model: resp.model, elapsed_ms: Date.now() - start };
  } catch (err) {
    entry.status = "failed";
    entry.last_tested = new Date().toISOString();
    saveState();
    return { success: false, message: err instanceof Error ? err.message : String(err), model: entry.model, elapsed_ms: Date.now() - start };
  }
}

function toConfig(entry: ModelEntryData): LLMModelConfig {
  return {
    apiKey: entry.api_key,
    baseUrl: entry.base_url,
    model: entry.model,
    temperature: entry.temperature,
    maxTokens: entry.max_tokens,
    timeout: entry.timeout,
    maxRetries: entry.max_retries,
  };
}

// ------------------------------------------------------------------
// 任务分配
// ------------------------------------------------------------------

export interface StateAssignmentView {
  state: string;
  state_label: string;
  task_label: string;
  model_id: string | null;
  model_name: string | null;
}

export function getAssignments(): StateAssignmentView[] {
  const taskLabels: Record<string, string> = { text: "????", structure: "?????", check: "????" };
  return DEFAULT_STATE_KEYS.map((stateKey) => {
    const task = STATE_TO_TASK[stateKey] ?? "text";
    const id = _state.assignments[stateKey] ?? _state.assignments[task] ?? null;
    const model = id ? _state.models.find((m) => m.id === id) ?? null : null;
    const node = DEFAULT_STATES.find((s) => s.key === stateKey);
    return {
      state: stateKey,
      state_label: node?.label ?? stateKey,
      task_label: taskLabels[task] ?? task,
      model_id: id,
      model_name: model ? model.name : null,
    };
  });
}

export function setAssignment(stateKey: string, modelId: string | null): void {
  _state.assignments[stateKey] = modelId;
  saveState();
  rebuildAssignedClients();
}

function rebuildAssignedClients(): void {
  for (const key of Object.keys(_state.assignments)) {
    const id = _state.assignments[key];
    if (!id) continue;
    const entry = _state.models.find((m) => m.id === id);
    if (!entry) continue;
    if (!_modelClients.has(id)) _modelClients.set(id, new LLMClient(toConfig(entry)));
  }
}

/** 按任务类型获取 client：优先任务分配，其次 .env 多任务降级链 */
export function getClientForTask(task: TaskType, interaction_logger: InteractionLogger | null = null): LLMClient {
  const id = _state.assignments[task];
  if (id) {
    const entry = _state.models.find((m) => m.id === id);
    if (entry) {
      if (interaction_logger) return new LLMClient(toConfig(entry), interaction_logger);
      let client = _modelClients.get(id);
      if (!client) {
        client = new LLMClient(toConfig(entry));
        _modelClients.set(id, client);
      }
      return client;
    }
  }
  const settings = getSettings();
  if (settings.getModelConfig(task).apiKey) return getManager().get_client(task);
  // 兜底：任意已配置的任务
  for (const t of ["text", "structure", "check"] as TaskType[]) {
    if (settings.getModelConfig(t).apiKey) return getManager().get_client(t);
  }
  throw new LLMConfigError("没有可用的 LLM client：请在设置页配置模型 API Key，或在项目初始化时配置");
}

export function hasAnyClient(): boolean {
  try {
    getClientForTask("text");
    return true;
  } catch {
    return false;
  }
}

/** ????text/structure/check?? ????????????????? */
function migrateLegacyAssignments(state: { assignments: Partial<Record<string, string | null>> }): void {
  const legacyToStates: Record<string, string[]> = {
    text: ["ideation", "writing", "foreshadow"],
    structure: ["worldview", "characters", "outline"],
    check: ["review"],
  };
  let changed = false;
  for (const [legacyTask, states] of Object.entries(legacyToStates)) {
    const legacyId = state.assignments[legacyTask];
    if (!legacyId) continue;
    for (const stateKey of states) {
      if (state.assignments[stateKey] == null) {
        state.assignments[stateKey] = legacyId;
        changed = true;
      }
    }
  }
  if (changed) {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
  }
}

/** ??????? LLM client??????? ? ????? ? .env ???? ? ???? */
export function getClientForState(stateKey: string, interaction_logger: InteractionLogger | null = null): LLMClient {
  const id = _state.assignments[stateKey];
  if (id) {
    const entry = _state.models.find((m) => m.id === id);
    if (entry) {
      if (interaction_logger) return new LLMClient(toConfig(entry), interaction_logger);
      let client = _modelClients.get(id);
      if (!client) {
        client = new LLMClient(toConfig(entry));
        _modelClients.set(id, client);
      }
      return client;
    }
  }
  // ???????
  const legacyTask = STATE_TO_TASK[stateKey] ?? "text";
  const legacyId = _state.assignments[legacyTask];
  if (legacyId) {
    const entry = _state.models.find((m) => m.id === legacyId);
    if (entry) {
      if (interaction_logger) return new LLMClient(toConfig(entry), interaction_logger);
      let client = _modelClients.get(legacyId);
      if (!client) {
        client = new LLMClient(toConfig(entry));
        _modelClients.set(legacyId, client);
      }
      return client;
    }
  }
  const settings = getSettings();
  if (settings.getModelConfig(legacyTask).apiKey) return getManager().get_client(legacyTask as TaskType);
  for (const t of ["text", "structure", "check"] as TaskType[]) {
    if (settings.getModelConfig(t).apiKey) return getManager().get_client(t);
  }
  throw new LLMConfigError("????? LLM client?????????????????? .env ?? API Key");
}

export function getProjectStore(): ProjectStore {
  return new ProjectStore(getProjectDirPath());
}

// ------------------------------------------------------------------
// 搜索配置（写回 .env）
// ------------------------------------------------------------------

export function initSearchEnv(): void {
  const envPath = getEnvFilePath();
  if (fs.existsSync(envPath)) {
    const text = fs.readFileSync(envPath, "utf-8");
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!;
    }
  }
}

export function getSearchConfig(): Record<string, unknown> {
  initSearchEnv();
  const tavily = process.env.TAVILY_API_KEY ?? "";
  const serper = process.env.SERPER_API_KEY ?? "";
  return {
    tavily_api_key: maskKey(tavily),
    tavily_configured: Boolean(tavily),
    serper_api_key: maskKey(serper),
    serper_configured: Boolean(serper),
    providers: process.env.WEB_SEARCH_PROVIDERS ?? "",
  };
}

export function setSearchConfig(data: { tavily_api_key?: string; serper_api_key?: string; providers?: string }): Record<string, unknown> {
  const updates: Record<string, string> = {};
  if (data.tavily_api_key) updates.TAVILY_API_KEY = data.tavily_api_key.trim();
  if (data.serper_api_key) updates.SERPER_API_KEY = data.serper_api_key.trim();
  if (data.providers === "") updates.WEB_SEARCH_PROVIDERS = "";
  else if (data.providers) updates.WEB_SEARCH_PROVIDERS = data.providers;
  updateEnvVars(updates);
  for (const [k, v] of Object.entries(updates)) process.env[k] = v;
  return getSearchConfig();
}

function updateEnvVars(updates: Record<string, string>): void {
  const envPath = getEnvFilePath();
  const lines = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf-8").split(/\r?\n/) : [];
  const newLines: string[] = [];
  const found: Record<string, boolean> = {};
  for (const line of lines) {
    let matched = false;
    for (const key of Object.keys(updates)) {
      if (line.trim().startsWith(`${key}=`)) {
        newLines.push(`${key}=${updates[key]}`);
        found[key] = true;
        matched = true;
        break;
      }
    }
    if (!matched) newLines.push(line);
  }
  for (const [key, value] of Object.entries(updates)) {
    if (!found[key]) newLines.push(`${key}=${value}`);
  }
  fs.mkdirSync(path.dirname(envPath), { recursive: true });
  fs.writeFileSync(envPath, newLines.join("\n") + "\n", "utf-8");
}

export const PROVIDERS: Array<{ id: string; name: string; base_url: string; models: Array<{ name: string; label: string; recommended_for: string[] }>; website: string }> = [
  {
    id: "openai",
    name: "OpenAI",
    base_url: "https://api.openai.com/v1",
    website: "https://platform.openai.com/",
    models: [
      { name: "gpt-4o", label: "GPT-4o（综合强）", recommended_for: ["text", "structure"] },
      { name: "gpt-4o-mini", label: "GPT-4o mini（轻量）", recommended_for: ["check", "structure"] },
      { name: "o3-mini", label: "o3-mini（推理）", recommended_for: ["check", "structure"] },
    ],
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    base_url: "https://api.deepseek.com/v1",
    website: "https://platform.deepseek.com/",
    models: [
      { name: "deepseek-chat", label: "DeepSeek Chat", recommended_for: ["text", "structure"] },
      { name: "deepseek-reasoner", label: "DeepSeek Reasoner", recommended_for: ["check", "structure"] },
    ],
  },
  {
    id: "moonshot",
    name: "Moonshot（月之暗面）",
    base_url: "https://api.moonshot.cn/v1",
    website: "https://platform.moonshot.cn/",
    models: [
      { name: "moonshot-v1-32k", label: "Moonshot v1 32k", recommended_for: ["text", "structure"] },
      { name: "moonshot-v1-8k", label: "Moonshot v1 8k", recommended_for: ["check"] },
    ],
  },
  {
    id: "qwen",
    name: "通义千问",
    base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    website: "https://dashscope.aliyun.com/",
    models: [
      { name: "qwen-max", label: "Qwen Max", recommended_for: ["text"] },
      { name: "qwen-plus", label: "Qwen Plus", recommended_for: ["text", "structure"] },
      { name: "qwen-turbo", label: "Qwen Turbo（轻量）", recommended_for: ["check"] },
    ],
  },
  {
    id: "volcengine",
    name: "?????Volcengine Ark?",
    base_url: "https://ark.cn-beijing.volces.com/api/coding/v3",
    website: "https://www.volcengine.com/product/ark",
    models: [
      { name: "deepseek-v4-flash", label: "DeepSeek V4 Flash??????", recommended_for: ["text", "structure", "check"] },
      { name: "deepseek-v4-pro", label: "DeepSeek V4 Pro????", recommended_for: ["text"] },
      { name: "ark-code-latest", label: "ARK Code??????", recommended_for: ["text"] },
    ],
  },
  {
    id: "opencode-go",
    name: "OpenCode Go",
    base_url: "https://opencode.ai/zen/go/v1",
    website: "https://opencode.ai/go",
    models: [
      { name: "deepseek-v4-flash", label: "DeepSeek V4 Flash??????", recommended_for: ["text", "structure", "check"] },
      { name: "deepseek-v4-pro", label: "DeepSeek V4 Pro????", recommended_for: ["text"] },
      { name: "gpt-5.6-luna", label: "GPT 5.6 Luna????", recommended_for: ["text", "structure"] },
      { name: "glm-5.2", label: "GLM-5.2??????", recommended_for: ["text", "structure"] },
      { name: "qwen3.8-max", label: "Qwen3.8 Max?????", recommended_for: ["structure"] },
      { name: "kimi-k3", label: "Kimi K3", recommended_for: ["text"] },
      { name: "grok-4.5", label: "Grok 4.5", recommended_for: ["text"] },
    ],
  },
  {
    id: "custom",
    name: "自定义（OpenAI 兼容）",
    base_url: "",
    website: "",
    models: [],
  },
];

export function getClient(): never {
  throw new LLMError("请使用 getClientForTask");
}

