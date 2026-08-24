/** LLM 交互记录持久化存储（TS 版）。
 * 采用 data/interactions.jsonl 追加式存储，替代 Python 版 SQLite（免原生依赖）。
 * 每条交互含完整请求/响应/工具执行信息。
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { PROJECT_ROOT } from "../config/paths.js";

const DB_DIR = process.env.AI_NOVEL_DATA_DIR ? path.resolve(process.env.AI_NOVEL_DATA_DIR) : path.join(PROJECT_ROOT, "data");
const DB_PATH = path.join(DB_DIR, "interactions.jsonl");

export interface StoredInteraction {
  id: string;
  source: string;
  title: string;
  model: string;
  task_type: string;
  temperature: number;
  max_tokens: number | null;
  finish_reason: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  elapsed_ms: number;
  error: string;
  timestamp: string;
  messages: Array<Record<string, unknown>>;
  functions: Array<Record<string, unknown>> | null;
  function_call: string | Record<string, unknown> | null;
  response_content: string;
  response_function_call: Record<string, unknown> | null;
  tool_name: string;
  tool_args: Record<string, unknown>;
  tool_result: string;
  tool_success: boolean;
  created_at: string;
  project_id: string;
  session_id: string;
  turn_id: string;
  user_message: string;
  /** 记录渠道：agent=单 Agent 创造；group_chat=多 Agent 群聊（工单 09） */
  channel?: "agent" | "group_chat";
  /** 群聊记录：发言成员 id（工单 09） */
  member_id?: string;
  /** 群聊记录：发言成员名（工单 09） */
  member_name?: string;
}

function nowSeconds(): string {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

function ensureDir(): void {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

function readAll(): StoredInteraction[] {
  ensureDir();
  if (!fs.existsSync(DB_PATH)) return [];
  const out: StoredInteraction[] = [];
  const lines = fs.readFileSync(DB_PATH, "utf-8").split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as StoredInteraction);
    } catch {
      /* 忽略损坏行 */
    }
  }
  return out;
}

function writeAll(records: StoredInteraction[]): void {
  ensureDir();
  fs.writeFileSync(DB_PATH, records.map((r) => JSON.stringify(r)).join("\n") + (records.length ? "\n" : ""), "utf-8");
}

function extractTitle(interaction: Record<string, unknown>): string {
  const messages = (interaction.messages as Array<Record<string, unknown>> | undefined) ?? [];
  const firstUser = messages.find((m) => m.role === "user");
  const content = String(firstUser?.content ?? "");
  const clean = content.replace(/\s+/g, " ").trim();
  return clean.length > 40 ? clean.slice(0, 40) + "…" : clean;
}

/** 推导记录渠道：新数据读 channel 字段；旧数据按 source + session_id 前缀判定，无需迁移（工单 09）。 */
function deriveChannel(r: Pick<StoredInteraction, "channel" | "source" | "session_id">): "agent" | "group_chat" {
  if (r.channel === "agent" || r.channel === "group_chat") return r.channel;
  if (r.source === "chat" || r.source === "chat_apply") {
    return (r.session_id ?? "").startsWith("chat:") ? "group_chat" : "agent";
  }
  return "agent";
}

export function saveInteraction(
  source: string,
  interaction: Record<string, unknown> | import("../llm/interaction_logger.js").LLMInteraction,
  opts: { title?: string; task_type?: string; session_id?: string; turn_id?: string; user_message?: string; project_id?: string; channel?: "agent" | "group_chat"; member_id?: string; member_name?: string } = {}
): StoredInteraction {
  const sessionId = opts.session_id ?? "";
  const rec: StoredInteraction = {
    id: randomUUID(),
    source,
    title: opts.title ?? extractTitle(interaction as Record<string, unknown>),
    model: String(interaction.model ?? ""),
    task_type: opts.task_type ?? "",
    temperature: Number(interaction.temperature ?? 0.7),
    max_tokens: (interaction.max_tokens as number | null) ?? null,
    finish_reason: String(interaction.finish_reason ?? ""),
    prompt_tokens: Number(interaction.prompt_tokens ?? 0),
    completion_tokens: Number(interaction.completion_tokens ?? 0),
    total_tokens: Number(interaction.total_tokens ?? 0),
    elapsed_ms: Number(interaction.elapsed_ms ?? 0),
    error: String(interaction.error ?? ""),
    timestamp: String(interaction.timestamp ?? ""),
    messages: (interaction.messages as Array<Record<string, unknown>>) ?? [],
    functions: (interaction.functions as Array<Record<string, unknown>> | null) ?? null,
    function_call: (interaction.function_call as string | Record<string, unknown> | null) ?? null,
    response_content: String(interaction.response_content ?? ""),
    response_function_call: (interaction.response_function_call as Record<string, unknown> | null) ?? null,
    tool_name: String(interaction.tool_name ?? ""),
    tool_args: (interaction.tool_args as Record<string, unknown>) ?? {},
    tool_result: String(interaction.tool_result ?? ""),
    tool_success: interaction.tool_success !== false,
    created_at: nowSeconds(),
    project_id: opts.project_id ?? "",
    session_id: opts.session_id ?? "",
    turn_id: opts.turn_id ?? "",
    user_message: opts.user_message ?? "",
    channel: opts.channel ?? deriveChannel({ channel: undefined, source, session_id: sessionId }),
    member_id: opts.member_id ?? "",
    member_name: opts.member_name ?? "",
  };
  ensureDir();
  // 追加写入前确保文件以换行结尾，避免粘行破坏 JSONL
  if (fs.existsSync(DB_PATH)) {
    const st = fs.statSync(DB_PATH);
    if (st.size > 0) {
      const fd = fs.openSync(DB_PATH, "r");
      const last = Buffer.alloc(1);
      fs.readSync(fd, last, 0, 1, st.size - 1);
      fs.closeSync(fd);
      if (last[0] !== 0x0a) fs.appendFileSync(DB_PATH, "\n", "utf-8");
    }
  }
  fs.appendFileSync(DB_PATH, JSON.stringify(rec) + "\n", "utf-8");
  return rec;
}

export function listInteractions(opts: { source?: string; limit?: number; offset?: number; session_id?: string; channel?: "agent" | "group_chat" } = {}): { items: StoredInteraction[]; total: number; limit: number; offset: number } {
  const limit = opts.limit ?? 20;
  const offset = opts.offset ?? 0;
  let records = readAll();
  if (opts.source) records = records.filter((r) => r.source === opts.source);
  if (opts.session_id) records = records.filter((r) => r.session_id === opts.session_id);
  if (opts.channel) records = records.filter((r) => deriveChannel(r) === opts.channel);
  records.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return { items: records.slice(offset, offset + limit), total: records.length, limit, offset };
}

export function getInteraction(id: string): StoredInteraction | null {
  return readAll().find((r) => r.id === id) ?? null;
}

export function deleteInteraction(id: string): boolean {
  const records = readAll();
  const next = records.filter((r) => r.id !== id);
  if (next.length === records.length) return false;
  writeAll(next);
  return true;
}

export function deleteBySession(sessionId: string): number {
  if (!sessionId) return 0;
  const records = readAll();
  const next = records.filter((r) => r.session_id !== sessionId);
  const removed = records.length - next.length;
  writeAll(next);
  return removed;
}

export function clearAllInteractions(source?: string): number {
  const records = readAll();
  const next = source ? records.filter((r) => r.source !== source) : [];
  const removed = records.length - next.length;
  writeAll(next);
  return removed;
}

/** 聚合后的交互记录（一次用户消息 + 所有相关LLM调用） */
export interface AggregatedInteraction {
  turn_id: string;
  user_message: string;
  project_id: string;
  session_id: string;
  /** 记录渠道：agent=单 Agent 创造；group_chat=群聊（工单 09） */
  channel: "agent" | "group_chat";
  /** 会话标题（由调用方通过 sessionTitleResolver 注入，避免前端二次拉取） */
  session_title: string;
  timestamp: string;
  total_tokens: number;
  total_elapsed_ms: number;
  has_error: boolean;
  records: StoredInteraction[];
}

/** 按 turn_id 聚合交互记录 */
export function aggregateInteractions(opts: {
  source?: string;
  limit?: number;
  offset?: number;
  session_id?: string;
  project_id?: string;
  channel?: "agent" | "group_chat";
  /** 会话标题解析器：(projectId, sessionId) => 标题 | null */
  sessionTitleResolver?: (projectId: string, sessionId: string) => string | null;
} = {}): {
  items: AggregatedInteraction[];
  total: number;
  limit: number;
  offset: number;
} {
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;
  let records = readAll();
  
  if (opts.source) records = records.filter((r) => r.source === opts.source);
  if (opts.session_id) records = records.filter((r) => r.session_id === opts.session_id);
  if (opts.project_id) records = records.filter((r) => r.project_id === opts.project_id);
  if (opts.channel) records = records.filter((r) => deriveChannel(r) === opts.channel);
  
  // 按 turn_id 分组
  const turnMap = new Map<string, StoredInteraction[]>();
  for (const r of records) {
    const key = r.turn_id || r.id; // 兼容旧数据（无 turn_id）
    if (!turnMap.has(key)) turnMap.set(key, []);
    turnMap.get(key)!.push(r);
  }
  
  // 聚合每个 turn
  const aggregated: AggregatedInteraction[] = [];
  for (const [turnId, recs] of turnMap) {
    const first = recs[0];
    aggregated.push({
      turn_id: turnId,
      user_message: first.user_message || '',
      project_id: first.project_id,
      session_id: first.session_id,
      channel: deriveChannel(first),
      session_title: opts.sessionTitleResolver?.(first.project_id, first.session_id) ?? '',
      timestamp: first.created_at,
      total_tokens: recs.reduce((sum, r) => sum + r.total_tokens, 0),
      total_elapsed_ms: recs.reduce((sum, r) => sum + r.elapsed_ms, 0),
      has_error: recs.some(r => !!r.error),
      records: recs,
    });
  }
  
  // 按时间倒序
  aggregated.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  
  return {
    items: aggregated.slice(offset, offset + limit),
    total: aggregated.length,
    limit,
    offset,
  };
}
