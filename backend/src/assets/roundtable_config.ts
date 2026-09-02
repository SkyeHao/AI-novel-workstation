/**
 * 圆桌会议全局配置（会议级默认值，区别于每个角色的模型配置）。
 *
 * 字段：
 *  - maxTokens     单轮上下文的 token 预算（ContextAssembler.maxTokens），默认 8000
 *  - maxToolCalls  每个 Agent 每轮发言允许调用的只读工具次数上限，默认 3
 *
 * 存储于 data/roundtable-config.json，启动时懒加载；缺省文件时使用默认值。
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { getDataDir } from "../config/paths.js";

export interface RoundtableConfig {
  /** 单轮上下文 token 预算（默认 8000） */
  maxTokens: number;
  /** 每轮工具调用次数上限（默认 3） */
  maxToolCalls: number;
  /** 统一调度 Agent（群聊导演）独立配置（工单 11） */
  scheduler: SchedulerRoundtableConfig;
  /** LLM 共识检测（共识裁判）独立配置：超时与导演对齐，输出 token 默认跟随所选模型 */
  consensus: ConsensusRoundtableConfig;
}

/** 统一调度 Agent（群聊导演）配置：独立模型 / 温度 / 超时 / token。 */
export interface SchedulerRoundtableConfig {
  /** 是否启用导演调度（默认 true） */
  enabled: boolean;
  /** 导演专用模型 id；null 表示与讨论共用同一模型 */
  modelId: string | null;
  /** 导演决策温度（默认 0.3） */
  temperature: number;
  /** 导演决策超时（ms，默认 3000） */
  timeoutMs: number;
  /** 导演决策输出 token 上限（默认 300） */
  maxTokens: number;
}

/** LLM 共识裁判配置：超时 / 温度 / 输出 token 上限。 */
export interface ConsensusRoundtableConfig {
  /** 是否启用 LLM 共识检测（默认 true） */
  enabled: boolean;
  /** 共识判定超时（ms，默认 60000，与导演一致） */
  timeoutMs: number;
  /** 判定温度（默认 0.2） */
  temperature: number;
  /** 判定输出 token 上限；null 表示跟随所选模型默认配置 */
  maxTokens: number | null;
}

export const DEFAULT_ROUNDTABLE_CONFIG: RoundtableConfig = {
  maxTokens: 8000,
  maxToolCalls: 3,
  scheduler: { enabled: true, modelId: null, temperature: 0.3, timeoutMs: 60000, maxTokens: 300 },
  consensus: { enabled: true, timeoutMs: 60000, temperature: 0.2, maxTokens: null },
};

const CONFIG_FILE = path.join(getDataDir(), "roundtable-config.json");

let _config: RoundtableConfig | null = null;

function normalize(raw: Partial<RoundtableConfig> | undefined | null): RoundtableConfig {
  const num = (v: unknown, fallback: number): number => {
    const n = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : NaN;
    if (Number.isNaN(n)) return fallback;
    return Math.max(1, n);
  };
  return {
    maxTokens: num(raw?.maxTokens, DEFAULT_ROUNDTABLE_CONFIG.maxTokens),
    maxToolCalls: num(raw?.maxToolCalls, DEFAULT_ROUNDTABLE_CONFIG.maxToolCalls),
    scheduler: normalizeScheduler(raw?.scheduler),
    consensus: normalizeConsensus(raw?.consensus),
  };
}

function normalizeScheduler(raw: Partial<SchedulerRoundtableConfig> | undefined | null): SchedulerRoundtableConfig {
  const d = DEFAULT_ROUNDTABLE_CONFIG.scheduler;
  const fnum = (v: unknown, fallback: number): number => {
    const n = typeof v === "number" && Number.isFinite(v) ? v : NaN;
    if (Number.isNaN(n)) return fallback;
    return n;
  };
  return {
    enabled: typeof raw?.enabled === "boolean" ? raw.enabled : d.enabled,
    modelId: typeof raw?.modelId === "string" && raw.modelId.trim().length > 0 ? raw.modelId : d.modelId,
    temperature: Math.max(0, Math.min(2, fnum(raw?.temperature, d.temperature))),
    timeoutMs: Math.max(100, Math.min(60000, Math.round(fnum(raw?.timeoutMs, d.timeoutMs)))),
    maxTokens: Math.max(100, Math.min(10000, Math.round(fnum(raw?.maxTokens, d.maxTokens)))),
  };
}

function normalizeConsensus(raw: Partial<ConsensusRoundtableConfig> | undefined | null): ConsensusRoundtableConfig {
  const d = DEFAULT_ROUNDTABLE_CONFIG.consensus;
  const fnum = (v: unknown, fallback: number): number => {
    const n = typeof v === "number" && Number.isFinite(v) ? v : NaN;
    if (Number.isNaN(n)) return fallback;
    return n;
  };
  return {
    enabled: typeof raw?.enabled === "boolean" ? raw.enabled : d.enabled,
    timeoutMs: Math.max(100, Math.min(60000, Math.round(fnum(raw?.timeoutMs, d.timeoutMs)))),
    temperature: Math.max(0, Math.min(2, fnum(raw?.temperature, d.temperature))),
    maxTokens: typeof raw?.maxTokens === "number" && Number.isFinite(raw.maxTokens)
      ? Math.max(100, Math.round(raw.maxTokens))
      : d.maxTokens,
  };
}

function loadConfig(): RoundtableConfig {
  if (_config !== null) return _config;
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
      _config = normalize(data);
    } else {
      _config = { ...DEFAULT_ROUNDTABLE_CONFIG };
    }
  } catch (err) {
    console.warn("读取 roundtable-config.json 失败:", err);
    _config = { ...DEFAULT_ROUNDTABLE_CONFIG };
  }
  return _config;
}

function saveConfig(): void {
  if (_config === null) return;
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(_config, null, 2), "utf-8");
}

/** 获取圆桌会议配置（内存缓存）。 */
export function getRoundtableConfig(): RoundtableConfig {
  return { ...loadConfig() };
}

/** 更新圆桌会议配置并落盘，返回最新配置。 */
export function updateRoundtableConfig(patch: Partial<RoundtableConfig>): RoundtableConfig {
  const current = loadConfig();
  _config = normalize({ ...current, ...patch });
  saveConfig();
  return { ..._config };
}

/** 重置为默认配置并落盘。 */
export function resetRoundtableConfig(): RoundtableConfig {
  _config = { ...DEFAULT_ROUNDTABLE_CONFIG };
  saveConfig();
  return { ..._config };
}
