/**
 * 群聊记录存储（工单 07）。
 *
 * 三层模型：
 *   内存  —— 会话对象（实时读写、调度）；
 *   落库  —— 共识节点 + 最终方案（成果单独落库，与过程记录分离）；
 *   文件  —— memory/discussions/<sessionId>.json 完整记录按书持久化，刷新 / 重启可恢复。
 *
 * 文件布局（按项目，路径由 ProjectStore 解析，程序决定、模型不可传）：
 *   memory/discussions/<sessionId>.json            —— 完整过程记录（成员 / 全部消息 / 状态）
 *   memory/discussions/<sessionId>.consensus.json   —— 共识节点 + 最终方案（成果）
 *
 * 持久化层以 ChatStore 接口隔离：编排器与路由只依赖接口，切换存储实现不侵入。
 * 所有写失败静默降级（记录非关键路径，不阻断讨论）。
 */
import * as fs from "node:fs";
import * as path from "node:path";
import type { ProjectStore } from "./project_store.js";
import type { ChatSessionSnapshot } from "../workflow/chat_session.js";

export interface ChatConsensusNode {
  level: number;
  message: string;
  signals?: string[];
  timestamp: string;
}

export interface ChatStore {
  /** 全量落盘（会话开始 / 终态调用）：写过程记录 + 合并共识 / 最终方案。 */
  save(snapshot: ChatSessionSnapshot): void;
  /** 增量追加一条消息到过程记录。 */
  appendMessage(projectId: string, sessionId: string, message: ChatSessionSnapshot["messages"][number]): void;
  /** 记录共识节点（成果，与过程记录分离）。 */
  appendConsensus(projectId: string, sessionId: string, node: ChatConsensusNode): void;
  /** 写入最终方案（合成者总结）。 */
  setSummary(projectId: string, sessionId: string, summary: string): void;
  /** 更新会话状态。 */
  setStatus(projectId: string, sessionId: string, status: ChatSessionSnapshot["status"]): void;
  /** 加载完整会话（含共识 / 最终方案），不存在返回 null。 */
  load(projectId: string, sessionId: string): ChatSessionSnapshot | null;
  /** 项目内会话列表（按 updatedAt 倒序）。 */
  list(projectId: string): ChatSessionSnapshot[];
  /** 删除会话（过程记录 + 共识/成果），返回是否存在过程记录文件。 */
  delete(projectId: string, sessionId: string): boolean;
}

interface ConsensusFile {
  nodes: ChatConsensusNode[];
  summary?: string;
}

export class FileChatStore implements ChatStore {
  constructor(private _projectStore: ProjectStore) {}

  private _dir(projectId: string): string {
    return this._projectStore.resolve(projectId, "memory/discussions");
  }

  private _recordFile(projectId: string, sessionId: string): string {
    return path.join(this._dir(projectId), sessionId + ".json");
  }

  private _consensusFile(projectId: string, sessionId: string): string {
    return path.join(this._dir(projectId), sessionId + ".consensus.json");
  }

  private _read<T>(file: string): T | null {
    try {
      if (!fs.existsSync(file)) return null;
      return JSON.parse(fs.readFileSync(file, "utf-8")) as T;
    } catch (err) {
      console.warn("读取讨论记录失败: " + file + " " + String(err));
      return null;
    }
  }

  private _write(file: string, data: unknown): void {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf-8");
    } catch (err) {
      console.warn("写入讨论记录失败: " + file + " " + String(err));
    }
  }

  save(snapshot: ChatSessionSnapshot): void {
    const { summary, consensusNodes, ...record } = snapshot;
    // 按 id 合并已有消息（追加不删除）：避免携带旧快照的 save 覆盖掉新追加的消息
    const existing = this._read<{ messages?: Array<{ id?: string; [k: string]: unknown }> }>(
      this._recordFile(snapshot.projectId, snapshot.id)
    );
    if (existing && Array.isArray(existing.messages) && Array.isArray(record.messages)) {
      const seen = new Set(record.messages.map((m) => m.id));
      for (const m of existing.messages) {
        if (m && m.id && !seen.has(m.id)) {
          record.messages.push(m as unknown as ChatSessionSnapshot["messages"][number]);
          seen.add(m.id);
        }
      }
    }
    this._write(this._recordFile(snapshot.projectId, snapshot.id), record);
    if (summary === undefined && consensusNodes.length === 0) return;
    const consensus = this._read<ConsensusFile>(this._consensusFile(snapshot.projectId, snapshot.id)) ?? { nodes: [] };
    if (summary !== undefined) consensus.summary = summary;
    const seen = new Set(consensus.nodes.map((n) => n.timestamp + "|" + n.message));
    for (const node of consensusNodes) {
      const key = node.timestamp + "|" + node.message;
      if (!seen.has(key)) {
        consensus.nodes.push(node);
        seen.add(key);
      }
    }
    this._write(this._consensusFile(snapshot.projectId, snapshot.id), consensus);
  }

  appendMessage(projectId: string, sessionId: string, message: ChatSessionSnapshot["messages"][number]): void {
    const record = this._read<Record<string, unknown>>(this._recordFile(projectId, sessionId));
    if (!record) return;
    const messages = Array.isArray(record.messages) ? (record.messages as unknown[]) : [];
    messages.push(message);
    record.messages = messages;
    record.updatedAt = new Date().toISOString();
    this._write(this._recordFile(projectId, sessionId), record);
  }

  appendConsensus(projectId: string, sessionId: string, node: ChatConsensusNode): void {
    const consensus = this._read<ConsensusFile>(this._consensusFile(projectId, sessionId)) ?? { nodes: [] };
    consensus.nodes.push(node);
    this._write(this._consensusFile(projectId, sessionId), consensus);
  }

  setSummary(projectId: string, sessionId: string, summary: string): void {
    const consensus = this._read<ConsensusFile>(this._consensusFile(projectId, sessionId)) ?? { nodes: [] };
    consensus.summary = summary;
    this._write(this._consensusFile(projectId, sessionId), consensus);
  }

  setStatus(projectId: string, sessionId: string, status: ChatSessionSnapshot["status"]): void {
    const record = this._read<Record<string, unknown>>(this._recordFile(projectId, sessionId));
    if (!record) return;
    record.status = status;
    record.updatedAt = new Date().toISOString();
    this._write(this._recordFile(projectId, sessionId), record);
  }

  load(projectId: string, sessionId: string): ChatSessionSnapshot | null {
    const record = this._read<ChatSessionSnapshot>(this._recordFile(projectId, sessionId));
    if (!record) return null;
    const consensus = this._read<ConsensusFile>(this._consensusFile(projectId, sessionId));
    return {
      ...record,
      consensusNodes: consensus?.nodes ?? [],
      summary: consensus?.summary,
    };
  }

  list(projectId: string): ChatSessionSnapshot[] {
    const dir = this._dir(projectId);
    let files: string[] = [];
    try {
      files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
    } catch {
      return [];
    }
    const out: ChatSessionSnapshot[] = [];
    for (const f of files) {
      if (!f.endsWith(".json") || f.endsWith(".consensus.json")) continue;
      const record = this._read<ChatSessionSnapshot>(path.join(dir, f));
      if (!record || !record.id) continue;
      const consensus = this._read<ConsensusFile>(this._consensusFile(projectId, record.id));
      out.push({
        ...record,
        consensusNodes: consensus?.nodes ?? [],
        summary: consensus?.summary,
      });
    }
    out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    return out;
  }

  delete(projectId: string, sessionId: string): boolean {
    const record = this._recordFile(projectId, sessionId);
    let existed = false;
    try {
      if (fs.existsSync(record)) {
        fs.rmSync(record, { force: true });
        existed = true;
      }
      const consensus = this._consensusFile(projectId, sessionId);
      if (fs.existsSync(consensus)) fs.rmSync(consensus, { force: true });
    } catch (err) {
      console.warn("删除讨论记录失败: " + String(err));
    }
    return existed;
  }
}
