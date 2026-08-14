"""应用路径与用户配置目录解析。

打包为 exe 后，`__file__` 指向临时解包目录（PyInstaller 单文件模式），
不能作为配置文件存放位置。所有用户配置统一放在系统用户配置目录
（Windows: %APPDATA% ；其他平台: ~/.config ），与程序文件隔离，升级不丢。
"""

from __future__ import annotations

import os
from pathlib import Path

from loguru import logger

# 应用名（用于用户配置目录名）
_APP_DIR_NAME = "AI-Novel-Workstation"

# 程序根目录（源码运行时 = 仓库根；打包后 = 解包临时目录，仅用于定位只读资源）
_PROJECT_ROOT = Path(__file__).resolve().parents[3]


def get_user_config_dir() -> Path:
    """返回用户配置根目录（存放 .env 与运行时数据）。

    可用环境变量 AI_NOVEL_CONFIG_DIR 覆盖（测试/便携模式用）。
    """
    override = os.environ.get("AI_NOVEL_CONFIG_DIR")
    if override:
        return Path(override).expanduser().resolve()

    if os.name == "nt":
        base = os.environ.get("APPDATA") or str(Path.home() / "AppData" / "Roaming")
    else:
        base = str(Path.home() / ".config")
    return Path(base) / _APP_DIR_NAME


def get_env_file_path() -> Path:
    """返回用户配置目录下的 .env 路径（确保目录存在）。"""
    d = get_user_config_dir()
    d.mkdir(parents=True, exist_ok=True)
    return d / ".env"


def get_legacy_env_path() -> Path:
    """旧版本的程序根 .env（用于首次运行迁移）。"""
    return _PROJECT_ROOT / ".env"


def get_project_root() -> Path:
    """程序根目录（只读资源定位用，非配置存放位置）。"""
    return _PROJECT_ROOT


def migrate_env_if_needed() -> Path:
    """首次运行迁移：若新位置无 .env 而旧位置（程序根）有，则复制。

    Returns:
        实际使用的 .env 路径
    """
    target = get_env_file_path()
    if target.exists():
        return target

    legacy = get_legacy_env_path()
    if legacy.exists():
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(legacy.read_bytes())
            logger.info(f"已迁移配置 .env → {target}")
        except Exception as e:
            logger.warning(f"迁移 .env 失败: {e}")
    return target
