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
  session_id: string;
  turn_id: string;
  user_message: string;
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

export function saveInteraction(
  source: string,
  interaction: Record<string, unknown> | import("../llm/interaction_logger.js").LLMInteraction,
  opts: { title?: string; task_type?: string; session_id?: string; turn_id?: string; user_message?: string } = {}
): StoredInteraction {
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
    session_id: opts.session_id ?? "",
    turn_id: opts.turn_id ?? "",
    user_message: opts.user_message ?? "",
  };
  const records = readAll();
  records.push(rec);
  writeAll(records);
  return rec;
}

export function listInteractions(opts: { source?: string; limit?: number; offset?: number; session_id?: string } = {}): { items: StoredInteraction[]; total: number; limit: number; offset: number } {
  const limit = opts.limit ?? 20;
  const offset = opts.offset ?? 0;
  let records = readAll();
  if (opts.source) records = records.filter((r) => r.source === opts.source);
  if (opts.session_id) records = records.filter((r) => r.session_id === opts.session_id);
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


