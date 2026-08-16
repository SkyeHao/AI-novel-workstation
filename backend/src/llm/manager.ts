/** 多模型管理器（TS 版，迁移自 llm/manager.py）。按任务类型路由到不同 LLM Client。 */
import { LLMConfigError } from "./exceptions.js";
import { LLMClient } from "./client.js";
import { getSettings, type LLMModelConfig } from "../config/settings.js";
import { InteractionLogger } from "./interaction_logger.js";

export type TaskType = "text" | "structure" | "check";

export const TEXT = "text";
export const STRUCTURE = "structure";
export const CHECK = "check";

const FALLBACK_CHAIN: Record<TaskType, TaskType[]> = {
  text: [STRUCTURE, CHECK],
  structure: [TEXT, CHECK],
  check: [STRUCTURE, TEXT],
};

export class LLMClientManager {
  private _clients: Partial<Record<TaskType, LLMClient>> = {};
  private _configs: Partial<Record<TaskType, LLMModelConfig>> = {};
  private _fallbackChain: Record<TaskType, TaskType[]> = { ...FALLBACK_CHAIN };

  static fromSettings(interaction_logger: InteractionLogger | null = null): LLMClientManager {
    const settings = getSettings();
    const manager = new LLMClientManager();
    for (const [task, config] of Object.entries(settings.getAllConfigs())) {
      const taskType = task as TaskType;
      if (config.apiKey) {
        manager.register(taskType, config, interaction_logger);
      } else {
        console.log(`[llm] 跳过未配置的 LLM: task=${taskType}（api_key 为空）`);
      }
    }
    return manager;
  }

  register(task: TaskType, config: LLMModelConfig, interaction_logger: InteractionLogger | null = null): void {
    this._clients[task] = new LLMClient(config, interaction_logger);
    this._configs[task] = config;
  }

  unregister(task: TaskType): void {
    if (this._clients[task]) {
      try {
        this._clients[task]!.close();
      } catch {
        /* 忽略关闭错误 */
      }
    }
    delete this._clients[task];
    delete this._configs[task];
  }

  /** 替换某个任务的 client（用新配置重建） */
  replace(task: TaskType, config: LLMModelConfig, interaction_logger: InteractionLogger | null = null): LLMClient {
    this.unregister(task);
    const client = new LLMClient(config, interaction_logger);
    this._clients[task] = client;
    this._configs[task] = config;
    return client;
  }

  get_client(task: TaskType): LLMClient {
    if (this._clients[task]) return this._clients[task]!;
    for (const fallback of this._fallbackChain[task] ?? []) {
      if (this._clients[fallback]) {
        console.warn(`任务 '${task}' 未配置，降级使用 '${fallback}' 的 client`);
        return this._clients[fallback]!;
      }
    }
    const anyTask = Object.keys(this._clients)[0] as TaskType | undefined;
    if (anyTask) {
      console.warn(`任务 '${task}' 未配置且无降级链，使用任意可用 client '${anyTask}'`);
      return this._clients[anyTask]!;
    }
    throw new LLMConfigError(`没有可用的 LLM client（任务 '${task}' 未配置，降级链也全部不可用）`);
  }

  get_config(task: TaskType): LLMModelConfig | null {
    return this._configs[task] ?? null;
  }

  set_fallback_chain(task: TaskType, chain: TaskType[]): void {
    this._fallbackChain[task] = chain;
  }

  get available_tasks(): TaskType[] {
    return Object.keys(this._clients) as TaskType[];
  }

  close_all(): void {
    for (const [task, client] of Object.entries(this._clients)) {
      try {
        client!.close();
      } catch (err) {
        console.error(`关闭 client '${task}' 失败: ${err}`);
      }
    }
    this._clients = {};
    this._configs = {};
  }

  toString(): string {
    const tasks = Object.entries(this._configs)
      .map(([t, c]) => `${t}=${c!.model}`)
      .join(", ");
    return `LLMClientManager(${tasks})`;
  }
}
