/**
 * 应用路径与用户配置目录解析（TS 版，迁移自 config/paths.py）。
 * 所有用户配置统一放在系统用户配置目录（Windows: %APPDATA%；其他平台: ~/.config），
 * 与程序文件隔离，升级不丢。
 */
import * as fs from "node:fs";
import * as os from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const APP_DIR_NAME = "AI-Novel-Workstation";

/** 源码/编译入口定位：backend/src/config（dev）或 backend/dist/config（prod） */
export const BACKEND_ROOT = resolve(fileURLToPath(import.meta.url), "../../..");
/** 仓库根（数据目录 data/ 所在位置） */
export const PROJECT_ROOT = resolve(BACKEND_ROOT, "..");

export function getUserConfigDir(): string {
  const override = process.env.AI_NOVEL_CONFIG_DIR;
  if (override) return resolve(override);
  if (process.platform === "win32" && process.env.APPDATA) {
    return resolve(process.env.APPDATA, APP_DIR_NAME);
  }
  return resolve(os.homedir(), ".config", APP_DIR_NAME);
}

export function getEnvFilePath(): string {
  const dir = getUserConfigDir();
  fs.mkdirSync(dir, { recursive: true });
  return resolve(dir, ".env");
}

export function getLegacyEnvPath(): string {
  return resolve(PROJECT_ROOT, ".env");
}

/** 运行期数据目录（app-state / interactions / agent-roles / projects）。桌面版可用 AI_NOVEL_DATA_DIR 覆盖到用户可写目录。 */
export function getDataDir(): string {
  const override = process.env.AI_NOVEL_DATA_DIR;
  if (override) return resolve(override);
  return resolve(PROJECT_ROOT, "data");
}

/** 本地 embedding 模型目录（离线权重）。桌面版可用 AI_NOVEL_EMBEDDING_DIR 覆盖到内置资源目录。 */
export function getEmbeddingDir(): string {
  const override = process.env.AI_NOVEL_EMBEDDING_DIR;
  if (override) return resolve(override);
  return resolve(getUserConfigDir(), "models");
}

export function migrateEnvIfNeeded(): string {
  const target = getEnvFilePath();
  if (fs.existsSync(target)) return target;
  const legacy = getLegacyEnvPath();
  if (fs.existsSync(legacy)) {
    try {
      fs.mkdirSync(resolve(target, ".."), { recursive: true });
      fs.copyFileSync(legacy, target);
      console.log(`[paths] 已迁移配置 .env -> ${target}`);
    } catch (err) {
      console.warn(`[paths] 迁移 .env 失败: ${err}`);
    }
  }
  return target;
}
