import axios from 'axios'

// ====== 类型定义 ======

/** 任务类型 */
export type TaskType = 'text' | 'structure' | 'check'

/** 消息角色 */
export type Role = 'system' | 'user' | 'assistant'

/** 模型条目（GET 返回，api_key 已脱敏） */
export interface ModelEntry {
  id: string
  name: string
  provider_id: string
  api_key: string  // 脱敏
  base_url: string
  model: string
  temperature: number
  max_tokens: number | null
  timeout: number
  max_retries: number
  status: 'untested' | 'ok' | 'failed'
  last_tested: string | null
}

/** 创建模型请求 */
export interface CreateModelRequest {
  name: string
  provider_id: string
  api_key: string
  base_url: string
  model: string
  temperature: number
  max_tokens: number | null
  timeout: number
  max_retries: number
}

/** 更新模型请求（所有字段可选，api_key 留空不修改） */
export interface UpdateModelRequest {
  name?: string
  provider_id?: string
  api_key?: string
  base_url?: string
  model?: string
  temperature?: number
  max_tokens?: number | null
  timeout?: number
  max_retries?: number
}

/** 模型测试结果 */
export interface ModelTestResult {
  success: boolean
  message: string
  model: string
  elapsed_ms: number
}

/** 任务分配 */
export interface TaskAssignment {
  task: TaskType
  task_label: string
  model_id: string | null
  model_name: string | null
}

/** 聊天消息 */
export interface ChatMessage {
  role: Role
  content: string
}

/** 聊天请求体 */
export interface ChatRequest {
  task: TaskType
  messages: ChatMessage[]
  temperature?: number
  max_tokens?: number
}

/** 同步聊天响应 */
export interface ChatResponse {
  content: string
  model: string
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  finish_reason: string
  elapsed_ms: number
  interaction?: LLMInteraction | null
}

/** Token 计数响应 */
export interface TokenCountResponse {
  token_count: number
}

/** 服务商模型条目 */
export interface ProviderModel {
  name: string
  label: string
  recommended_for: TaskType[]
}

/** LLM 服务商信息 */
export interface ProviderInfo {
  id: string
  name: string
  base_url: string
  models: ProviderModel[]
  website: string
}

/** SSE 流式事件 */
export interface StreamEvent {
  type: 'chunk' | 'done' | 'error'
  content: string
}

// ====== 阶段1：创意输入 类型定义 ======

/** 阶段1请求 */
export interface Stage1Request {
  user_input: string
  project_name?: string
  genre?: string
  platform?: string
  target_words?: string
}

/** 阶段1步骤 */
export interface Stage1Step {
  step_index: number
  thought: string
  tool_name: string
  tool_args: string
  observation: string
  is_final: boolean
}

/** LLM 交互记录（单次调用） */
export interface LLMInteraction {
  messages: Array<Record<string, any>>
  model: string
  temperature: number
  max_tokens: number | null
  functions: Array<Record<string, any>> | null
  function_call: string | Record<string, any> | null
  response_content: string
  response_function_call: Record<string, any> | null
  finish_reason: string
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  // 工具执行结果
  tool_name: string
  tool_args: Record<string, any>
  tool_result: string
  tool_success: boolean
  elapsed_ms: number
  error: string
  timestamp: string
}

/** 阶段1最终结果 */
export interface Stage1Result {
  success: boolean
  final_output: string
  steps: string[]
  interactions: LLMInteraction[]
  project_path: string
  vision_doc_path: string
  error: string
}

/** 阶段1 SSE 流式事件（联合类型） */
export type Stage1StreamEvent =
  | { type: 'step'; data: Stage1Step }
  | { type: 'done'; data: Stage1Result }
  | { type: 'error'; message: string }

// ====== 阶段1：多轮对话会话 类型定义 ======

/** 创建会话请求 */
export interface SessionCreateRequest {
  project_id?: string
  project_name?: string
  genre?: string
  platform?: string
  target_words?: string
}

/** 会话信息 */
export interface SessionInfo {
  session_id: string
  project_id: string
  project_name: string
  genre: string
  platform: string
  target_words: string
  done: boolean
  created_at: string
  updated_at: string
  message_count: number
  project_path: string
  vision_doc_path: string
  vision_doc_exists: boolean
}

/** 单轮对话结果 */
export interface Stage1TurnResult {
  reply: string
  is_done: boolean
  steps: Stage1Step[]
  interactions: LLMInteraction[]
  success: boolean
  project_path: string
  vision_doc_path: string
  error: string
}

/** Agent 向作者提问（ask_user 工具触发） */
export interface AskQuestion {
  question: string
  options: string[]
  multiple: boolean
  allow_custom: boolean
}

/** 会话 SSE 事件（联合类型） */
export type SessionStreamEvent =
  | { type: 'step'; data: Stage1Step }
  | { type: 'chunk'; data: string }
  | { type: 'thinking'; data: string }
  | { type: 'ask'; data: AskQuestion }
  | { type: 'done'; data: Stage1TurnResult }
  | { type: 'error'; message: string }

/** 文件读取响应 */
export interface FileReadResponse {
  success: boolean
  content: string
  error: string
}

// ====== axios 实例 ======

const apiClient = axios.create({
  baseURL: '/api',
  timeout: 120000,
})

// ====== API 调用函数 ======

/** 健康检查 */
export const healthCheck = () =>
  apiClient.get<{ status: string }>('/health')

/** 获取所有模型条目 */
export const getModels = () =>
  apiClient.get<ModelEntry[]>('/config/models')

/** 创建模型 */
export const createModel = (data: CreateModelRequest) =>
  apiClient.post<ModelEntry>('/config/models', data)

/** 更新模型 */
export const updateModel = (id: string, data: UpdateModelRequest) =>
  apiClient.put<ModelEntry>(`/config/models/${id}`, data)

/** 删除模型 */
export const deleteModel = (id: string) =>
  apiClient.delete(`/config/models/${id}`)

/** 测试模型连接 */
export const testModel = (id: string) =>
  apiClient.post<ModelTestResult>(`/config/models/${id}/test`)

/** 获取任务分配 */
export const getAssignments = () =>
  apiClient.get<TaskAssignment[]>('/config/assignments')

/** 更新任务分配 */
export const updateAssignment = (task: TaskType, modelId: string | null) =>
  apiClient.put<TaskAssignment>(`/config/assignments/${task}`, { model_id: modelId })

/** 获取预置 LLM 服务商列表 */
export const getProviders = () =>
  apiClient.get<ProviderInfo[]>('/config/providers')

/** 同步聊天 */
export const chat = (data: ChatRequest) =>
  apiClient.post<ChatResponse>('/chat/', data)

/** Token 计数 */
export const countTokens = (data: Pick<ChatRequest, 'task' | 'messages'>) =>
  apiClient.post<TokenCountResponse>('/chat/tokens', data)

/**
 * 规范化 SSE 流中的行尾。
 * 后端 sse-starlette 使用 CRLF（\r\n）分隔事件，浏览器端需统一为 LF 才能正确按 \n\n 切分。
 */
function normalizeSSE(buf: string): string {
  return buf.replace(/\r\n/g, '\n')
}

/**
 * 流式聊天（SSE）
 * 后端使用 sse-starlette EventSourceResponse，事件格式：
 *   event: chunk\ndata: <内容片段>
 *   event: done\ndata: [DONE]
 *   event: error\ndata: <错误信息>
 */
export async function* chatStream(data: ChatRequest): AsyncGenerator<StreamEvent> {
  const response = await fetch('/api/chat/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    throw new Error(`HTTP ${response.status}: ${errorText || response.statusText}`)
  }

  if (!response.body) {
    throw new Error('响应体为空，浏览器可能不支持流式读取')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += normalizeSSE(decoder.decode(value, { stream: true }))

      // SSE 事件之间以空行（\n\n）分隔
      const events = buffer.split('\n\n')
      // 最后一段可能不完整，保留在缓冲区
      buffer = events.pop() || ''

      for (const eventBlock of events) {
        const parsed = parseSSEEvent(eventBlock)
        if (!parsed) continue
        yield parsed
        if (parsed.type === 'done' || parsed.type === 'error') {
          return
        }
      }
    }

    // 处理缓冲区中剩余的完整事件
    if (buffer.trim()) {
      const parsed = parseSSEEvent(buffer)
      if (parsed) yield parsed
    }
  } finally {
    reader.releaseLock()
  }
}

/**
 * 解析单个 SSE 事件块
 * 支持标准 SSE 格式：event: <type>\ndata: <content>
 */
function parseSSEEvent(eventBlock: string): StreamEvent | null {
  const lines = eventBlock.split('\n')
  let eventType = 'chunk'
  let data = ''

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('event:')) {
      eventType = trimmed.slice(6).trim()
    } else if (trimmed.startsWith('data:')) {
      // data 可能分多行，拼接起来
      if (data) data += '\n'
      data += trimmed.slice(5).trim()
    }
  }

  // 空数据且非 done/error 事件，跳过
  if (!data && eventType === 'chunk') return null

  if (eventType === 'done') {
    return { type: 'done', content: data || '[DONE]' }
  }
  if (eventType === 'error') {
    return { type: 'error', content: data || '未知错误' }
  }
  return { type: 'chunk', content: data }
}

// ====== 阶段1：创意输入 API ======

/**
 * 阶段1 流式调用（SSE）
 * 后端事件格式：
 *   event: step\ndata: {step_index, thought, tool_name, tool_args, observation, is_final}
 *   event: done\ndata: {success, final_output, project_path, vision_doc_path, error}
 *   event: error\ndata: {"error":"..."}
 */
export async function* stage1Stream(data: Stage1Request): AsyncGenerator<Stage1StreamEvent> {
  const response = await fetch('/api/workflow/stage1/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    throw new Error(`HTTP ${response.status}: ${errorText || response.statusText}`)
  }

  if (!response.body) {
    throw new Error('响应体为空，浏览器可能不支持流式读取')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += normalizeSSE(decoder.decode(value, { stream: true }))

      // SSE 事件之间以空行（\n\n）分隔
      const events = buffer.split('\n\n')
      // 最后一段可能不完整，保留在缓冲区
      buffer = events.pop() || ''

      for (const eventBlock of events) {
        const parsed = parseStage1SSEEvent(eventBlock)
        if (!parsed) continue
        yield parsed as Stage1StreamEvent
        if (parsed.type === 'done' || parsed.type === 'error') {
          return
        }
      }
    }

    // 处理缓冲区中剩余的完整事件
    if (buffer.trim()) {
      const parsed = parseStage1SSEEvent(buffer)
      if (parsed) yield parsed as Stage1StreamEvent
    }
  } finally {
    reader.releaseLock()
  }
}

/**
 * 解析阶段1 SSE 事件块
 * 支持标准 SSE 格式：event: <type>\ndata: <json>
 * 覆盖事件：step / done / error / chunk（流式文本）/ ask（向用户提问）
 */
function parseStage1SSEEvent(
  eventBlock: string
): Stage1StreamEvent | { type: 'chunk'; data: string } | { type: 'thinking'; data: string } | { type: 'ask'; data: AskQuestion } | null {
  const lines = eventBlock.split('\n')
  let eventType = ''
  let data = ''

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('event:')) {
      eventType = trimmed.slice(6).trim()
    } else if (trimmed.startsWith('data:')) {
      if (data) data += '\n'
      data += trimmed.slice(5).trim()
    }
  }

  if (!eventType) return null

  if (eventType === 'step') {
    try {
      const parsed = JSON.parse(data) as Stage1Step
      return { type: 'step', data: parsed }
    } catch {
      return null
    }
  }

  if (eventType === 'done') {
    try {
      const parsed = JSON.parse(data) as Stage1Result
      return { type: 'done', data: parsed }
    } catch {
      return null
    }
  }

  if (eventType === 'error') {
    // error 事件的 data 可能是 {"error":"..."} JSON，也可能是纯文本
    try {
      const parsed = JSON.parse(data) as { error?: string }
      return { type: 'error', message: parsed.error || '未知错误' }
    } catch {
      return { type: 'error', message: data || '未知错误' }
    }
  }

  if (eventType === 'chunk') {
    return { type: 'chunk', data }
  }

  if (eventType === 'thinking') {
    return { type: 'thinking', data }
  }

  if (eventType === 'ask') {
    try {
      const parsed = JSON.parse(data) as AskQuestion
      return { type: 'ask', data: parsed }
    } catch {
      return null
    }
  }

  return null
}

/** 读取文件内容（用于预览生成的文档） */
export const fileRead = (path: string, encoding = 'utf-8') =>
  apiClient.get<FileReadResponse>('/files/read', {
    params: { path, encoding },
  })

// ====== 阶段1：多轮对话会话 API ======

/** 创建会话 */
export const createSession = (data: SessionCreateRequest) =>
  apiClient.post<SessionInfo>('/workflow/sessions', data)

/** 查询会话 */
export const getSession = (sessionId: string) =>
  apiClient.get<SessionInfo>(`/workflow/sessions/${sessionId}`)

/** 按项目列出会话（最近会话优先） */
export const listSessions = (projectId: string, projectName = '') =>
  apiClient.get<Array<{
    session_id: string
    project_id: string
    project_name: string
    done: boolean
    created_at: string
    updated_at: string
    message_count: number
  }>>('/workflow/sessions', { params: { project_id: projectId, project_name: projectName } })

/** 获取会话消息历史（用于恢复展示） */
export const getSessionMessages = (sessionId: string) =>
  apiClient.get<{ session_id: string; messages: Array<Record<string, any>> }>(
    `/workflow/sessions/${sessionId}/messages`
  )

/** 删除会话 */
export const deleteSession = (sessionId: string) =>
  apiClient.delete<{ success: boolean; session_id: string }>(`/workflow/sessions/${sessionId}`)

/** 提交对 ask_user 问题的回答 */
export const submitSessionAnswer = (sessionId: string, answer: string) =>
  apiClient.post<{ success: boolean; message: string }>(
    `/workflow/sessions/${sessionId}/answer`,
    { answer }
  )

/** 发送一轮消息（非流式） */
export const sendSessionMessage = (sessionId: string, message: string) =>
  apiClient.post<Stage1TurnResult>(`/workflow/sessions/${sessionId}/message`, { message })

/**
 * 发送一轮消息（SSE 流式）
 * 事件格式与 stage1 一致：step / done / error
 */
export async function* sessionMessageStream(
  sessionId: string,
  message: string
): AsyncGenerator<SessionStreamEvent> {
  const response = await fetch(`/api/workflow/sessions/${sessionId}/message/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    throw new Error(`HTTP ${response.status}: ${errorText || response.statusText}`)
  }

  if (!response.body) {
    throw new Error('响应体为空，浏览器可能不支持流式读取')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += normalizeSSE(decoder.decode(value, { stream: true }))

      const events = buffer.split('\n\n')
      buffer = events.pop() || ''

      for (const eventBlock of events) {
        const parsed = parseStage1SSEEvent(eventBlock)
        if (!parsed) continue
        yield parsed as SessionStreamEvent
        if (parsed.type === 'done' || parsed.type === 'error') {
          return
        }
      }
    }

    if (buffer.trim()) {
      const parsed = parseStage1SSEEvent(buffer)
      if (parsed) yield parsed as SessionStreamEvent
    }
  } finally {
    reader.releaseLock()
  }
}

// ====== 项目 类型定义 ======

/** 项目状态 */
export type ProjectStatus = 'ideation' | 'setting' | 'writing' | 'reviewing'

/** 项目 */
export interface Project {
  id: string
  name: string
  status: ProjectStatus
  target_words: number
  platform: string
  genre: string
  idea: string
  created_at: string
  updated_at: string
}

/** 新建项目请求 */
export interface ProjectCreate {
  name: string
  idea?: string
  target_words?: number
  platform?: string
  genre?: string
}

/** 更新项目请求 */
export interface ProjectUpdate {
  name?: string
  status?: ProjectStatus
  target_words?: number
  platform?: string
  genre?: string
  idea?: string
}

// ====== 项目 API ======

/** 项目列表 */
export const getProjects = () =>
  apiClient.get<Project[]>('/projects')

/** 新建项目 */
export const createProject = (data: ProjectCreate) =>
  apiClient.post<Project>('/projects', data)

/** 项目详情 */
export const getProject = (projectId: string) =>
  apiClient.get<Project>(`/projects/${projectId}`)

/** 更新项目 */
export const updateProject = (projectId: string, data: ProjectUpdate) =>
  apiClient.put<Project>(`/projects/${projectId}`, data)

/** 删除项目 */
export const deleteProject = (projectId: string) =>
  apiClient.delete(`/projects/${projectId}`)

// ====== 设定 类型定义 ======

/** 世界观设定 */
export interface Worldview {
  sections: {
    era: string
    rules: string
    geography: string
    factions: string
    history: string
  }
}

/** 人物卡片 */
export interface Character {
  id: string
  name: string
  role: string
  personality: string
  goal: string
  flaw: string
  golden_finger: string
  relations: Array<{ target: string; type: string }>
}

/** 人物设定 */
export interface Characters {
  characters: Character[]
}

/** 大纲 */
export interface Outline {
  root: {
    type: string
    summary_short: string
    summary_long: string
    children: OutlineNode[]
  }
}

/** 大纲节点 */
export interface OutlineNode {
  type: string
  name: string
  task?: string
  target_words?: number
  summary_short?: string
  summary_long?: string
  event?: string
  function?: string
  cast?: string[]
  foreshadow_plant?: string[]
  foreshadow_reap?: string[]
  no?: number
  children?: OutlineNode[]
}

/** 风格设定 */
export interface Style {
  style: string
}

/** 设定类型 */
export type SettingType = 'worldview' | 'characters' | 'outline' | 'style'

// ====== 设定 API ======

/** 读取设定 */
export const getSetting = (projectId: string, settingType: SettingType) =>
  apiClient.get<Worldview | Characters | Outline | Style>(`/projects/${projectId}/settings/${settingType}`)

/** 保存设定 */
export const saveSetting = (
  projectId: string,
  settingType: SettingType,
  data: Worldview | Characters | Outline | Style
) =>
  apiClient.put(`/projects/${projectId}/settings/${settingType}`, data)

/** 生成设定（基于已确认核心要素） */
export const generateSettings = (projectId: string, settingType: SettingType | 'all') =>
  apiClient.post<{ success: boolean; settings: Record<string, any> }>(
    `/projects/${projectId}/settings/generate`,
    { setting_type: settingType }
  )

/** 前置设定完备检测 */
export const getPrereqCheck = (projectId: string) =>
  apiClient.get<{
    complete: boolean
    missing: string[]
    details: Record<string, boolean>
  }>(`/projects/${projectId}/prereq-check`)

/** 读取项目的《故事愿景文档》 */
export const getVisionDoc = (projectId: string) =>
  apiClient.get<{ exists: boolean; content: string; path: string }>(
    `/projects/${projectId}/vision-doc`
  )

/** 项目内 Markdown 文档条目 */
export interface ProjectDocument {
  name: string
  path: string
  size: number
  modified: number
}

/** 列出项目内所有 Markdown 文档 */
export const getProjectDocuments = (projectId: string) =>
  apiClient.get<{ documents: ProjectDocument[] }>(`/projects/${projectId}/documents`)

/** 读取项目内文档内容（相对项目根路径） */
export const readProjectDocument = (projectId: string, relPath: string) =>
  apiClient.get<{ success: boolean; content: string; error: string }>('/files/read', {
    params: { path: `${projectId}/${relPath}` },
  })

// ====== 交互记录 类型定义 ======

/** 交互记录来源类型 */
export type InteractionSource = 'chat' | 'stage1'

/** 交互记录列表项（摘要） */
export interface InteractionListItem {
  id: string
  source: string
  title: string
  model: string
  task_type: string
  total_tokens: number
  elapsed_ms: number
  error: string
  timestamp: string
  created_at: string
  session_id: string
  turn_id: string
  user_message: string
  response_content: string
  tool_result: string
  tool_name: string
}

/** 交互记录列表响应（分页） */
export interface InteractionListResponse {
  items: InteractionListItem[]
  total: number
  limit: number
  offset: number
}

/** 交互记录完整详情 */
export interface InteractionDetail extends LLMInteraction {
  id: string
  source: string
  title: string
  task_type: string
  created_at: string
  session_id: string
  turn_id: string
  user_message: string
}

/** 删除结果 */
export interface DeleteResult {
  success: boolean
  message: string
  deleted_count?: number
}

// ====== 交互记录 API ======

/** 获取交互记录列表（分页） */
export const getInteractions = (
  source?: string,
  limit = 20,
  offset = 0
) =>
  apiClient.get<InteractionListResponse>('/interactions', {
    params: { source, limit, offset },
  })

/** 获取单条交互记录详情 */
export const getInteractionDetail = (id: string) =>
  apiClient.get<InteractionDetail>(`/interactions/${id}`)

/** 删除单条交互记录 */
export const deleteInteraction = (id: string) =>
  apiClient.delete<DeleteResult>(`/interactions/${id}`)

/** 删除某会话下的全部交互记录（会话级删除） */
export const deleteSessionInteractions = (sessionId: string) =>
  apiClient.delete<DeleteResult & { deleted_count?: number }>(`/interactions/by-session/${sessionId}`)

/** 清空交互记录（可按来源） */
export const clearInteractions = (source?: string) =>
  apiClient.delete<DeleteResult>('/interactions', {
    params: { source },
  })

// ====== 项目目录配置 ======

/** 项目目录配置 */
export interface ProjectDirConfig {
  project_dir: string
  absolute_path: string
  exists: boolean
}

/** 获取项目目录配置 */
export const getProjectDir = () =>
  apiClient.get<ProjectDirConfig>('/config/project-dir')

/** 更新项目目录配置 */
export const updateProjectDir = (project_dir: string) =>
  apiClient.put<ProjectDirConfig>('/config/project-dir', { project_dir })

// ====== 联网搜索配置 ======

/** 搜索配置 */
export interface SearchConfig {
  tavily_api_key: string
  tavily_configured: boolean
  serper_api_key: string
  serper_configured: boolean
  providers: string
}

/** 搜索配置更新请求 */
export interface SearchConfigUpdate {
  tavily_api_key?: string
  serper_api_key?: string
  providers?: string
}

/** 获取联网搜索配置 */
export const getSearchConfig = () =>
  apiClient.get<SearchConfig>('/config/search')

/** 更新联网搜索配置 */
export const updateSearchConfig = (data: SearchConfigUpdate) =>
  apiClient.put<SearchConfig>('/config/search', data)
