"""阶段1：创意输入与项目初始化。

通过 ReAct Agent + 工具系统完成：
1. 分析作者创意输入
2. 联网搜索市场趋势
3. 生成《故事愿景文档》
4. 创建项目目录结构
"""

from __future__ import annotations

from pathlib import Path

from loguru import logger

from ai_novel_workstation.agent.react import AgentStep, ReActAgent
from ai_novel_workstation.llm.client import LLMClient
from ai_novel_workstation.llm.interaction_logger import InteractionLogger
from ai_novel_workstation.tools.file_read import FileReadTool
from ai_novel_workstation.tools.file_write import FileWriteTool
from ai_novel_workstation.tools.manager import ToolManager
from ai_novel_workstation.tools.web_search import WebSearchTool
from ai_novel_workstation.workflow.prompts import (
    REACT_SYSTEM_PROMPT,
    STAGE1_IDEATION_PROMPT,
    STAGE1_INIT_PROMPT,
)


class Stage1Result:
    """阶段1 执行结果。"""

    def __init__(
        self,
        success: bool,
        final_output: str = "",
        steps: list[AgentStep] | None = None,
        interactions: list[dict] | None = None,
        project_path: str = "",
        vision_doc_path: str = "",
        error: str = "",
    ) -> None:
        self.success = success
        self.final_output = final_output
        self.steps = steps or []
        self.interactions = interactions or []
        self.project_path = project_path
        self.vision_doc_path = vision_doc_path
        self.error = error

    def to_dict(self) -> dict:
        return {
            "success": self.success,
            "final_output": self.final_output,
            "steps": [s.to_display() for s in self.steps],
            "interactions": self.interactions,
            "project_path": self.project_path,
            "vision_doc_path": self.vision_doc_path,
            "error": self.error,
        }


class Stage1Ideation:
    """阶段1：创意输入与项目初始化。"""

    def __init__(self, client: LLMClient, max_iterations: int = 10) -> None:
        self.client = client
        self.max_iterations = max_iterations

    def _create_tool_manager(self, project_root: str) -> ToolManager:
        """创建工具管理器，注册基础工具。"""
        tm = ToolManager()
        tm.register(FileReadTool())
        tm.register(FileWriteTool())
        tm.register(WebSearchTool())
        return tm

    @staticmethod
    def _get_projects_base() -> Path:
        """获取项目存储根目录（来自全局配置）。"""
        from ai_novel_workstation.api.state import get_project_dir_path

        return get_project_dir_path()

    async def run(
        self,
        user_input: str,
        project_name: str = "",
        genre: str = "",
        platform: str = "",
        target_words: str = "",
    ) -> Stage1Result:
        """执行阶段1。

        Args:
            user_input: 作者的创意输入（灵感描述）
            project_name: 项目名称（可选，留空则自动生成）
            genre: 题材类型（可选）
            platform: 目标平台（可选）
            target_words: 目标字数（可选）

        Returns:
            Stage1Result 执行结果
        """
        logger.info(f"阶段1启动: project={project_name}, input={user_input[:50]}...")

        # 如果未提供项目名，从输入中提取
        if not project_name:
            project_name = self._extract_project_name(user_input)

        # 创建工具管理器
        tool_manager = self._create_tool_manager(".")

        # 构建系统提示词
        system_prompt = REACT_SYSTEM_PROMPT.format(
            tools=tool_manager.to_prompt()
        )

        # 构建用户提示词
        topic = genre or "网络小说"
        user_prompt = STAGE1_IDEATION_PROMPT.format(
            user_input=user_input,
            topic=topic,
            project_name=project_name,
        )

        # 如果有额外参数，追加到提示词
        extra_info = []
        if genre:
            extra_info.append(f"题材方向：{genre}")
        if platform:
            extra_info.append(f"目标平台：{platform}")
        if target_words:
            extra_info.append(f"目标字数：{target_words}")
        if extra_info:
            user_prompt += "\n\n## 补充信息\n" + "\n".join(extra_info)

        # 创建交互记录器
        interaction_logger = InteractionLogger()

        # 用带 logger 的 client 创建 Agent
        client_with_logger = LLMClient(
            self.client.config,
            interaction_logger=interaction_logger,
        )

        # 创建 ReAct Agent
        agent = ReActAgent(
            client=client_with_logger,
            tool_manager=tool_manager,
            system_prompt=system_prompt,
            max_iterations=self.max_iterations,
            temperature=0.8,
        )

        # 运行 Agent
        final_output, steps = await agent.run(user_prompt)

        # 检查结果
        project_path = self._get_projects_base() / project_name
        vision_doc_path = project_path / "故事愿景文档.md"

        success = vision_doc_path.exists()

        result = Stage1Result(
            success=success,
            final_output=final_output,
            steps=steps,
            interactions=interaction_logger.to_list(),
            project_path=str(project_path) if success else "",
            vision_doc_path=str(vision_doc_path) if success else "",
            error="" if success else "故事愿景文档未生成",
        )

        # 如果创意阶段成功，执行项目初始化
        if success:
            logger.info("故事愿景文档已生成，开始项目初始化")
            init_result = await self._init_project(
                project_name, genre, platform, target_words, tool_manager, client_with_logger
            )
            if init_result:
                logger.info("项目初始化完成")

        # 更新交互记录（包含初始化阶段）
        result.interactions = interaction_logger.to_list()

        logger.info(f"阶段1完成: success={success}")
        return result

    async def _init_project(
        self,
        project_name: str,
        genre: str,
        platform: str,
        target_words: str,
        tool_manager: ToolManager,
        client: LLMClient,
    ) -> bool:
        """执行项目初始化，创建配置文件。"""
        init_prompt = STAGE1_INIT_PROMPT.format(
            project_name=project_name,
            genre=genre or "未指定",
            platform=platform or "未指定",
            target_words=target_words or "200000",
        )

        # 构建系统提示词
        system_prompt = REACT_SYSTEM_PROMPT.format(
            tools=tool_manager.to_prompt()
        )

        agent = ReActAgent(
            client=client,
            tool_manager=tool_manager,
            system_prompt=system_prompt,
            max_iterations=5,
            temperature=0.5,
        )

        _, _ = await agent.run(init_prompt)

        # 检查配置文件是否创建
        config_path = self._get_projects_base() / project_name / "项目配置.json"
        return config_path.exists()

    @staticmethod
    def _extract_project_name(user_input: str) -> str:
        """从用户输入中提取项目名称。"""
        # 简单策略：取前 4-8 个字
        import re

        # 移除标点和空白
        cleaned = re.sub(r"[^\w\u4e00-\u9fff]", "", user_input)
        if len(cleaned) >= 4:
            return cleaned[:6]
        return cleaned or "new_project"
