/**
 * 全局配置管理（TS 版，迁移自 config/settings.py）。
 * 按任务类型（正文 text / 结构 structure / 校验 check）分配不同模型。
 */
import * as fs from "node:fs";
import dotenv from "dotenv";
import { getEnvFilePath, migrateEnvIfNeeded, PROJECT_ROOT } from "./paths.js";

/** 单个 LLM 模型配置，兼容所有 OpenAI 协议 API */
export interface LLMModelConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  temperature: number;
  maxTokens: number | null;
  timeout: number;
  maxRetries: number;
}

/** 全局配置 */
export interface SettingsData {
  llmTextApiKey: string;
  llmTextBaseUrl: string;
  llmTextModel: string;
  llmTextTemperature: number;
  llmTextMaxTokens: number | null;
  llmStructureApiKey: string;
  llmStructureBaseUrl: string;
  llmStructureModel: string;
  llmStructureTemperature: number;
  llmStructureMaxTokens: number | null;
  llmCheckApiKey: string;
  llmCheckBaseUrl: string;
  llmCheckModel: string;
  llmCheckTemperature: number;
  llmCheckMaxTokens: number | null;
  logLevel: string;
  defaultTimeout: number;
  defaultMaxRetries: number;
}

function envStr(key: string, fallback = ""): string {
  const v = process.env[key];
  return v === undefined || v === "" ? fallback : v;
}

function envNum(key: string, fallback: number): number {
  const v = process.env[key];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

let _settings: Settings | null = null;

export class Settings {
  data: SettingsData;

  constructor(data: SettingsData) {
    this.data = data;
  }

  getModelConfig(task: string): LLMModelConfig {
    const prefix = `llm${task.charAt(0).toUpperCase()}${task.slice(1)}`;
    const d = this.data as unknown as Record<string, unknown>;
    return {
      apiKey: String(d[`${prefix}ApiKey`] ?? ""),
      baseUrl: String(d[`${prefix}BaseUrl`] ?? "https://api.openai.com/v1"),
      model: String(d[`${prefix}Model`] ?? "gpt-4o"),
      temperature: Number(d[`${prefix}Temperature`] ?? 0.7),
      maxTokens: d[`${prefix}MaxTokens`] == null ? null : Number(d[`${prefix}MaxTokens`]),
      timeout: this.data.defaultTimeout,
      maxRetries: this.data.defaultMaxRetries,
    };
  }

  getAllConfigs(): Record<string, LLMModelConfig> {
    return {
      text: this.getModelConfig("text"),
      structure: this.getModelConfig("structure"),
      check: this.getModelConfig("check"),
    };
  }
}

export function loadSettings(): Settings {
  // 优先加载用户配置目录 .env（首次自动迁移仓库根 .env），再加载仓库根 .env 兜底
  const envPath = migrateEnvIfNeeded();
  dotenv.config({ path: envPath, override: false });
  if (envPath !== resolveRootEnv()) {
    dotenv.config({ path: resolveRootEnv(), override: false });
  }
  const data: SettingsData = {
    llmTextApiKey: envStr("LLM_TEXT_API_KEY", ""),
    llmTextBaseUrl: envStr("LLM_TEXT_BASE_URL", "https://api.openai.com/v1"),
    llmTextModel: envStr("LLM_TEXT_MODEL", "gpt-4o"),
    llmTextTemperature: envNum("LLM_TEXT_TEMPERATURE", 0.8),
    llmTextMaxTokens: envNum("LLM_TEXT_MAX_TOKENS", 0) || null,
    llmStructureApiKey: envStr("LLM_STRUCTURE_API_KEY", ""),
    llmStructureBaseUrl: envStr("LLM_STRUCTURE_BASE_URL", "https://api.openai.com/v1"),
    llmStructureModel: envStr("LLM_STRUCTURE_MODEL", "gpt-4o-mini"),
    llmStructureTemperature: envNum("LLM_STRUCTURE_TEMPERATURE", 0.6),
    llmStructureMaxTokens: envNum("LLM_STRUCTURE_MAX_TOKENS", 0) || null,
    llmCheckApiKey: envStr("LLM_CHECK_API_KEY", ""),
    llmCheckBaseUrl: envStr("LLM_CHECK_BASE_URL", "https://api.openai.com/v1"),
    llmCheckModel: envStr("LLM_CHECK_MODEL", "gpt-4o-mini"),
    llmCheckTemperature: envNum("LLM_CHECK_TEMPERATURE", 0.3),
    llmCheckMaxTokens: envNum("LLM_CHECK_MAX_TOKENS", 0) || null,
    logLevel: envStr("LOG_LEVEL", "INFO"),
    defaultTimeout: envNum("DEFAULT_TIMEOUT", 120),
    defaultMaxRetries: envNum("DEFAULT_MAX_RETRIES", 3),
  };
  return new Settings(data);
}

function resolveRootEnv(): string {
  return `${PROJECT_ROOT}/.env`;
}

export function getSettings(): Settings {
  if (_settings === null) {
    _settings = loadSettings();
  }
  return _settings;
}

export function resetSettings(): void {
  _settings = null;
}
