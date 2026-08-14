"""配置管理路由。

提供模型池 CRUD、连接测试、任务分配、服务商列表接口。
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from ai_novel_workstation.api import state
from ai_novel_workstation.api.schemas import (
    ModelEntryCreate,
    ModelEntryOut,
    ModelEntryUpdate,
    ModelTestResult,
    ProjectDirOut,
    ProjectDirUpdate,
    ProviderInfo,
    ProviderModel,
    SearchConfigOut,
    SearchConfigUpdate,
    TaskAssignmentOut,
    TaskAssignmentUpdate,
)

router = APIRouter()

# ── 预置 LLM 服务商列表（2026-08-12 更新） ──────────────────────
_PROVIDERS: list[ProviderInfo] = [
    ProviderInfo(
        id="openai",
        name="OpenAI",
        base_url="https://api.openai.com/v1",
        website="https://platform.openai.com/api-keys",
        models=[
            ProviderModel(name="gpt-5.4-thinking", label="GPT-5.4 Thinking（旗舰推理，推荐正文生成）", recommended_for=["text"]),
            ProviderModel(name="gpt-5.3-instant", label="GPT-5.3 Instant（均衡，推荐结构化）", recommended_for=["structure"]),
            ProviderModel(name="gpt-5.4-mini", label="GPT-5.4 Mini（轻量，推荐校验）", recommended_for=["check"]),
            ProviderModel(name="gpt-4.1", label="GPT-4.1（旧版仍可用，1M上下文）", recommended_for=[]),
            ProviderModel(name="gpt-4.1-mini", label="GPT-4.1 Mini（旧版轻量）", recommended_for=[]),
        ],
    ),
    ProviderInfo(
        id="deepseek",
        name="DeepSeek 深度求索",
        base_url="https://api.deepseek.com/v1",
        website="https://platform.deepseek.com/api_keys",
        models=[
            ProviderModel(name="deepseek-v4-flash", label="DeepSeek V4 Flash（最新旗舰，推荐正文生成）", recommended_for=["text"]),
            ProviderModel(name="deepseek-v4-pro", label="DeepSeek V4 Pro（专业版，推荐复杂推理/校验）", recommended_for=["text", "check"]),
            ProviderModel(name="deepseek-chat", label="deepseek-chat（兼容旧名→V4 Flash 非思考模式）", recommended_for=[]),
            ProviderModel(name="deepseek-reasoner", label="deepseek-reasoner（兼容旧名→V4 Flash 思考模式）", recommended_for=[]),
        ],
    ),
    ProviderInfo(
        id="qwen",
        name="通义千问",
        base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
        website="https://dashscope.console.aliyun.com/apiKey",
        models=[
            ProviderModel(name="qwen3.8-max", label="Qwen3.8 Max（最新旗舰 2.4T MoE，推荐正文生成）", recommended_for=["text"]),
            ProviderModel(name="qwen3.7-plus", label="Qwen3.7 Plus（均衡型，推荐结构化）", recommended_for=["structure"]),
            ProviderModel(name="qwen3.7-flash", label="Qwen3.7 Flash（轻量极速，推荐校验）", recommended_for=["check"]),
            ProviderModel(name="qwen3-max", label="Qwen3 Max（上一代旗舰）", recommended_for=[]),
            ProviderModel(name="qwen-plus", label="qwen-plus（旧版均衡）", recommended_for=[]),
        ],
    ),
    ProviderInfo(
        id="moonshot",
        name="月之暗面 Moonshot",
        base_url="https://api.moonshot.cn/v1",
        website="https://platform.moonshot.cn/console/api-keys",
        models=[
            ProviderModel(name="kimi-k2.6", label="Kimi K2.6（最新旗舰 1T MoE，256K上下文，推荐正文生成）", recommended_for=["text"]),
            ProviderModel(name="kimi-k2-thinking", label="Kimi K2 Thinking（思考模型，推荐校验）", recommended_for=["check"]),
            ProviderModel(name="kimi-k2-turbo-preview", label="Kimi K2 Turbo（高速版 60-100 tok/s，推荐结构化）", recommended_for=["structure"]),
            ProviderModel(name="moonshot-v1-128k", label="Moonshot v1 128K（旧版长上下文）", recommended_for=[]),
        ],
    ),
    ProviderInfo(
        id="zhipu",
        name="智谱 AI",
        base_url="https://open.bigmodel.cn/api/paas/v4",
        website="https://open.bigmodel.cn/usercenter/apikeys",
        models=[
            ProviderModel(name="glm-5.2", label="GLM-5.2（最新旗舰 1M上下文 MIT开源，推荐正文生成）", recommended_for=["text"]),
            ProviderModel(name="glm-5.1", label="GLM-5.1（上一代旗舰，长程任务，推荐结构化）", recommended_for=["structure"]),
            ProviderModel(name="glm-4.7-flash", label="GLM-4.7 Flash（免费模型，推荐校验）", recommended_for=["check"]),
            ProviderModel(name="glm-5-turbo", label="GLM-5 Turbo（高速Agent专用）", recommended_for=[]),
        ],
    ),
    ProviderInfo(
        id="lingyiwanwu",
        name="零一万物",
        base_url="https://api.lingyiwanwu.com/v1",
        website="https://platform.lingyiwanwu.com/apikeys",
        models=[
            ProviderModel(name="yi-lightning", label="Yi-Lightning（旗舰，推荐正文生成）", recommended_for=["text"]),
            ProviderModel(name="yi-large", label="Yi-Large（大上下文，推荐结构化）", recommended_for=["structure"]),
        ],
    ),
    ProviderInfo(
        id="custom",
        name="自定义",
        base_url="",
        website="",
        models=[],
    ),
]


# ── 模型池 CRUD ─────────────────────────────────────────────────

@router.get("/models", response_model=list[ModelEntryOut])
async def list_models() -> list[ModelEntryOut]:
    """获取所有模型条目。"""
    models = state.get_all_models()
    return [ModelEntryOut(**m.to_dict()) for m in models]


@router.post("/models", response_model=ModelEntryOut)
async def create_model(body: ModelEntryCreate) -> ModelEntryOut:
    """添加模型条目。"""
    if not body.api_key:
        raise HTTPException(status_code=400, detail="api_key 不能为空")
    entry = state.add_model(
        name=body.name,
        provider_id=body.provider_id,
        api_key=body.api_key,
        base_url=body.base_url,
        model=body.model,
        temperature=body.temperature,
        max_tokens=body.max_tokens,
        timeout=body.timeout,
        max_retries=body.max_retries,
    )
    return ModelEntryOut(**entry.to_dict())


@router.put("/models/{model_id}", response_model=ModelEntryOut)
async def update_model(model_id: str, body: ModelEntryUpdate) -> ModelEntryOut:
    """更新模型条目。"""
    try:
        entry = state.update_model(
            model_id,
            name=body.name,
            provider_id=body.provider_id,
            api_key=body.api_key,
            base_url=body.base_url,
            model=body.model,
            temperature=body.temperature,
            max_tokens=body.max_tokens,
            timeout=body.timeout,
            max_retries=body.max_retries,
        )
    except KeyError:
        raise HTTPException(status_code=404, detail="模型不存在")
    return ModelEntryOut(**entry.to_dict())


@router.delete("/models/{model_id}")
async def delete_model(model_id: str) -> dict:
    """删除模型条目。"""
    try:
        state.delete_model(model_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="模型不存在")
    return {"status": "ok"}


# ── 连接测试 ─────────────────────────────────────────────────────

@router.post("/models/{model_id}/test", response_model=ModelTestResult)
async def test_model_connection(model_id: str) -> ModelTestResult:
    """测试模型连接。"""
    try:
        success, message, elapsed_ms = await state.test_model(model_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="模型不存在")

    entry = state.get_model(model_id)
    model_name = entry.model if entry else ""

    return ModelTestResult(
        success=success,
        message=message,
        model=model_name,
        elapsed_ms=elapsed_ms,
    )


# ── 任务分配 ─────────────────────────────────────────────────────

@router.get("/assignments", response_model=list[TaskAssignmentOut])
async def get_assignments() -> list[TaskAssignmentOut]:
    """获取所有任务类型的模型分配。"""
    assignments = state.get_assignments()
    result: list[TaskAssignmentOut] = []

    for task, label in state.TASK_LABELS.items():
        model_id = assignments.get(task)
        model_name = None
        if model_id:
            entry = state.get_model(model_id)
            if entry:
                model_name = entry.name

        result.append(TaskAssignmentOut(
            task=task,
            task_label=label,
            model_id=model_id,
            model_name=model_name,
        ))
    return result


@router.put("/assignments/{task}", response_model=TaskAssignmentOut)
async def update_assignment(task: str, body: TaskAssignmentUpdate) -> TaskAssignmentOut:
    """更新任务分配。"""
    if task not in state.TASK_LABELS:
        raise HTTPException(status_code=400, detail=f"不支持的任务类型: {task}")

    try:
        state.set_assignment(task, body.model_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="模型不存在")

    model_id = body.model_id
    model_name = None
    if model_id:
        entry = state.get_model(model_id)
        if entry:
            model_name = entry.name

    return TaskAssignmentOut(
        task=task,
        task_label=state.TASK_LABELS[task],
        model_id=model_id,
        model_name=model_name,
    )


# ── 服务商 ───────────────────────────────────────────────────────

@router.get("/providers", response_model=list[ProviderInfo])
async def get_providers() -> list[ProviderInfo]:
    """获取预置 LLM 服务商列表。"""
    return _PROVIDERS


# ── 项目目录 ─────────────────────────────────────────────────────

@router.get("/project-dir", response_model=ProjectDirOut)
async def get_project_dir() -> ProjectDirOut:
    """获取项目默认目录配置。"""
    project_dir = state.get_project_dir()
    abs_path = state.get_project_dir_path()
    return ProjectDirOut(
        project_dir=project_dir,
        absolute_path=str(abs_path),
        exists=abs_path.exists(),
    )


@router.put("/project-dir", response_model=ProjectDirOut)
async def update_project_dir(body: ProjectDirUpdate) -> ProjectDirOut:
    """更新项目默认目录配置。"""
    project_dir = state.set_project_dir(body.project_dir)
    abs_path = state.get_project_dir_path()
    return ProjectDirOut(
        project_dir=project_dir,
        absolute_path=str(abs_path),
        exists=abs_path.exists(),
    )


# ── 联网搜索配置 ─────────────────────────────────────────────────

@router.get("/search", response_model=SearchConfigOut)
async def get_search_config() -> SearchConfigOut:
    """获取联网搜索配置（Tavily/Serper Key、搜索源优先级）。"""
    return SearchConfigOut(**state.get_search_config())


@router.put("/search", response_model=SearchConfigOut)
async def update_search_config(body: SearchConfigUpdate) -> SearchConfigOut:
    """更新联网搜索配置。"""
    try:
        config = state.set_search_config(
            tavily_api_key=body.tavily_api_key,
            serper_api_key=body.serper_api_key,
            providers=body.providers,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return SearchConfigOut(**config)
