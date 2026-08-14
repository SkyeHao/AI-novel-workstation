"""API 全局状态管理。

维护模型池（多个 LLM 模型配置）和任务分配（任务类型 → 模型）。
支持运行时增删改查模型、测试连接、分配任务。
配置自动持久化到 .env 文件。
"""

from __future__ import annotations

import json
import os
import time
import uuid
from datetime import datetime
from pathlib import Path

from loguru import logger
from ai_novel_workstation.config.paths import (
    get_env_file_path,
    get_project_root,
    migrate_env_if_needed,
)
from ai_novel_workstation.config.settings import LLMModelConfig, get_settings
from ai_novel_workstation.llm.client import LLMClient
from ai_novel_workstation.llm.exceptions import LLMError
from ai_novel_workstation.llm.models import ChatMessage, Role


# .env 文件路径（用户配置目录 %APPDATA%/AI-Novel-Workstation，首次运行从程序根迁移）
_ENV_PATH = migrate_env_if_needed()


class ModelEntry:
    """模型条目（内部数据结构）。"""

    def __init__(
        self,
        id: str,
        name: str,
        provider_id: str,
        api_key: str,
        base_url: str,
        model: str,
        temperature: float = 0.7,
        max_tokens: int | None = None,
        timeout: float = 120.0,
        max_retries: int = 3,
        status: str = "untested",
        last_tested: str | None = None,
    ) -> None:
        self.id = id
        self.name = name
        self.provider_id = provider_id
        self.api_key = api_key
        self.base_url = base_url
        self.model = model
        self.temperature = temperature
        self.max_tokens = max_tokens
        self.timeout = timeout
        self.max_retries = max_retries
        self.status = status
        self.last_tested = last_tested

    def to_config(self) -> LLMModelConfig:
        """转换为 LLMModelConfig。"""
        return LLMModelConfig(
            api_key=self.api_key,
            base_url=self.base_url,
            model=self.model,
            temperature=self.temperature,
            max_tokens=self.max_tokens,
            timeout=self.timeout,
            max_retries=self.max_retries,
        )

    def to_dict(self, mask_key: bool = True) -> dict:
        """转为字典（用于 API 输出）。"""
        key = self.api_key
        if mask_key and key:
            if len(key) <= 12:
                key = "***"
            else:
                key = f"{key[:4]}...{key[-4:]}"
        return {
            "id": self.id,
            "name": self.name,
            "provider_id": self.provider_id,
            "api_key": key or "",
            "base_url": self.base_url,
            "model": self.model,
            "temperature": self.temperature,
            "max_tokens": self.max_tokens,
            "timeout": self.timeout,
            "max_retries": self.max_retries,
            "status": self.status,
            "last_tested": self.last_tested,
        }

    def to_storage_dict(self) -> dict:
        """转为字典（用于持久化存储，api_key 明文）。"""
        return {
            "id": self.id,
            "name": self.name,
            "provider_id": self.provider_id,
            "api_key": self.api_key,
            "base_url": self.base_url,
            "model": self.model,
            "temperature": self.temperature,
            "max_tokens": self.max_tokens,
            "timeout": self.timeout,
            "max_retries": self.max_retries,
            "status": self.status,
            "last_tested": self.last_tested,
        }


# 任务类型 → 中文标签
TASK_LABELS = {
    "text": "文本生成",
    "structure": "结构化输出",
    "check": "检查校验",
}

# 全局状态
_models: dict[str, ModelEntry] = {}
_assignments: dict[str, str | None] = {}  # task → model_id
_project_dir: str = ""  # 项目默认目录（空 = 使用系统默认，见 get_project_dir_path）
_initialized = False


def _default_project_dir() -> str:
    """系统默认作品库目录：%USERPROFILE%\\Documents\\AI-Novels。"""
    return str(Path.home() / "Documents" / "AI-Novels")


# ── .env 持久化 ──────────────────────────────────────────────────

def _save_to_env() -> None:
    """将模型池和任务分配保存到 .env 文件。"""
    # 序列化模型池
    models_list = [m.to_storage_dict() for m in _models.values()]
    models_json = json.dumps(models_list, ensure_ascii=False)

    # 序列化任务分配
    assignments_json = json.dumps(_assignments, ensure_ascii=False)

    # 读取现有 .env 内容
    lines: list[str] = []
    if _ENV_PATH.exists():
        lines = _ENV_PATH.read_text(encoding="utf-8").splitlines()

    # 更新或添加 MODEL_POOL、MODEL_ASSIGNMENTS、PROJECT_DIR
    found_pool = False
    found_assign = False
    found_dir = False
    new_lines: list[str] = []

    for line in lines:
        stripped = line.strip()
        if stripped.startswith("MODEL_POOL="):
            new_lines.append(f"MODEL_POOL={models_json}")
            found_pool = True
        elif stripped.startswith("MODEL_ASSIGNMENTS="):
            new_lines.append(f"MODEL_ASSIGNMENTS={assignments_json}")
            found_assign = True
        elif stripped.startswith("PROJECT_DIR="):
            new_lines.append(f"PROJECT_DIR={_project_dir}")
            found_dir = True
        else:
            new_lines.append(line)

    # 追加缺失的变量
    if not found_pool:
        if new_lines and new_lines[-1].strip():
            new_lines.append("")
        new_lines.append("# --- 模型池配置（自动生成，请勿手动编辑） ---")
        new_lines.append(f"MODEL_POOL={models_json}")
    if not found_assign:
        new_lines.append(f"MODEL_ASSIGNMENTS={assignments_json}")
    if not found_dir:
        new_lines.append(f"PROJECT_DIR={_project_dir}")

    # 写回 .env
    _ENV_PATH.write_text("\n".join(new_lines) + "\n", encoding="utf-8")
    logger.debug(f"配置已保存到 .env（{len(models_list)} 个模型）")


def _load_from_env() -> bool:
    """从 .env 文件加载模型池和任务分配。

    Returns:
        True 如果成功加载了模型池配置
    """
    if not _ENV_PATH.exists():
        return False

    content = _ENV_PATH.read_text(encoding="utf-8")
    models_json = None
    assignments_json = None
    project_dir_value = None

    for line in content.splitlines():
        stripped = line.strip()
        if stripped.startswith("MODEL_POOL="):
            models_json = stripped[len("MODEL_POOL="):]
        elif stripped.startswith("MODEL_ASSIGNMENTS="):
            assignments_json = stripped[len("MODEL_ASSIGNMENTS="):]
        elif stripped.startswith("PROJECT_DIR="):
            project_dir_value = stripped[len("PROJECT_DIR="):]

    # 加载项目目录配置（独立于模型池，即使没有模型也加载）
    if project_dir_value is not None:
        global _project_dir
        _project_dir = project_dir_value.strip()
        logger.info(f"从 .env 加载项目目录: {_project_dir or '(系统默认)'}")

    if not models_json:
        return False

    try:
        # 加载模型池
        models_list = json.loads(models_json)
        for m in models_list:
            entry = ModelEntry(
                id=m["id"],
                name=m["name"],
                provider_id=m.get("provider_id", "custom"),
                api_key=m["api_key"],
                base_url=m["base_url"],
                model=m["model"],
                temperature=m.get("temperature", 0.7),
                max_tokens=m.get("max_tokens"),
                timeout=m.get("timeout", 120.0),
                max_retries=m.get("max_retries", 3),
                status=m.get("status", "untested"),
                last_tested=m.get("last_tested"),
            )
            _models[entry.id] = entry

        # 加载任务分配
        if assignments_json:
            loaded_assignments = json.loads(assignments_json)
            for task in TASK_LABELS:
                _assignments[task] = loaded_assignments.get(task)
        else:
            # 无分配数据，自动分配第一个模型
            if _models:
                first_id = next(iter(_models.keys()))
                for task in TASK_LABELS:
                    _assignments[task] = first_id

        logger.info(f"从 .env 加载 {len(_models)} 个模型配置")
        return True

    except (json.JSONDecodeError, KeyError) as e:
        logger.error(f"从 .env 加载模型配置失败: {e}")
        return False


def _init_from_settings() -> None:
    """初始化模型池（仅首次调用时执行）。

    优先从 .env 的 MODEL_POOL 加载，回退到旧的 LLM_TEXT/STRUCTURE/CHECK 配置。
    """
    global _initialized
    if _initialized:
        return
    _initialized = True

    # 优先从 .env 的 MODEL_POOL 加载
    if _load_from_env():
        return

    # 回退：从旧的 LLM_TEXT/STRUCTURE/CHECK 环境变量加载
    settings = get_settings()
    for task in ("text", "structure", "check"):
        cfg = settings.get_model_config(task)
        if cfg.api_key:
            entry = ModelEntry(
                id=str(uuid.uuid4()),
                name=f"{TASK_LABELS[task]}（.env 配置）",
                provider_id="custom",
                api_key=cfg.api_key,
                base_url=cfg.base_url,
                model=cfg.model,
                temperature=cfg.temperature,
                max_tokens=cfg.max_tokens,
                timeout=cfg.timeout,
                max_retries=cfg.max_retries,
            )
            _models[entry.id] = entry
            _assignments[task] = entry.id
            logger.info(f"从环境变量加载模型: task={task}, model={cfg.model}")

    # 如果加载了模型，保存到 .env
    if _models:
        _save_to_env()


# ── 模型池 CRUD ─────────────────────────────────────────────────

def get_all_models() -> list[ModelEntry]:
    """获取所有模型条目。"""
    _init_from_settings()
    return list(_models.values())


def get_model(model_id: str) -> ModelEntry | None:
    """获取指定模型条目。"""
    _init_from_settings()
    return _models.get(model_id)


def add_model(
    name: str,
    provider_id: str,
    api_key: str,
    base_url: str,
    model: str,
    temperature: float = 0.7,
    max_tokens: int | None = None,
    timeout: float = 120.0,
    max_retries: int = 3,
) -> ModelEntry:
    """添加模型条目。"""
    _init_from_settings()
    entry = ModelEntry(
        id=str(uuid.uuid4()),
        name=name,
        provider_id=provider_id,
        api_key=api_key,
        base_url=base_url,
        model=model,
        temperature=temperature,
        max_tokens=max_tokens,
        timeout=timeout,
        max_retries=max_retries,
    )
    _models[entry.id] = entry
    _save_to_env()
    logger.info(f"添加模型: name={name}, model={model}")
    return entry


def update_model(model_id: str, **kwargs) -> ModelEntry:
    """更新模型条目。"""
    _init_from_settings()
    entry = _models.get(model_id)
    if entry is None:
        raise KeyError(f"模型不存在: {model_id}")

    for key, value in kwargs.items():
        if value is not None and hasattr(entry, key):
            setattr(entry, key, value)

    _save_to_env()
    logger.info(f"更新模型: id={model_id}, name={entry.name}")
    return entry


def delete_model(model_id: str) -> None:
    """删除模型条目，同时清除引用它的任务分配。"""
    _init_from_settings()
    if model_id not in _models:
        raise KeyError(f"模型不存在: {model_id}")

    # 清除引用此模型的任务分配
    for task, mid in list(_assignments.items()):
        if mid == model_id:
            _assignments[task] = None

    del _models[model_id]
    _save_to_env()
    logger.info(f"删除模型: id={model_id}")


# ── 任务分配 ─────────────────────────────────────────────────────

def get_assignments() -> dict[str, str | None]:
    """获取任务分配（task → model_id）。"""
    _init_from_settings()
    return dict(_assignments)


def set_assignment(task: str, model_id: str | None) -> None:
    """设置任务分配。"""
    _init_from_settings()
    if task not in TASK_LABELS:
        raise ValueError(f"不支持的任务类型: {task}")
    if model_id is not None and model_id not in _models:
        raise KeyError(f"模型不存在: {model_id}")
    _assignments[task] = model_id
    _save_to_env()
    logger.info(f"任务分配: {task} → {model_id}")


# ── LLM Client ──────────────────────────────────────────────────

def get_client_for_task(task: str, interaction_logger=None) -> LLMClient:
    """获取任务对应的 LLM Client。

    如果任务未分配模型，尝试降级到任意可用模型。
    """
    _init_from_settings()

    model_id = _assignments.get(task)
    if model_id and model_id in _models:
        entry = _models[model_id]
        return LLMClient(entry.to_config(), interaction_logger=interaction_logger)

    # 降级：使用任意可用模型
    if _models:
        any_entry = next(iter(_models.values()))
        logger.warning(f"任务 '{task}' 未分配模型，降级使用 '{any_entry.name}'")
        return LLMClient(any_entry.to_config(), interaction_logger=interaction_logger)

    raise LLMError(
        f"没有可用的 LLM 模型（任务 '{task}' 未分配，模型池为空）"
    )


# ── 连接测试 ─────────────────────────────────────────────────────

async def test_model(model_id: str) -> tuple[bool, str, int]:
    """测试模型连接。

    Returns:
        (success, message, elapsed_ms)
    """
    _init_from_settings()
    entry = _models.get(model_id)
    if entry is None:
        raise KeyError(f"模型不存在: {model_id}")

    client = LLMClient(entry.to_config())
    start = time.perf_counter()

    try:
        response = await client.achat(
            [ChatMessage(role=Role.USER, content="请回复'连接成功'四个字。")],
            max_tokens=20,
        )
        elapsed_ms = int((time.perf_counter() - start) * 1000)

        entry.status = "ok"
        entry.last_tested = datetime.now().isoformat(timespec="seconds")
        return True, f"连接成功，模型回复: {response.content[:50]}", elapsed_ms

    except LLMError as e:
        elapsed_ms = int((time.perf_counter() - start) * 1000)
        entry.status = "failed"
        entry.last_tested = datetime.now().isoformat(timespec="seconds")
        return False, str(e), elapsed_ms
    except Exception as e:
        elapsed_ms = int((time.perf_counter() - start) * 1000)
        entry.status = "failed"
        entry.last_tested = datetime.now().isoformat(timespec="seconds")
        return False, f"未知错误: {e}", elapsed_ms
    finally:
        client.close()
        _save_to_env()


# ── 项目目录配置 ─────────────────────────────────────────────────

# 项目根目录（源码运行时 = 仓库根；打包后 = 解包目录）
_PROJECT_ROOT = get_project_root()


def get_project_dir() -> str:
    """获取项目默认目录配置（原始字符串，可能为相对或绝对路径）。"""
    _init_from_settings()
    return _project_dir or _default_project_dir()


def get_project_dir_path() -> Path:
    """获取项目默认目录的绝对路径。

    - 配置了目录：相对路径基于程序根目录解析
    - 未配置：系统默认 %USERPROFILE%\\Documents\\AI-Novels
    确保目录存在。
    """
    _init_from_settings()
    raw = _project_dir or _default_project_dir()
    p = Path(raw)
    if not p.is_absolute():
        p = _PROJECT_ROOT / p
    p = p.expanduser().resolve()
    p.mkdir(parents=True, exist_ok=True)
    return p


def set_project_dir(path: str) -> str:
    """设置项目默认目录并持久化。

    Args:
        path: 目录路径（相对或绝对）。留空则重置为系统默认。

    Returns:
        设置后的目录字符串
    """
    global _project_dir
    _init_from_settings()

    path = path.strip() if path else ""
    _project_dir = path

    # 确保目录存在
    get_project_dir_path()

    _save_to_env()
    logger.info(f"项目目录已设置: {_project_dir or '(系统默认)'}")
    return _project_dir or _default_project_dir()


def resolve_project_path(path: str) -> Path:
    """在作品库沙箱内解析路径。

    - 相对路径基于作品库根解析
    - 绝对路径必须位于作品库根内（防止 `..`/符号链接逃逸）

    Args:
        path: 文件或目录路径

    Returns:
        解析后的绝对 Path

    Raises:
        PathSafetyError: 路径越界
    """
    from ai_novel_workstation.storage.path_safety import safe_resolve

    return safe_resolve(get_project_dir_path(), path)


# ── 联网搜索配置 ──────────────────────────────────────────────────

_SEARCH_KEYS = ("TAVILY_API_KEY", "SERPER_API_KEY", "WEB_SEARCH_PROVIDERS")


def init_search_env() -> None:
    """启动时将 .env 中的搜索配置加载到进程环境变量。

    web_search 工具通过 os.getenv 读取搜索配置；而 .env 不会被自动
    加载到 os.environ，因此需要在启动时手动注入。
    """
    if not _ENV_PATH.exists():
        return
    content = _ENV_PATH.read_text(encoding="utf-8")
    for line in content.splitlines():
        stripped = line.strip()
        for key in _SEARCH_KEYS:
            if stripped.startswith(f"{key}="):
                os.environ[key] = stripped[len(key) + 1:]
                break


def _mask_api_key(key: str) -> str:
    """脱敏 API Key。"""
    if not key:
        return ""
    if len(key) <= 12:
        return "***"
    return f"{key[:4]}...{key[-4:]}"


def get_search_config() -> dict:
    """读取联网搜索配置（API Key 脱敏）。"""
    init_search_env()
    tavily = os.environ.get("TAVILY_API_KEY", "")
    serper = os.environ.get("SERPER_API_KEY", "")
    providers = os.environ.get("WEB_SEARCH_PROVIDERS", "")

    return {
        "tavily_api_key": _mask_api_key(tavily),
        "tavily_configured": bool(tavily),
        "serper_api_key": _mask_api_key(serper),
        "serper_configured": bool(serper),
        "providers": providers,
    }


def set_search_config(
    tavily_api_key: str = "",
    serper_api_key: str = "",
    providers: str = "",
) -> dict:
    """保存联网搜索配置到 .env 并同步到进程环境变量。

    Args:
        tavily_api_key: Tavily API Key（空字符串表示保持不变）
        serper_api_key: Serper API Key（空字符串表示保持不变）
        providers: 搜索源优先级（空字符串表示使用默认顺序）
    """
    init_search_env()

    updates: dict[str, str] = {}
    if tavily_api_key:
        updates["TAVILY_API_KEY"] = tavily_api_key.strip()
    if serper_api_key:
        updates["SERPER_API_KEY"] = serper_api_key.strip()
    if providers:
        # 校验只包含合法 provider 名称
        from ai_novel_workstation.tools.web_search import _SEARCH_PROVIDERS

        valid = [p.strip() for p in providers.split(",") if p.strip()]
        unknown = [p for p in valid if p not in _SEARCH_PROVIDERS]
        if unknown:
            raise ValueError(f"不支持的搜索源: {', '.join(unknown)}")
        updates["WEB_SEARCH_PROVIDERS"] = ",".join(valid)
    elif providers is not None and not providers:
        updates["WEB_SEARCH_PROVIDERS"] = ""

    # 写回 .env（保留其他配置）
    _update_env_vars(updates)

    # 同步进程环境变量
    for key, value in updates.items():
        os.environ[key] = value

    return get_search_config()


def _update_env_vars(updates: dict[str, str]) -> None:
    """更新 .env 中的指定键，保留其他内容。"""
    lines: list[str] = []
    if _ENV_PATH.exists():
        lines = _ENV_PATH.read_text(encoding="utf-8").splitlines()

    new_lines: list[str] = []
    found = {k: False for k in updates}
    for line in lines:
        stripped = line.strip()
        matched = False
        for key in updates:
            if stripped.startswith(f"{key}="):
                new_lines.append(f"{key}={updates[key]}")
                found[key] = True
                matched = True
                break
        if not matched:
            new_lines.append(line)

    for key, value in updates.items():
        if not found[key]:
            new_lines.append(f"{key}={value}")

    _ENV_PATH.write_text("\n".join(new_lines) + "\n", encoding="utf-8")
