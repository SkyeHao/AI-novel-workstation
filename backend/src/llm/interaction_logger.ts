/** LLM 交互记录器（TS 版，迁移自 llm/interaction_logger.py）。 */
import { ChatMessage } from "./models.js";

export interface LLMInteraction {
  messages: Array<Record<string, unknown>>;
  model: string;
  temperature: number;
  max_tokens: number | null;
  functions: Array<Record<string, unknown>> | null;
  function_call: string | Record<string, unknown> | null;
  response_content: string;
  response_function_call: Record<string, unknown> | null;
  finish_reason: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  tool_name: string;
  tool_args: Record<string, unknown>;
  tool_result: string;
  tool_success: boolean;
  elapsed_ms: number;
  error: string;
  timestamp: string;
}

function nowSeconds(): string {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

export class InteractionLogger {
  private _interactions: LLMInteraction[] = [];

  record(
    messages: Array<ChatMessage | Record<string, unknown>>,
    model: string,
    temperature = 0.7,
    max_tokens: number | null = null,
    functions: Array<Record<string, unknown>> | null = null,
    function_call: string | Record<string, unknown> | null = null
  ): LLMInteraction {
    const serialized: Array<Record<string, unknown>> = messages.map((m) =>
      m instanceof ChatMessage ? m.toDict() : (m as Record<string, unknown>)
    );
    const interaction: LLMInteraction = {
      messages: serialized,
      model,
      temperature,
      max_tokens,
      functions,
      function_call,
      response_content: "",
      response_function_call: null,
      finish_reason: "",
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
      tool_name: "",
      tool_args: {},
      tool_result: "",
      tool_success: true,
      elapsed_ms: 0,
      error: "",
      timestamp: nowSeconds(),
    };
    this._interactions.push(interaction);
    return interaction;
  }

  get_all(): LLMInteraction[] {
    return [...this._interactions];
  }

  get_last(): LLMInteraction | null {
    if (this._interactions.length > 0) return this._interactions[this._interactions.length - 1];
    return null;
  }

  clear(): void {
    this._interactions.length = 0;
  }
}
