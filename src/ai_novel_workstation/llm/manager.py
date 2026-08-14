"""多模型管理器，按任务类型路由到不同 LLM Client。

对应技术架构文档 3.3.1 多模型协作策略：
- text（正文生成）→ 大模型，创意与文笔要求高
- structure（大纲/设定）→ 中模型，结构化思考
- check（校验/审稿）→ 小模型，降本
"""

from __future__ import annotations

from loguru import logger

from ai_novel_workstation.config.settings import LLMModelConfig, get_settings
from ai_novel_workstation.llm.client import LLMClient
from ai_novel_workstation.llm.exceptions import LLMConfigError

# 任务类型别名
TaskType = str

# 预定义任务类型
TEXT = "text"           # 正文生成
STRUCTURE = "structure" # 大纲/设定生成
CHECK = "check"         # 校验/审稿/摘要


class LLMClientManager:
    """多模型管理器，统一管理多个 LLM Client。

    按任务类型路由到不同模型，支持：
    - 从全局配置自动初始化
    - 手动注册自定义模型配置
    - 运行时切换模型
    - 降级策略（大模型不可用时降级到小模型）

    Usage:
        # 从全局配置初始化
        manager = LLMClientManager.from_settings()

        # 按任务类型获取 client
        text_client = manager.get_client("text")        # 正文生成用大模型
        check_client = manager.get_client("check")      # 校验用小模型

        # 调用
        response = text_client.chat([ChatMessage(role="user", content="...")])

        # 手动注册
        manager.register("custom", LLMModelConfig(
            api_key="sk-xxx",
            base_url="https://api.deepseek.com/v1",
            model="deepseek-chat",
        ))
    """

    def __init__(self) -> None:
        self._clients: dict[TaskType, LLMClient] = {}
        self._configs: dict[TaskType, LLMModelConfig] = {}
        # 降级链：任务不可用时按顺序尝试
        self._fallback_chain: dict[TaskType, list[TaskType]] = {
            TEXT: [STRUCTURE, CHECK],
            STRUCTURE: [TEXT, CHECK],
            CHECK: [STRUCTURE, TEXT],
        }

    @classmethod
    def from_settings(cls) -> LLMClientManager:
        """从全局配置自动初始化所有任务类型的 client。"""
        settings = get_settings()
        manager = cls()

        for task, config in settings.get_all_configs().items():
            if config.api_key:
                manager.register(task, config)
                logger.info(f"已注册 LLM client: task={task}, model={config.model}")
            else:
                logger.warning(f"跳过未配置的 LLM: task={task}（api_key 为空）")

        return manager

    def register(self, task: TaskType, config: LLMModelConfig) -> None:
        """注册一个任务类型的模型配置。

        Args:
            task: 任务类型（如 "text", "structure", "check"）
            config: 模型配置
        """
        client = LLMClient(config)
        self._clients[task] = client
        self._configs[task] = config
        logger.debug(f"注册 LLM client: task={task}, model={config.model}")

    def get_client(self, task: TaskType) -> LLMClient:
        """获取指定任务类型的 client。

        如果该任务类型不可用，按降级链尝试其他任务类型的 client。

        Args:
            task: 任务类型

        Returns:
            LLMClient 实例

        Raises:
            LLMConfigError: 所有降级尝试均失败
        """
        # 直接命中
        if task in self._clients:
            return self._clients[task]

        # 降级尝试
        for fallback_task in self._fallback_chain.get(task, []):
            if fallback_task in self._clients:
                logger.warning(
                    f"任务 '{task}' 未配置，降级使用 '{fallback_task}' 的 client"
                )
                return self._clients[fallback_task]

        # 取任意可用的
        if self._clients:
            any_task = next(iter(self._clients))
            logger.warning(f"任务 '{task}' 未配置且无降级链，使用任意可用 client '{any_task}'")
            return self._clients[any_task]

        raise LLMConfigError(
            f"没有可用的 LLM client（任务 '{task}' 未配置，降级链也全部不可用）"
        )

    def set_fallback_chain(self, task: TaskType, chain: list[TaskType]) -> None:
        """自定义降级链。

        Args:
            task: 任务类型
            chain: 降级任务类型列表（按优先级排序）
        """
        self._fallback_chain[task] = chain

    @property
    def available_tasks(self) -> list[TaskType]:
        """当前已注册的任务类型列表。"""
        return list(self._clients.keys())

    def close_all(self) -> None:
        """关闭所有 client，释放连接。"""
        for task, client in self._clients.items():
            try:
                client.close()
            except Exception as exc:
                logger.error(f"关闭 client '{task}' 失败: {exc}")
        self._clients.clear()
        self._configs.clear()

    async def aclose_all(self) -> None:
        """异步关闭所有 client。"""
        for task, client in self._clients.items():
            try:
                await client.aclose()
            except Exception as exc:
                logger.error(f"异步关闭 client '{task}' 失败: {exc}")
        self._clients.clear()
        self._configs.clear()

    def __repr__(self) -> str:
        tasks = ", ".join(
            f"{t}={self._configs[t].model}" for t in self._clients
        )
        return f"LLMClientManager({tasks})"
