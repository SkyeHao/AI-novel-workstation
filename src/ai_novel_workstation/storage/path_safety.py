"""路径安全模块。

所有文件操作必须经过本模块的沙箱校验：
- 相对路径基于沙箱根解析
- 绝对路径必须位于沙箱根内
- 路径规范化（resolve）后再次校验，防止 `..` 逃逸
"""

from __future__ import annotations

from pathlib import Path


class PathSafetyError(ValueError):
    """路径越界或非法。"""


def safe_resolve(base_dir: Path, path: str) -> Path:
    """在沙箱根内安全解析路径。

    Args:
        base_dir: 沙箱根目录（绝对路径）
        path: 目标路径（相对路径基于 base_dir 解析；绝对路径必须位于 base_dir 内）

    Returns:
        解析后的绝对 Path

    Raises:
        PathSafetyError: 路径越界
    """
    if path is None or not str(path).strip():
        raise PathSafetyError("路径不能为空")

    base = base_dir.expanduser().resolve()
    p = Path(str(path)).expanduser()

    if p.is_absolute():
        resolved = p.resolve()
    else:
        resolved = (base / p).resolve()

    try:
        resolved.relative_to(base)
    except ValueError:
        raise PathSafetyError(
            f"路径越界: {resolved} 不在沙箱根 {base} 内"
        )

    return resolved
