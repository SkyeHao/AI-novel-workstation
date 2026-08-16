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
      messages: this.messages.map((m) => m.toDict()),
      temperature: this.temperature,
      top_p: this.top_p,
      frequency_penalty: this.frequency_penalty,
      presence_penalty: this.presence_penalty,
    };
    if (this.max_tokens != null) kwargs.max_tokens = this.max_tokens;
    if (this.stop != null) kwargs.stop = this.stop;
    if (this.seed != null) kwargs.seed = this.seed;
    if (this.functions != null) kwargs.functions = this.functions;
    if (this.function_call != null) kwargs.function_call = this.function_call;
    if (this.response_format != null) kwargs.response_format = this.response_format;
    return kwargs;
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
