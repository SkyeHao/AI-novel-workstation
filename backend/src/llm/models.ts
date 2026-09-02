/** LLM 数据模型定义（TS 版，迁移自 llm/models.py）。 */

export enum Role {
  SYSTEM = "system",
  USER = "user",
  ASSISTANT = "assistant",
  FUNCTION = "function",
}

export interface ChatMessageLike {
  role: Role | string;
  content?: string;
  function_call?: Record<string, unknown> | null;
  name?: string | null;
}

export class ChatMessage {
  role: Role;
  content: string;
  function_call: Record<string, unknown> | null;
  name: string | null;
  private _timestamp: string;

  constructor(role: Role | string, content = "", function_call: Record<string, unknown> | null = null, name: string | null = null, timestamp?: string) {
    this.role = (Object.values(Role) as string[]).includes(role as string) ? (role as Role) : Role.USER;
    this.content = content;
    this.function_call = function_call;
    this.name = name;
    this._timestamp = timestamp ?? new Date().toISOString();
  }

  toDict(): Record<string, unknown> {
    const d: Record<string, unknown> = { role: this.role, content: this.content, timestamp: this._timestamp };
    if (this.function_call) d.function_call = this.function_call;
    if (this.name) d.name = this.name;
    return d;
  }
}

export class TokenUsage {
  prompt_tokens = 0;
  completion_tokens = 0;
  total_tokens = 0;

  constructor(prompt = 0, completion = 0, total = 0) {
    this.prompt_tokens = prompt;
    this.completion_tokens = completion;
    this.total_tokens = total;
  }
}

/** 聊天请求参数（OpenAI 协议兼容） */
export class ChatRequest {
  messages: ChatMessage[];
  temperature: number;
  max_tokens: number | null;
  top_p: number;
  frequency_penalty: number;
  presence_penalty: number;
  stop: string[] | string | null;
  seed: number | null;
  functions: Array<Record<string, unknown>> | null;
  function_call: string | Record<string, unknown> | null;
  response_format: Record<string, unknown> | null;

  constructor(init: {
    messages: ChatMessage[];
    temperature?: number;
    max_tokens?: number | null;
    top_p?: number;
    frequency_penalty?: number;
    presence_penalty?: number;
    stop?: string[] | string | null;
    seed?: number | null;
    functions?: Array<Record<string, unknown>> | null;
    function_call?: string | Record<string, unknown> | null;
    response_format?: Record<string, unknown> | null;
  }) {
    this.messages = init.messages;
    this.temperature = init.temperature ?? 0.7;
    this.max_tokens = init.max_tokens ?? null;
    this.top_p = init.top_p ?? 1.0;
    this.frequency_penalty = init.frequency_penalty ?? 0.0;
    this.presence_penalty = init.presence_penalty ?? 0.0;
    this.stop = init.stop ?? null;
    this.seed = init.seed ?? null;
    this.functions = init.functions ?? null;
    this.function_call = init.function_call ?? null;
    this.response_format = init.response_format ?? null;
  }

  toApiParams(model: string): Record<string, unknown> {
    const kwargs: Record<string, unknown> = {
      model,
      messages: this._toApiMessages(),
      temperature: this.temperature,
      top_p: this.top_p,
      frequency_penalty: this.frequency_penalty,
      presence_penalty: this.presence_penalty,
    };
    if (this.max_tokens != null) kwargs.max_tokens = this.max_tokens;
    if (this.stop != null) kwargs.stop = this.stop;
    if (this.seed != null) kwargs.seed = this.seed;
    // 仅出站转换：旧版 functions/function_call 协议转为新版 tools/tool_choice 协议。
    // 内部历史与交互日志仍保持旧格式，各消费方（chat_session/react/orchestrator）零改动。
    if (this.functions != null) {
      kwargs.tools = this.functions.map((f) => ({ type: "function", function: f }));
    }
    if (this.function_call != null) {
      if (typeof this.function_call === "string") {
        kwargs.tool_choice = this.function_call;
      } else {
        const fn = this.function_call as { name?: string };
        if (fn && fn.name) kwargs.tool_choice = { type: "function", function: { name: fn.name } };
      }
    }
    if (this.response_format != null) kwargs.response_format = this.response_format;
    return kwargs;
  }

  /** 仅出站转换：把内部旧协议消息（role=function / assistant.function_call）转换为新版 tools 协议。
   * 新协议要求 assistant 的每条工具调用后必须紧跟同 id 的 role=tool 结果消息，
   * 且 assistant/tool 消息不允许携带 name 字段。内部历史与日志保持旧格式不变。 */
  private _toApiMessages(): Array<Record<string, unknown>> {
    const out: Array<Record<string, unknown>> = [];
    const pendingIds: string[] = [];
    let toolSeq = 0;
    let lastAssistantIdx = -1;
    for (const m of this.messages) {
      const d = m instanceof ChatMessage ? m.toDict() : (m as Record<string, unknown>);
      const role = d.role as string;
      if (role === Role.ASSISTANT && d.function_call && (d.function_call as { name?: string }).name) {
        // 正规 function_call：生成唯一 tool_call id，assistant 携带 tool_calls
        const id = "call_" + String(++toolSeq);
        const fcName = (d.function_call as { name: string }).name;
        let fcArgs = (d.function_call as { arguments?: unknown }).arguments;
        if (typeof fcArgs !== "string") fcArgs = JSON.stringify(fcArgs ?? {});
        out.push({
          role: "assistant",
          content: String(d.content ?? ""),
          tool_calls: [{ id, type: "function", function: { name: fcName, arguments: fcArgs } }],
        });
        pendingIds.push(id);
        lastAssistantIdx = out.length - 1;
      } else if (role === Role.ASSISTANT) {
        out.push({ role: "assistant", content: String(d.content ?? "") });
        lastAssistantIdx = out.length - 1;
      } else if (role === Role.FUNCTION) {
        // 散文形式的工具调用（assistant 未走 function_call 信封）：把工具调用回填到最近一条
        // assistant，保证新协议「assistant.tool_calls 后紧跟同 id 的 tool 结果」成立。
        let id = pendingIds.pop();
        if (!id) {
          id = "call_" + String(++toolSeq);
          const la = lastAssistantIdx >= 0 ? (out[lastAssistantIdx] as Record<string, unknown>) : null;
          if (la) {
            const tcs = (la.tool_calls as Array<Record<string, unknown>> | undefined) ?? [];
            tcs.push({ id, type: "function", function: { name: String(d.name ?? "unknown"), arguments: "{}" } });
            la.tool_calls = tcs;
          }
        }
        out.push({ role: "tool", content: String(d.content ?? ""), tool_call_id: id });
      } else {
        out.push({ role, content: String(d.content ?? "") });
      }
    }
    // 兜底：历史被裁剪/中断导致残留未匹配的 tool_calls 时，剥离它们以避免缺少 tool 结果而被网关拒绝
    const pendingSet = new Set(pendingIds);
    if (pendingSet.size > 0) {
      for (const msg of out) {
        if (msg.role === "assistant" && Array.isArray(msg.tool_calls)) {
          const kept = (msg.tool_calls as Array<{ id: string }>).filter((tc) => !pendingSet.has(tc.id));
          if (kept.length === 0) delete msg.tool_calls;
          else msg.tool_calls = kept;
        }
      }
    }
    return out;
  }
}

/** 聊天响应 */
export class ChatResponse {
  content: string;
  model: string;
  usage: TokenUsage;
  finish_reason: string;
  raw: Record<string, unknown> | null;

  constructor(init: {
    content: string;
    model: string;
    usage?: TokenUsage;
    finish_reason?: string;
    raw?: Record<string, unknown> | null;
  }) {
    this.content = init.content;
    this.model = init.model;
    this.usage = init.usage ?? new TokenUsage();
    this.finish_reason = init.finish_reason ?? "stop";
    this.raw = init.raw ?? null;
  }

  toDict(): Record<string, unknown> {
    return {
      content: this.content,
      model: this.model,
      usage: {
        prompt_tokens: this.usage.prompt_tokens,
        completion_tokens: this.usage.completion_tokens,
        total_tokens: this.usage.total_tokens,
      },
      finish_reason: this.finish_reason,
    };
  }
}

/** 从普通 dict 构建 ChatMessage（兼容持久化恢复） */
export function chatMessageFromDict(data: Record<string, unknown>): ChatMessage {
  return new ChatMessage(
    (data.role as string) ?? "user",
    String(data.content ?? ""),
    (data.function_call as Record<string, unknown> | null) ?? null,
    (data.name as string | null) ?? null,
    (data.timestamp as string | undefined) ?? undefined
  );
}
