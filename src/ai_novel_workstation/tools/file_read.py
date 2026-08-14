"""文件读取工具。"""

from __future__ import annotations

from typing import Any

from ai_novel_workstation.tools.base import BaseTool, ToolParameter, ToolResult


class FileReadTool(BaseTool):
    """读取文件内容。"""

    @property
    def name(self) -> str:
        return "file_read"

    @property
    def description(self) -> str:
        return "读取指定路径的文件内容。支持文本文件（.txt/.md/.json/.yaml/.py 等）。"

    @property
    def parameters(self) -> list[ToolParameter]:
        return [
            ToolParameter(
                name="path",
                type="string",
                description="文件路径（相对路径相对于项目默认目录，或绝对路径）",
            ),
            ToolParameter(
                name="encoding",
                type="string",
                description="文件编码",
                required=False,
                default="utf-8",
            ),
        ]

    async def execute(self, path: str, encoding: str = "utf-8", **kwargs: Any) -> ToolResult:
        from ai_novel_workstation.api.state import resolve_project_path
        from ai_novel_workstation.storage.path_safety import safe_resolve

        base_dir = kwargs.pop("base_dir", None) or getattr(self, "base_dir", None)
        try:
            if base_dir is not None:
                from pathlib import Path

                file_path = safe_resolve(Path(base_dir), path)
            else:
                file_path = resolve_project_path(path)
        except ValueError as e:
            return ToolResult(success=False, output="", error=str(e))

        if not file_path.exists():
            return ToolResult(
                success=False,
                output="",
                error=f"文件不存在: {file_path}",
            )

        if not file_path.is_file():
            return ToolResult(
                success=False,
                output="",
                error=f"路径不是文件: {file_path}",
            )

        # 限制文件大小（10MB）
        size = file_path.stat().st_size
        if size > 10 * 1024 * 1024:
            return ToolResult(
                success=False,
                output="",
                error=f"文件过大（{size / 1024 / 1024:.1f}MB），限制 10MB",
            )

        try:
            content = file_path.read_text(encoding=encoding)
            return ToolResult(
                success=True,
                output=content if content else "（文件为空）",
            )
        except UnicodeDecodeError:
            return ToolResult(
                success=False,
                output="",
                error=f"编码错误，尝试用 {encoding} 解码失败",
            )
        except Exception as e:
            return ToolResult(success=False, output="", error=str(e))
