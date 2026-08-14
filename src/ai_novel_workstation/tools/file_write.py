"""文件写入工具。"""

from __future__ import annotations

from typing import Any

from ai_novel_workstation.tools.base import BaseTool, ToolParameter, ToolResult


class FileWriteTool(BaseTool):
    """写入文件内容。"""

    @property
    def name(self) -> str:
        return "file_write"

    @property
    def description(self) -> str:
        return "将内容写入指定文件。如果文件所在目录不存在会自动创建。"

    @property
    def parameters(self) -> list[ToolParameter]:
        return [
            ToolParameter(
                name="path",
                type="string",
                description="文件路径（相对路径相对于项目默认目录，或绝对路径）",
            ),
            ToolParameter(
                name="content",
                type="string",
                description="要写入的文件内容",
            ),
            ToolParameter(
                name="mode",
                type="string",
                description="写入模式: write（覆盖写入）或 append（追加）",
                required=False,
                default="write",
            ),
            ToolParameter(
                name="encoding",
                type="string",
                description="文件编码",
                required=False,
                default="utf-8",
            ),
        ]

    async def execute(
        self,
        path: str,
        content: str,
        mode: str = "write",
        encoding: str = "utf-8",
        **kwargs: Any,
    ) -> ToolResult:
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

        # 自动创建目录
        file_path.parent.mkdir(parents=True, exist_ok=True)

        try:
            if mode == "append":
                with open(file_path, "a", encoding=encoding) as f:
                    f.write(content)
            else:
                file_path.write_text(content, encoding=encoding)

            return ToolResult(
                success=True,
                output=f"文件已写入: {file_path}（{len(content)} 字符，模式: {mode}）",
            )
        except Exception as e:
            return ToolResult(success=False, output="", error=str(e))
