/**
 * 通用 LLM Client（TS 版，迁移自 llm/client.py）。
 * 兼容所有 OpenAI 协议 API；支持同步/异步/流式、自动重试、token 计数。
 */
import OpenAI from "openai";
import { encodingForModel, getEncoding, type Tiktoken } from "js-tiktoken";
import type { LLMModelConfig } from "../config/settings.js";
import {
  LLMAuthError,
  LLMConfigError,
  LLMRateLimitError,
  LLMRequestError,
  LLMResponseError,
  LLMTimeoutError,
} from "./exceptions.js";
import { ChatMessage, ChatRequest, ChatResponse, TokenUsage } from "./models.js";
import { InteractionLogger, type LLMInteraction } from "./interaction_logger.js";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class LLMClient {
  config: LLMModelConfig;
  private _interaction_logger: InteractionLogger | null;
  private _sync_client: OpenAI;
  private _encoding: Tiktoken;

  constructor(config: LLMModelConfig, interaction_logger: InteractionLogger | null = null) {
    if (!config.apiKey) throw new LLMConfigError("api_key 不能为空");
    this.config = config;
    this._interaction_logger = interaction_logger;
    this._sync_client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
      timeout: Math.round(config.timeout * 1000),
      maxRetries: 0,
    });
    try {
      this._encoding = encodingForModel(config.model as Parameters<typeof encodingForModel>[0]);
    } catch {
      this._encoding = getEncoding("cl100k_base");
    }
  }

  get name(): string {
    return `${this.config.baseUrl}/${this.config.model}`;
  }

  // ------------------------------------------------------------------
  // 同步接口
  // ------------------------------------------------------------------

  chat(messages: Array<ChatMessage | Record<string, unknown>>, kwargs: Record<string, unknown> = {}): ChatResponse {
    return this._withRetry(() => {
      const request = this._buildRequest(messages, kwargs);
      const apiParams = request.toApiParams(this.config.model);
      const interaction = this._interaction_logger?.record(
        request.messages,
        this.config.model,
        request.temperature,
        request.max_tokens,
        request.functions,
        request.function_call
      ) ?? null;
      const start = Date.now();
      try {
        const completion = this._sync_client.chat.completions.create(apiParams as never);
        const resp = this._parseResponse(completion);
        if (interaction) {
          interaction.response_content = resp.content;
          interaction.finish_reason = resp.finish_reason;
          interaction.prompt_tokens = resp.usage.prompt_tokens;
          interaction.completion_tokens = resp.usage.completion_tokens;
          interaction.total_tokens = resp.usage.total_tokens;
          interaction.elapsed_ms = Date.now() - start;
          this._interaction_logger?.commit(interaction);
        }
        return resp;
      } catch (exc) {
        if (interaction) {
          interaction.error = exc instanceof Error ? exc.message : String(exc);
          interaction.elapsed_ms = Date.now() - start;
          this._interaction_logger?.commit(interaction);
        }
        throw this._wrapException(exc);
      }
    });
  }

  // ------------------------------------------------------------------
  // 异步接口
  // ------------------------------------------------------------------

  async achat(
    messages: Array<ChatMessage | Record<string, unknown>>,
    kwargs: Record<string, unknown> = {},
    signal?: AbortSignal
  ): Promise<ChatResponse> {
    if (signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
    return this._withRetryAsync(async () => {
      const request = this._buildRequest(messages, kwargs);
      const apiParams = request.toApiParams(this.config.model);
      const interaction = this._interaction_logger?.record(
        request.messages,
        this.config.model,
        request.temperature,
        request.max_tokens,
        request.functions,
        request.function_call
      ) ?? null;
      const start = Date.now();
      try {
        const completion = await this._sync_client.chat.completions.create(apiParams as never, { signal } as never);
        const resp = this._parseResponse(completion);
        if (interaction) {
          interaction.response_content = resp.content;
          interaction.finish_reason = resp.finish_reason;
          interaction.prompt_tokens = resp.usage.prompt_tokens;
          interaction.completion_tokens = resp.usage.completion_tokens;
          interaction.total_tokens = resp.usage.total_tokens;
          interaction.elapsed_ms = Date.now() - start;
          this._interaction_logger?.commit(interaction);
        }
        return resp;
      } catch (exc) {
        if (interaction) {
          interaction.error = exc instanceof Error ? exc.message : String(exc);
          interaction.elapsed_ms = Date.now() - start;
          this._interaction_logger?.commit(interaction);
        }
        throw this._wrapException(exc);
      }
    });
  }

  /** 流式调用，逐片段 yield 文本；onDelta 可感知原生 function_call 到达 */
  async *astream(
    messages: Array<ChatMessage | Record<string, unknown>>,
    kwargs: Record<string, unknown> = {},
    onDelta?: (delta: { content?: string | null; function_call?: { name?: string | null; arguments?: string | null } | null }) => void,
    signal?: AbortSignal
  ): AsyncGenerator<string> {
    if (signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
    const request = this._buildRequest(messages, kwargs);
    const apiParams = request.toApiParams(this.config.model);
    apiParams.stream = true;
    const interaction = this._interaction_logger?.record(
      request.messages,
      this.config.model,
      request.temperature,
      request.max_tokens,
      request.functions,
      request.function_call
    ) ?? null;
    const start = Date.now();
    let accumulated = "";
    let finishReason = "";
    let prompt = 0;
    let completion = 0;
    // 新版流式工具调用（tool_calls）→ 按 index 累积分片，再合成为旧 function_call 片段，
    // 供 react.ts native 模式（累加 name/arguments）消费，保持其流式逻辑不变。
    const streamFcFragments = new Map<number, { name: string; arguments: string }>();
    // 流式空闲看门狗：长时间无新分片则中止，避免「卡住」无限等待（SDK timeout 只覆盖建连，不覆盖流式过程）
    const idleTimeoutMs = (Number(process.env.LLM_STREAM_IDLE_TIMEOUT) || 90) * 1000;
    let idleAborted = false;
    try {
      const stream = (await this._sync_client.chat.completions.create(apiParams as never, { signal } as never)) as unknown as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk> & {
        controller?: AbortController;
      };
      let lastActivity = Date.now();
      const watchdog = setInterval(() => {
        if (Date.now() - lastActivity > idleTimeoutMs) {
          idleAborted = true;
          stream.controller?.abort();
        }
      }, 5000);
      try {
        for await (const chunk of stream) {
          if (signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
          lastActivity = Date.now();
          const choice = chunk.choices?.[0];
          const delta = choice?.delta;
          if (delta) {
            if (onDelta) {
              const toolCalls = (delta as unknown as { tool_calls?: Array<{ index?: number; function?: { name?: string | null; arguments?: string | null } | null }> }).tool_calls;
              if (Array.isArray(toolCalls)) {
                let fcFragment: { name?: string; arguments?: string } | null = null;
                for (const tc of toolCalls) {
                  const fn = tc.function;
                  if (!fn) continue;
                  const idx = tc.index ?? 0;
                  let acc = streamFcFragments.get(idx);
                  if (!acc) {
                    acc = { name: "", arguments: "" };
                    streamFcFragments.set(idx, acc);
                  }
                  if (fn.name) {
                    acc.name += fn.name;
                    fcFragment = fcFragment ?? {};
                    fcFragment.name = (fcFragment.name ?? "") + fn.name;
                  }
                  if (fn.arguments) {
                    acc.arguments += fn.arguments;
                    fcFragment = fcFragment ?? {};
                    fcFragment.arguments = (fcFragment.arguments ?? "") + fn.arguments;
                  }
                }
                if (fcFragment && !(delta as unknown as { function_call?: unknown }).function_call) {
                  (delta as unknown as { function_call?: unknown }).function_call = fcFragment;
                }
              }
              onDelta(delta as never);
            }
            if (delta.content) {
              accumulated += delta.content;
              yield delta.content;
            }
          }
          if (choice?.finish_reason) finishReason = choice.finish_reason;
          if (chunk.usage) {
            prompt = chunk.usage.prompt_tokens ?? 0;
            completion = chunk.usage.completion_tokens ?? 0;
          }
        }
      } finally {
        clearInterval(watchdog);
      }
      if (interaction) {
        interaction.response_content = accumulated;
        interaction.finish_reason = finishReason;
        interaction.prompt_tokens = prompt;
        interaction.completion_tokens = completion;
        interaction.total_tokens = prompt + completion;
        interaction.elapsed_ms = Date.now() - start;
        this._interaction_logger?.commit(interaction);
      }
    } catch (exc) {
      if (interaction) {
        interaction.error = idleAborted
          ? `流式响应空闲超时（${idleTimeoutMs / 1000}s 无数据），已中止`
          : exc instanceof Error
            ? exc.message
            : String(exc);
        interaction.elapsed_ms = Date.now() - start;
        this._interaction_logger?.commit(interaction);
      }
      if (idleAborted) throw new LLMTimeoutError(`流式响应空闲超时（${idleTimeoutMs / 1000}s 无数据），已中止`);
      throw this._wrapException(exc);
    }
  }

  // ------------------------------------------------------------------
  // Token 计数
  // ------------------------------------------------------------------

  count_tokens(messages: Array<ChatMessage | Record<string, unknown>>): number {
    let total = 0;
    for (const m of this._normalizeMessages(messages)) {
      total += this.count_text_tokens(m.content);
      if (m.function_call) {
        total += this.count_text_tokens(JSON.stringify(m.function_call));
      }
    }
    return total;
  }

  count_text_tokens(text: string): number {
    if (!text) return 0;
    try {
      return this._encoding.encode(text).length;
    } catch {
      return Math.ceil(text.length / 2);
    }
  }

  // ------------------------------------------------------------------
  // 内部
  // ------------------------------------------------------------------

  private _buildRequest(
    messages: Array<ChatMessage | Record<string, unknown>>,
    kwargs: Record<string, unknown>
  ): ChatRequest {
    const normalized = this._normalizeMessages(messages);
    return new ChatRequest({
      messages: normalized,
      temperature: (kwargs.temperature as number | undefined) ?? this.config.temperature,
      max_tokens: (kwargs.max_tokens as number | null | undefined) ?? this.config.maxTokens,
      top_p: (kwargs.top_p as number | undefined) ?? 1.0,
      frequency_penalty: (kwargs.frequency_penalty as number | undefined) ?? 0.0,
      presence_penalty: (kwargs.presence_penalty as number | undefined) ?? 0.0,
      stop: (kwargs.stop as string[] | string | null | undefined) ?? null,
      seed: (kwargs.seed as number | null | undefined) ?? null,
      functions: (kwargs.functions as Array<Record<string, unknown>> | null | undefined) ?? null,
      function_call: (kwargs.function_call as string | Record<string, unknown> | null | undefined) ?? null,
      response_format: (kwargs.response_format as Record<string, unknown> | null | undefined) ?? null,
    });
  }

  private _normalizeMessages(messages: Array<ChatMessage | Record<string, unknown>>): ChatMessage[] {
    return messages.map((m) => {
      if (m instanceof ChatMessage) return m;
      const d = m as Record<string, unknown>;
      return new ChatMessage(
        d.role as string,
        String(d.content ?? ""),
        (d.function_call as Record<string, unknown> | null) ?? null,
        (d.name as string | null) ?? null
      );
    });
  }

  private _parseResponse(completion: unknown): ChatResponse {
    try {
      const c = completion as OpenAI.Chat.Completions.ChatCompletion;
      const choice = c.choices[0];
      const msg = choice?.message;
      // 新版 tools 协议返回 tool_calls，兼容内部旧 function_call 读取：
      // 把第一条工具调用映射为 message.function_call（chat_session / react 均依赖该字段）
      if (msg && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
        const first = msg.tool_calls[0] as unknown as { function?: { name: string; arguments: string } };
        if (first && first.function) {
          (msg as unknown as { function_call?: unknown }).function_call = {
            name: first.function.name,
            arguments: first.function.arguments,
          };
        }
      }
      const content = msg?.content ?? "";
      const usage = c.usage;
      const tokenUsage = usage
        ? new TokenUsage(usage.prompt_tokens ?? 0, usage.completion_tokens ?? 0, usage.total_tokens ?? 0)
        : new TokenUsage();
      return new ChatResponse({
        content,
        model: c.model,
        usage: tokenUsage,
        finish_reason: choice?.finish_reason ?? "stop",
        raw: c as unknown as Record<string, unknown>,
      });
    } catch (exc) {
      throw new LLMResponseError(`响应解析失败: ${exc instanceof Error ? exc.message : String(exc)}`);
    }
  }

  private _wrapException(exc: unknown): Error {
    const e = exc as { name?: string; status?: number; status_code?: number; message?: string };
    if (e?.name === "AuthenticationError" || e?.status === 401 || e?.status_code === 401) return new LLMAuthError();
    if (e?.name === "RateLimitError" || e?.status === 429 || e?.status_code === 429) return new LLMRateLimitError();
    if (e?.name === "APITimeoutError" || e?.name === "Timeout") return new LLMTimeoutError(`请求超时: ${e.message ?? exc}`);
    if (e?.name === "APIConnectionError" || e?.name === "APIError") {
      return new LLMRequestError(`请求失败: ${e.message ?? exc}`, e?.status ?? null);
    }
    const status = e?.status ?? e?.status_code ?? null;
    return new LLMRequestError(`未知错误: ${e?.message ?? exc}`, status);
  }

  private _withRetry(fn: () => ChatResponse): ChatResponse {
    let attempt = 0;
    const max = Math.max(this.config.maxRetries, 1);
    // 同步场景直接执行（重试以异步为主；避免阻塞事件循环）
    try {
      return fn();
    } catch (exc) {
      if (exc instanceof LLMRequestError && attempt < max) {
        attempt += 1;
        return fn();
      }
      throw exc;
    }
  }

  private async _withRetryAsync(fn: () => Promise<ChatResponse>): Promise<ChatResponse> {
    const max = Math.max(this.config.maxRetries, 1);
    let lastErr: unknown;
    for (let attempt = 0; attempt < max; attempt++) {
      try {
        return await fn();
      } catch (exc) {
        lastErr = exc;
        if (!(exc instanceof LLMRequestError) && !(exc instanceof LLMTimeoutError)) throw exc;
        if (attempt + 1 < max) {
          const waitMs = Math.min(2000 * Math.pow(2, attempt), 30000);
          await sleep(waitMs);
        }
      }
    }
    throw lastErr;
  }

  get_last_interaction(): LLMInteraction | null {
    if (this._interaction_logger) return this._interaction_logger.get_last();
    return null;
  }

  close(): void {
    const c = this._sync_client as unknown as { close?: () => void };
    if (typeof c.close === "function") {
      try {
        c.close();
      } catch {
        /* 忽略关闭错误 */
      }
    }
  }

  toString(): string {
    return `LLMClient(model=${this.config.model}, base_url=${this.config.baseUrl})`;
  }
}


