"""全局配置管理，从环境变量加载。

支持通过 .env 文件或环境变量配置多个 LLM 模型实例，
按任务类型（正文生成 / 结构生成 / 校验审稿）分配不同模型。
"""

from __future__ import annotations

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

from ai_novel_workstation.config.paths import get_env_file_path

# 用户配置目录下的 .env（打包后同样正确，且与程序文件隔离）
_PROJECT_ENV_PATH = get_env_file_path()


class LLMModelConfig(BaseSettings):
    """单个 LLM 模型配置，兼容所有 OpenAI 协议 API。"""

    api_key: str = Field(description="API Key")
    base_url: str = Field(default="https://api.openai.com/v1", description="API 基础地址")
    model: str = Field(default="gpt-4o", description="模型名称")
    temperature: float = Field(default=0.7, ge=0.0, le=2.0)
    max_tokens: int | None = Field(default=None, description="单次生成最大 token 数")
    timeout: float = Field(default=120.0, gt=0, description="请求超时（秒）")
    max_retries: int = Field(default=3, ge=0, le=10, description="失败重试次数")


class Settings(BaseSettings):
    """全局配置，从环境变量 / .env 文件加载。"""

    model_config = SettingsConfigDict(
        env_file=str(_PROJECT_ENV_PATH),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # --- 正文生成模型（大模型，创意与文笔要求高） ---
    llm_text_api_key: str = ""
    llm_text_base_url: str = "https://api.openai.com/v1"
    llm_text_model: str = "gpt-4o"
    llm_text_temperature: float = 0.8
    llm_text_max_tokens: int | None = None

    # --- 结构生成模型（大纲/设定，中模型） ---
    llm_structure_api_key: str = ""
    llm_structure_base_url: str = "https://api.openai.com/v1"
    llm_structure_model: str = "gpt-4o-mini"
    llm_structure_temperature: float = 0.6
    llm_structure_max_tokens: int | None = None

    # --- 校验/审稿模型（小模型，降本） ---
    llm_check_api_key: str = ""
    llm_check_base_url: str = "https://api.openai.com/v1"
    llm_check_model: str = "gpt-4o-mini"
    llm_check_temperature: float = 0.3
    llm_check_max_tokens: int | None = None

    # --- 通用 ---
    log_level: str = "INFO"
    default_timeout: float = 120.0
    default_max_retries: int = 3

    def get_model_config(self, task: str) -> LLMModelConfig:
        """按任务类型获取对应的模型配置。

        Args:
            task: 任务类型，可选 "text"（正文）/ "structure"（结构）/ "check"（校验）

        Returns:
            LLMModelConfig 实例
        """
        prefix = f"llm_{task}"
        return LLMModelConfig(
            api_key=getattr(self, f"{prefix}_api_key"),
            base_url=getattr(self, f"{prefix}_base_url"),
            model=getattr(self, f"{prefix}_model"),
            temperature=getattr(self, f"{prefix}_temperature"),
            max_tokens=getattr(self, f"{prefix}_max_tokens"),
            timeout=self.default_timeout,
            max_retries=self.default_max_retries,
        )

    def get_all_configs(self) -> dict[str, LLMModelConfig]:
        """获取全部任务类型的模型配置。"""
        return {
            "text": self.get_model_config("text"),
            "structure": self.get_model_config("structure"),
            "check": self.get_model_config("check"),
        }


def get_settings() -> Settings:
    """获取全局配置单例。"""
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings


_settings: Settings | None = None
