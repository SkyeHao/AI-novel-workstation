"""LLM 模块异常定义。"""

from __future__ import annotations


class LLMError(Exception):
    """LLM 模块基础异常。"""


class LLMConfigError(LLMError):
    """配置错误（如 api_key 为空、base_url 无效）。"""


class LLMRequestError(LLMError):
    """请求错误（网络异常、HTTP 非 2xx）。"""

    def __init__(self, message: str, status_code: int | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code


class LLMRateLimitError(LLMRequestError):
    """速率限制（HTTP 429）。"""

    def __init__(self, message: str = "请求频率超限") -> None:
        super().__init__(message, status_code=429)


class LLMAuthError(LLMRequestError):
    """认证失败（HTTP 401）。"""

    def __init__(self, message: str = "API Key 无效或已过期") -> None:
        super().__init__(message, status_code=401)


class LLMTimeoutError(LLMError):
    """请求超时。"""


class LLMResponseError(LLMError):
    """响应解析错误（返回格式异常）。"""
