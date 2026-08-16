/** LLM 模块异常定义（TS 版，迁移自 llm/exceptions.py）。 */

export class LLMError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LLMError";
  }
}

export class LLMConfigError extends LLMError {
  constructor(message: string) {
    super(message);
    this.name = "LLMConfigError";
  }
}

export class LLMRequestError extends LLMError {
  status_code: number | null;
  constructor(message: string, status_code: number | null = null) {
    super(message);
    this.name = "LLMRequestError";
    this.status_code = status_code;
  }
}

export class LLMRateLimitError extends LLMRequestError {
  constructor(message = "请求频率超限") {
    super(message, 429);
    this.name = "LLMRateLimitError";
  }
}

export class LLMAuthError extends LLMRequestError {
  constructor(message = "API Key 无效或已过期") {
    super(message, 401);
    this.name = "LLMAuthError";
  }
}

export class LLMTimeoutError extends LLMError {
  constructor(message: string) {
    super(message);
    this.name = "LLMTimeoutError";
  }
}

export class LLMResponseError extends LLMError {
  constructor(message: string) {
    super(message);
    this.name = "LLMResponseError";
  }
}
