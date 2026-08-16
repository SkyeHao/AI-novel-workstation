/**
 * Agent 会话存储（按书多会话，TS 版）。
 * 会话元数据与消息持久化于项目目录 memory/sessions/ 下：
 *   memory/sessions/index.json        —— 会话索引（id/title/state/时间/消息数）
 *   memory/sessions/<sessionId>.jsonl —— 每行一条消息（与旧 agent_chat.jsonl 同格式）
 * 兼容旧数据：存在 memory/agent_chat.jsonl 时自动迁移为「默认对话」会话。
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import type { ProjectStore } from "./project_store.js";

const LEGACY_CHAT_FILE = "agent_chat.jsonl";
export const DEFAULT_SESSION_ID = "default";

export interface AgentSessionMeta {
  id: string;
  title: string;
  state: string;
  created_at: string;
  updated_at: string;
  message_count: number;
}

interface SessionIndexFile {
  sessions: AgentSessionMeta[];
}

function nowSeconds(): string {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

export class AgentSessionStore {
  constructor(private _projectStore: ProjectStore) {}

  sessionsDir(projectId: string): string {
    return this._projectStore.resolve(projectId, "memory/sessions");
  }

  private _indexFile(projectId: string): string {
    return path.join(this.sessionsDir(projectId), "index.json");
  }

  private _sessionFile(projectId: string, sessionId: string): string {
    return path.join(this.sessionsDir(projectId), `${sessionId}.jsonl`);
  }

  private _legacyChatFile(projectId: string): string {
    return this._projectStore.resolve(projectId, `memory/${LEGACY_CHAT_FILE}`);
  }

  private _readIndex(projectId: string): AgentSessionMeta[] {
    const p = this._indexFile(projectId);
    if (!fs.existsSync(p)) return [];
    try {
      const data = JSON.parse(fs.readFileSync(p, "utf-8")) as SessionIndexFile;
      return Array.isArray(data.sessions) ? data.sessions : [];
    } catch {
      return [];
    }
  }

  private _writeIndex(projectId: string, sessions: AgentSessionMeta[]): void {
    const dir = this.sessionsDir(projectId);
    fs.mkdirSync(dir, { recursive: true });
    const data: SessionIndexFile = { sessions };
    fs.writeFileSync(this._indexFile(projectId), JSON.stringify(data, null, 2), "utf-8");
  }

  /** 列表（含旧数据迁移） */
  list(projectId: string): AgentSessionMeta[] {
    const sessions = this._readIndex(projectId);
    if (sessions.length > 0) return sessions;
    const legacy = this._legacyChatFile(projectId);
    if (fs.existsSync(legacy)) {
      const lines = fs
        .readFileSync(legacy, "utf-8")
        .split(/\r?\n/)
        .filter((l) => l.trim());
      const messages = lines
        .map((l) => {
          try {
            return JSON.parse(l) as Record<string, unknown>;
          } catch {
            return null;
          }
        })
        .filter((m): m is Record<string, unknown> => m !== null);
      const meta: AgentSessionMeta = {
        id: DEFAULT_SESSION_ID,
        title: "默认对话",
        state: "ideation",
        created_at: nowSeconds(),
        updated_at: nowSeconds(),
        message_count: messages.length,
      };
      this._writeIndex(projectId, [meta]);
      // 迁移消息文件，保留旧文件作备份
      const target = this._sessionFile(projectId, DEFAULT_SESSION_ID);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(legacy, target);
      return [meta];
    }
    return [];
  }

  get(projectId: string, sessionId: string): AgentSessionMeta | null {
    return this.list(projectId).find((s) => s.id === sessionId) ?? null;
  }

  create(projectId: string, opts: { title?: string; state?: string } = {}): AgentSessionMeta {
    const now = nowSeconds();
    const meta: AgentSessionMeta = {
      id: randomUUID(),
      title: opts.title?.trim() || `会话 ${new Date().toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}`,
      state: opts.state ?? "ideation",
      created_at: now,
      updated_at: now,
      message_count: 0,
    };
    const sessions = this._readIndex(projectId);
    sessions.push(meta);
    this._writeIndex(projectId, sessions);
    fs.mkdirSync(path.dirname(this._sessionFile(projectId, meta.id)), { recursive: true });
    return meta;
  }

  rename(projectId: string, sessionId: string, title: string): AgentSessionMeta | null {
    const sessions = this._readIndex(projectId);
    const idx = sessions.findIndex((s) => s.id === sessionId);
    if (idx < 0) return null;
    sessions[idx]!.title = title.trim() || sessions[idx]!.title;
    sessions[idx]!.updated_at = nowSeconds();
    this._writeIndex(projectId, sessions);
    return sessions[idx]!;
  }

  remove(projectId: string, sessionId: string): boolean {
    const sessions = this._readIndex(projectId);
    const idx = sessions.findIndex((s) => s.id === sessionId);
    if (idx < 0) return false;
    sessions.splice(idx, 1);
    this._writeIndex(projectId, sessions);
    try {
      const f = this._sessionFile(projectId, sessionId);
      if (fs.existsSync(f)) fs.unlinkSync(f);
    } catch (err) {
      console.warn(`删除会话文件失败: ${err}`);
    }
    return true;
  }

  loadMessages(projectId: string, sessionId: string): Array<Record<string, unknown>> {
    const p = this._sessionFile(projectId, sessionId);
    if (!fs.existsSync(p)) return [];
    const out: Array<Record<string, unknown>> = [];
    for (const line of fs.readFileSync(p, "utf-8").split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        out.push(JSON.parse(line) as Record<string, unknown>);
      } catch {
        /* 忽略损坏行 */
      }
    }
    return out;
  }

  saveMessages(projectId: string, sessionId: string, messages: Array<Record<string, unknown>>): void {
    const p = this._sessionFile(projectId, sessionId);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, messages.map((m) => JSON.stringify(m)).join("\n") + (messages.length ? "\n" : ""), "utf-8");
  }

  /** 更新会话元数据（时间 / 状态 / 消息数） */
  touch(projectId: string, sessionId: string, patch: { state?: string; message_count?: number } = {}): void {
    const sessions = this._readIndex(projectId);
    const idx = sessions.findIndex((s) => s.id === sessionId);
    if (idx < 0) return;
    if (patch.state !== undefined) sessions[idx]!.state = patch.state;
    if (patch.message_count !== undefined) sessions[idx]!.message_count = patch.message_count;
    sessions[idx]!.updated_at = nowSeconds();
    this._writeIndex(projectId, sessions);
  }
}
