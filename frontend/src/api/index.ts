import axios from 'axios'

// ============ 基础类型 ============

export type TaskType = 'text' | 'structure' | 'check'
export type Role = 'system' | 'user' | 'assistant'

export interface Project {
  id: string
  name: string
  status: string
  target_words: number
  platform: string
  genre: string
  idea: string
  work_unit: string
  states_enabled: string[]
  created_at: string
  updated_at: string
  character_dimensions?: CharacterDimension[]
}

export interface ProjectCreate {
  name: string
  idea?: string
  target_words?: number
  platform?: string
  genre?: string
}

export interface ProjectUpdate {
  name?: string
  status?: string
  target_words?: number
  platform?: string
  genre?: string
  idea?: string
  work_unit?: string
  states_enabled?: string[]
  character_dimensions?: CharacterDimension[]
}

export interface CharacterDimension {
  key: string
  label: string
  hint: string
  core?: boolean
}

export interface CharacterStateTemplate {
  id: string
  label: string
  description: string
  dimensions: CharacterDimension[]
}

// ============ 世界观模板 ============

export type WorldviewDimensionType = 'text' | 'textarea' | 'tags' | 'list' | 'select'

export interface WorldviewDimension {
  key: string
  label: string
  hint: string
  type: WorldviewDimensionType
  required: boolean
  placeholder?: string
  options?: string[]
}

export interface WorldviewTemplate {
  id: string
  label: string
  description: string
  dimensions: WorldviewDimension[]
}

export interface WorldviewData {
  template_id: string
  dimensions: Record<string, any>
}

// ============ 人物模板 ============

export type CharacterTemplateDimensionType = 'text' | 'textarea' | 'tags' | 'select'

export interface CharacterTemplateDimension {
  key: string
  label: string
  hint: string
  type: CharacterTemplateDimensionType
  required: boolean
  placeholder?: string
  options?: string[]
}

export interface CharacterTemplate {
  id: string
  label: string
  description: string
  dimensions: CharacterTemplateDimension[]
}

export interface CharacterRelation {
  target_id: string
  target_name: string
  type: string
  description?: string
}

export interface CharacterEntry {
  id: string
  name: string
  role: 'protagonist' | 'supporter' | 'antagonist' | 'neutral'
  dimensions: Record<string, any>
  relations?: CharacterRelation[]
}

export interface CharactersData {
  template_id: string
  characters: CharacterEntry[]
}

// ============ 大纲模板 ============

export type OutlineNodeType = 'story' | 'volume' | 'arc' | 'chapter'

export interface OutlineNodeProperty {
  key: string
  label: string
  hint: string
  type: 'text' | 'textarea' | 'number' | 'tags'
  required: boolean
  placeholder?: string
}

export interface OutlineTemplate {
  id: string
  label: string
  description: string
  structure: OutlineNodeType[]
  nodeProperties: Record<OutlineNodeType, OutlineNodeProperty[]>
}

export interface OutlineNode {
  type: string
  [key: string]: any
  children?: OutlineNode[]
}

export interface OutlineData {
  template_id: string
  root: OutlineNode
}

// ============ 风格模板 ============

export interface StyleDimension {
  key: string
  label: string
  hint: string
  type: 'text' | 'textarea' | 'select' | 'tags'
  required: boolean
  options?: string[]
}

export interface StyleTemplate {
  id: string
  label: string
  description: string
  dimensions: StyleDimension[]
}

export interface StyleData {
  template_id: string
  dimensions: Record<string, any>
}

export interface ModelEntry {
  id: string
  name: string
  provider_id: string
  api_key: string
  base_url: string
  model: string
  temperature: number
  max_tokens: number | null
  timeout: number
  max_retries: number
  status: 'untested' | 'ok' | 'failed'
  last_tested: string | null
}

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

export interface ModelTestResult {
  success: boolean
  message: string
  model: string
  elapsed_ms: number
}

export interface TaskAssignment {
  state: string
  state_label: string
  task_label: string
  model_id: string | null
  model_name: string | null
}

export interface ProviderModel {
  name: string
  label: string
  recommended_for: TaskType[]
}

export interface ProviderInfo {
  id: string
  name: string
  base_url: string
  models: ProviderModel[]
  website: string
}

export interface ProjectDirConfig {
  project_dir: string
  absolute_path: string
  exists: boolean
}

export interface SearchConfig {
  tavily_api_key: string
  tavily_configured: boolean
  serper_api_key: string
  serper_configured: boolean
  providers: string
}

export interface SearchConfigUpdate {
  tavily_api_key?: string
  serper_api_key?: string
  providers?: string
}

export interface ChatMessage {
  role: Role
  content: string
}

export interface ChatRequest {
  task: TaskType
  messages: ChatMessage[]
  temperature?: number
  max_tokens?: number
}

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
  tool_name: string
  tool_args: Record<string, any>
  tool_result: string
  tool_success: boolean
  elapsed_ms: number
  error: string
  timestamp: string
}

export interface TokenCountResponse {
  token_count: number
}

// ============ 状态机（T1/T2） ============

export interface StateNode {
  key: string
  label: string
  context_assembly_ref: string
  panel: string
  enabled: boolean
  enabled_in_project?: boolean
}

export interface ProjectStatesResponse {
  states: StateNode[]
  current_state: string
  current_label: string
  work_unit: string
}

// ============ Agent 窗口（T3/T4/T7） ============

export interface AgentStep {
  thought: string
  tool_name: string
  tool_args: Record<string, any>
  observation: string
  is_final: boolean
}

export interface AgentTurnResult {
  reply: string
  is_done: boolean
  steps: AgentStep[]
  interactions: LLMInteraction[]
  success: boolean
  error: string
}

export interface AskQuestion {
  question: string
  options: string[]
  multiple: boolean
  allow_custom: boolean
}

export interface AgentContext {
  project_id: string
  project_name: string
  current_state: string
  current_label: string
  states: StateNode[]
  work_unit: string
  memory_stats: { facts: number; foreshadow: number; characters: number; summaries: number }
  prereq: Record<string, boolean>
  core_elements: Record<string, any>
}

export type AgentStreamEvent =
  | { type: 'step'; data: AgentStep }
  | { type: 'chunk'; data: string }
  | { type: 'thinking'; data: string }
  | { type: 'ask'; data: AskQuestion }
  | { type: 'done'; data: AgentTurnResult }
  | { type: 'aborted'; data: Partial<AgentTurnResult> & { error?: string } }
  | { type: 'error'; data: { error: string } }

export interface AgentSessionMeta {
  id: string
  title: string
  state: string
  created_at: string
  updated_at: string
  message_count: number
}

/** 会话消息记录（与后端 agent_chat.jsonl 格式一致） */
export interface AgentChatRecord {
  role: string
  content: string
  function_call?: Record<string, any> | null
  [key: string]: any
}

// ============ 章节 / 审阅（T9） ============

export type ChapterStatus = 'PENDING' | 'GENERATED' | 'REVIEWED' | 'FINALIZED'

export interface ChapterRecord {
  no: number
  title: string
  status: ChapterStatus
  words: number
  created_at: string
  updated_at: string
  outline_ref?: string
}

export interface ChapterDetail {
  record: ChapterRecord
  content: string
  path: string
}

export interface WriteChapterResult {
  success: boolean
  chapter_no: number
  title: string
  content: string
  words: number
  summary: string
  error: string
  blocked: boolean
}

export interface RewriteResult {
  success: boolean
  original: string
  rewritten: string
  error: string
}

export interface ReviewSuggestion {
  id: string
  location: string
  issue: string
  suggestion: string
  original: string
  rewritten: string
}

export interface ReviewResult {
  success: boolean
  chapter_no: number
  title: string
  report: string
  suggestions: ReviewSuggestion[]
  error: string
}

export interface PrereqCheckResult {
  complete: boolean
  missing: string[]
  details: Record<string, boolean>
}

// ============ 记忆 / 伏笔（T5/T6） ============

export interface MemoryOverview {
  facts: Array<Record<string, any>>
  foreshadow: Array<Record<string, any>>
  characters: Record<string, any>
  summaries: Array<{ level: number; content: string }>
  stats: { facts: number; foreshadow: number; characters: number; summaries: number }
}


// ============ Agent 角色蓝图 ============

export type AgentRoleCategory = 'proposer' | 'synthesizer' | 'reviewer'

export interface AgentRoleModelConfig {
  mode: 'reference' | 'custom'
  globalConfigId?: string
  custom?: {
    modelId: string
    temperature: number
    maxTokens?: number
    topP?: number
  }
}

export interface AgentRoleContextConfig {
  sharedContextKeys: string[]
  roleFocusHint: string
}

export interface AgentRoleAsset {
  id: string
  name: string
  description: string
  category: AgentRoleCategory
  systemPrompt: string
  promptVariables?: string[]
  modelConfig: AgentRoleModelConfig
  contextConfig: AgentRoleContextConfig
  createdAt: string
  updatedAt: string
  isBuiltin: boolean
}

export interface CreateAgentRoleRequest {
  name: string
  description: string
  category: AgentRoleCategory
  systemPrompt: string
  promptVariables?: string[]
  modelConfig?: AgentRoleModelConfig
  contextConfig?: AgentRoleContextConfig
}

export interface UpdateAgentRoleRequest {
  name?: string
  description?: string
  category?: AgentRoleCategory
  systemPrompt?: string
  promptVariables?: string[]
  modelConfig?: AgentRoleModelConfig
  contextConfig?: AgentRoleContextConfig
}

// ============ axios 实例 ============

const apiClient = axios.create({
  baseURL: '/api',
  timeout: 180000,
})

export const healthCheck = () => apiClient.get<{ status: string }>('/health')

// ============ 项目 ============

export const getProjects = () => apiClient.get<Project[]>('/projects')
export const getCharacterStateTemplates = () => apiClient.get<CharacterStateTemplate[]>('/config/character-state-templates')
export const getWorldviewTemplates = () => apiClient.get<WorldviewTemplate[]>('/config/worldview-templates')
export const getCharacterTemplates = () => apiClient.get<CharacterTemplate[]>('/config/character-templates')
export const getOutlineTemplates = () => apiClient.get<OutlineTemplate[]>('/config/outline-templates')
export const getStyleTemplates = () => apiClient.get<StyleTemplate[]>('/config/style-templates')
export const createProject = (data: ProjectCreate) => apiClient.post<Project>('/projects', data)
export const getProject = (projectId: string) => apiClient.get<Project>(`/projects/${projectId}`)
export const updateProject = (projectId: string, data: ProjectUpdate) =>
  apiClient.put<Project>(`/projects/${projectId}`, data)
export const deleteProject = (projectId: string) => apiClient.delete(`/projects/${projectId}`)

// ============ 状态机 ============

export const getProjectStates = (projectId: string) =>
  apiClient.get<ProjectStatesResponse>(`/projects/${projectId}/states`)
export const updateStatesConfig = (projectId: string, data: { states_enabled?: string[]; work_unit?: string }) =>
  apiClient.put<Project>(`/projects/${projectId}/states/config`, data)
export const switchProjectState = (projectId: string, state: string) =>
  apiClient.post<{ current_state: string; label: string; work_unit: string }>(`/projects/${projectId}/states/switch`, { state })

// ============ 设定 ============

export interface Worldview {
  sections: { era: string; rules: string; geography: string; factions: string; history: string }
}
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
export interface Characters {
  characters: Character[]
}
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
export interface Outline {
  root: {
    type: string
    summary_short: string
    summary_long: string
    children: OutlineNode[]
  }
}
export interface Style {
  style: string
}
export type SettingType = 'worldview' | 'characters' | 'outline' | 'style'
export type SettingData = Worldview | Characters | Outline | Style

export interface SettingsSummaryItem {
  type: string
  label: string
  exists: boolean
  count: number
}

/** 静态设定聚合（各类型存在性与数量，供设定页统计导航） */
export const getSettingsSummary = (projectId: string) =>
  apiClient.get<{ settings: SettingsSummaryItem[] }>(`/projects/${projectId}/settings`)

export const getSetting = (projectId: string, settingType: SettingType) =>
  apiClient.get<SettingData>(`/projects/${projectId}/settings/${settingType}`)
export const saveSetting = (projectId: string, settingType: SettingType, data: SettingData) =>
  apiClient.put(`/projects/${projectId}/settings/${settingType}`, data)
export const generateSettings = (projectId: string, settingType: SettingType | 'all') =>
  apiClient.post<{ success: boolean; settings: Record<string, any> }>(
    `/workflow/${projectId}/settings/generate`,
    { setting_type: settingType }
  )

/** 动态设定账本（只读，由正文章末自动回写） */
export const getDynamicAccount = (projectId: string, account: string) =>
  apiClient.get<{ account: string; exists: boolean; kind: string; data: Record<string, any> | null }>(
    `/projects/${projectId}/dynamic/${account}`
  )

/** 动态设定账本聚合（全部账本 + 统计，供工作台总览） */
export const getDynamicAccounts = (projectId: string) =>
  apiClient.get<{
    accounts: Array<{
      account: string
      label: string
      kind: string
      description: string
      exists: boolean
      count: number
      updated_at: string | null
      last_chapter: number | null
    }>
  }>(`/projects/${projectId}/dynamic`)

export const getPrereqCheck = (projectId: string) =>
  apiClient.get<PrereqCheckResult>(`/projects/${projectId}/prereq-check`)

export const getCoreElements = (projectId: string) =>
  apiClient.get<{ exists: boolean; data: Record<string, any> }>(`/projects/${projectId}/core-elements`)
export const saveCoreElements = (projectId: string, data: Record<string, any>) =>
  apiClient.post<{ success: boolean; path: string; errors?: string[] }>(`/projects/${projectId}/core-elements`, data)

export const getVisionDoc = (projectId: string) =>
  apiClient.get<{ exists: boolean; content: string; path: string }>(`/projects/${projectId}/vision-doc`)

export interface ProjectDocument {
  name: string
  path: string
  size: number
  modified: number
  kind?: string
  title?: string
  work_unit?: string | null
}
export const getProjectDocuments = (projectId: string) =>
  apiClient.get<{ documents: ProjectDocument[] }>(`/projects/${projectId}/documents`)
export const getProjectDocumentsByKind = (projectId: string, kind: string) =>
  apiClient.get<{ documents: ProjectDocument[] }>(`/projects/${projectId}/documents`, {
    params: { kind },
  })
export const readProjectDocument = (projectId: string, relPath: string) =>
  apiClient.get<{ success: boolean; content: string; error: string }>('/files/read', {
    params: { path: `${projectId}/${relPath}` },
  })

// ============ 伏笔 / 记忆 ============

export const getForeshadow = (projectId: string) =>
  apiClient.get<{ items: Array<Record<string, any>> }>(`/projects/${projectId}/foreshadow`)
export const addForeshadow = (projectId: string, data: { desc: string; planted_at?: string; planned_reap?: string }) =>
  apiClient.post(`/projects/${projectId}/foreshadow`, data)
export const updateForeshadow = (projectId: string, id: string, data: { status?: string; reap_info?: string }) =>
  apiClient.put(`/projects/${projectId}/foreshadow/${id}`, data)
export const getProjectMemory = (projectId: string) =>
  apiClient.get<MemoryOverview>(`/projects/${projectId}/memory`)

// ============ Agent 窗口 ============

export const getAgentContext = (projectId: string, sessionId?: string) =>
  apiClient.get<AgentContext>('/agent/context', { params: { project_id: projectId, session_id: sessionId || undefined } })

export const agentTurn = (projectId: string, message: string, toolCallMode = 'jsonfc', sessionId?: string) =>
  apiClient.post<AgentTurnResult>('/agent/turn', { project_id: projectId, message, tool_call_mode: toolCallMode, session_id: sessionId || undefined })

export const agentSwitchState = (projectId: string, state: string, workUnit?: string, sessionId?: string) =>
  apiClient.post('/agent/switch-state', { project_id: projectId, state, work_unit: workUnit, session_id: sessionId })

// ---- Agent 会话管理（按书多会话，持久化于项目目录） ----

export const getAgentSessions = (projectId: string) =>
  apiClient.get<{ project_id: string; sessions: AgentSessionMeta[] }>('/agent/sessions', { params: { project_id: projectId } })

export const createAgentSession = (projectId: string, data?: { title?: string; state?: string }) =>
  apiClient.post<AgentSessionMeta>('/agent/sessions', { project_id: projectId, title: data?.title, state: data?.state })

export const renameAgentSession = (projectId: string, sessionId: string, title: string) =>
  apiClient.patch<AgentSessionMeta>(`/agent/sessions/${sessionId}`, { project_id: projectId, title })

export const deleteAgentSession = (projectId: string, sessionId: string) =>
  apiClient.delete<{ success: boolean }>(`/agent/sessions/${sessionId}`, { params: { project_id: projectId } })

export const getAgentSessionMessages = (projectId: string, sessionId: string) =>
  apiClient.get<{ session_id: string; messages: AgentChatRecord[] }>(`/agent/sessions/${sessionId}/messages`, { params: { project_id: projectId } })

export const getAgentPendingAsk = (projectId: string, sessionId: string) =>
  apiClient.get<{ has_pending: boolean; question: AskQuestion | null }>('/agent/pending-ask', { params: { project_id: projectId, session_id: sessionId } })

export const agentAnswer = (projectId: string, answer: string, sessionId?: string) =>
  apiClient.post('/agent/answer', { project_id: projectId, answer, session_id: sessionId || undefined })

export const agentTurnStop = (projectId: string, sessionId?: string) =>
  apiClient.post('/agent/turn/stop', { project_id: projectId, session_id: sessionId || undefined })

/** Agent SSE 流式解析（step/chunk/thinking/ask/done/error） */
export async function* agentTurnStream(projectId: string, message: string, sessionId?: string): AsyncGenerator<AgentStreamEvent> {
  const response = await fetch('/api/agent/turn/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project_id: projectId, message, tool_call_mode: 'jsonfc', session_id: sessionId || undefined }),
  })
  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    let message = `HTTP ${response.status}`
    try {
      const parsed = JSON.parse(errorText)
      if (parsed?.error) message = parsed.error
    } catch {
      if (errorText) message = errorText
    }
    throw new Error(message)
  }
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    buf = buf.replace(/\r\n/g, '\n')
    let sep: number
    while ((sep = buf.indexOf('\n\n')) >= 0) {
      const raw = buf.slice(0, sep)
      buf = buf.slice(sep + 2)
      const evt = raw.match(/^event: (.+)$/m)?.[1] ?? ''
      const dataLine = raw.match(/^data: (.*)$/m)?.[1] ?? ''
      if (!dataLine) continue
      if (evt === 'step') yield { type: 'step', data: JSON.parse(dataLine) }
      else if (evt === 'chunk') { try { yield { type: 'chunk', data: JSON.parse(dataLine) } } catch { yield { type: 'chunk', data: dataLine } } }
      else if (evt === 'thinking') { try { yield { type: 'thinking', data: JSON.parse(dataLine) } } catch { yield { type: 'thinking', data: dataLine } } }
      else if (evt === 'ask') yield { type: 'ask', data: JSON.parse(dataLine) }
      else if (evt === 'done') yield { type: 'done', data: JSON.parse(dataLine) }
      else if (evt === 'aborted') yield { type: 'aborted', data: JSON.parse(dataLine) }
      else if (evt === 'error') {
        try {
          yield { type: 'error', data: JSON.parse(dataLine) }
        } catch {
          yield { type: 'error', data: { error: dataLine } }
        }
      }
    }
  }
}

// ============ 章节 / 审阅 ============

export const getChapters = (projectId: string) =>
  apiClient.get<{ chapters: ChapterRecord[]; prereq: PrereqCheckResult; memory_stats: Record<string, number> }>(`/workflow/${projectId}/chapters`)
export const getChapter = (projectId: string, no: number) =>
  apiClient.get<ChapterDetail>(`/workflow/${projectId}/chapters/${no}`)
export const writeChapter = (projectId: string, no: number, data: { title?: string; note?: string; block_when_incomplete?: boolean }) =>
  apiClient.post<WriteChapterResult>(`/workflow/${projectId}/chapters/${no}/write`, data)
export const rewriteChapter = (projectId: string, no: number, data: { selection: string; instruction: string }) =>
  apiClient.post<RewriteResult>(`/workflow/${projectId}/chapters/${no}/rewrite`, data)
export const applyRewrite = (projectId: string, no: number, data: { selection: string; rewritten: string }) =>
  apiClient.post(`/workflow/${projectId}/chapters/${no}/rewrite/apply`, data)
export const reviewChapter = (projectId: string, no: number) =>
  apiClient.post<ReviewResult>(`/workflow/${projectId}/chapters/${no}/review`)
export const applyReviewSuggestionApi = (projectId: string, no: number, suggestion: { original: string; rewritten: string }) =>
  apiClient.post(`/workflow/${projectId}/chapters/${no}/review/apply`, { suggestion })
export const approveReview = (projectId: string, no: number) =>
  apiClient.post(`/workflow/${projectId}/chapters/${no}/review/approve`)

// ============ 聊天（调试保留） ============

export const chat = (data: ChatRequest) => apiClient.post<ChatResponse>('/chat/', data)
export const countTokens = (data: Pick<ChatRequest, 'task' | 'messages'>) =>
  apiClient.post<TokenCountResponse>('/chat/tokens', data)

export async function* chatStream(data: ChatRequest): AsyncGenerator<{ type: 'chunk' | 'done' | 'error'; content: string }> {
  const response = await fetch('/api/chat/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    let message = `HTTP ${response.status}`
    try {
      const parsed = JSON.parse(errorText)
      if (parsed?.error) message = parsed.error
    } catch {
      if (errorText) message = errorText
    }
    throw new Error(message)
  }
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    buf = buf.replace(/\r\n/g, '\n')
    let sep: number
    while ((sep = buf.indexOf('\n\n')) >= 0) {
      const raw = buf.slice(0, sep)
      buf = buf.slice(sep + 2)
      const evt = raw.match(/^event: (.+)$/m)?.[1] ?? ''
      const dataLine = raw.match(/^data: (.*)$/m)?.[1] ?? ''
      if (evt === 'chunk') yield { type: 'chunk', content: dataLine }
      else if (evt === 'done') yield { type: 'done', content: '[DONE]' }
      else if (evt === 'error') yield { type: 'error', content: dataLine }
    }
  }
}

// ============ 配置 ============

export const getModels = () => apiClient.get<ModelEntry[]>('/config/models')
export const createModel = (data: CreateModelRequest) => apiClient.post<ModelEntry>('/config/models', data)
export const updateModel = (id: string, data: UpdateModelRequest) => apiClient.put<ModelEntry>(`/config/models/${id}`, data)
export const deleteModel = (id: string) => apiClient.delete(`/config/models/${id}`)
export const testModel = (id: string) => apiClient.post<ModelTestResult>(`/config/models/${id}/test`)
export const getAssignments = () => apiClient.get<TaskAssignment[]>('/config/assignments')
export const updateAssignment = (state: string, modelId: string | null) =>
  apiClient.put<TaskAssignment>(`/config/assignments/${state}`, { model_id: modelId })
export const getProviders = () => apiClient.get<ProviderInfo[]>('/config/providers')
export const getProjectDir = () => apiClient.get<ProjectDirConfig>('/config/project-dir')
export const updateProjectDir = (project_dir: string) => apiClient.put<ProjectDirConfig>('/config/project-dir', { project_dir })
export const getSearchConfig = () => apiClient.get<SearchConfig>('/config/search')
export const updateSearchConfig = (data: SearchConfigUpdate) => apiClient.put<SearchConfig>('/config/search', data)

// ============ 交互记录 ============

export type InteractionSource = 'chat' | 'chat_test' | 'chat_apply' | 'stage1' | 'agent'

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
  project_id: string
  session_id: string
  turn_id: string
  user_message: string
  channel?: 'agent' | 'group_chat'
  member_id?: string
  member_name?: string
  response_content: string
  tool_result: string
  tool_name: string
}

export interface InteractionListResponse {
  items: InteractionListItem[]
  total: number
  limit: number
  offset: number
}

/** 聚合后的交互记录（一次用户消息 + 所有相关LLM调用） */
export interface AggregatedInteraction {
  turn_id: string
  user_message: string
  project_id: string
  session_id: string
  channel?: 'agent' | 'group_chat'
  session_title: string
  timestamp: string
  total_tokens: number
  total_elapsed_ms: number
  has_error: boolean
  records: InteractionListItem[]
}

export interface AggregatedInteractionResponse {
  items: AggregatedInteraction[]
  total: number
  limit: number
  offset: number
}

export interface InteractionDetail extends LLMInteraction {
  id: string
  source: string
  title: string
  task_type: string
  created_at: string
  session_id: string
  turn_id: string
  user_message: string
  channel?: 'agent' | 'group_chat'
  member_id?: string
  member_name?: string
}

export interface DeleteResult {
  success: boolean
  message: string
  deleted_count?: number
}

export const getInteractions = (source?: string, limit = 20, offset = 0) =>
  apiClient.get<InteractionListResponse>('/interactions', { params: { source, limit, offset } })
export const getInteractionDetail = (id: string) => apiClient.get<InteractionDetail>(`/interactions/${id}`)
export const deleteInteraction = (id: string) => apiClient.delete<DeleteResult>(`/interactions/${id}`)
export const deleteSessionInteractions = (sessionId: string) =>
  apiClient.delete<DeleteResult & { deleted_count?: number }>(`/interactions/by-session/${sessionId}`)
export const clearInteractions = (source?: string) =>
  apiClient.delete<DeleteResult>('/interactions', { params: { source } })


// ============ Agent 角色蓝图 ============

export const getAgentRoles = () => apiClient.get<AgentRoleAsset[]>('/agent-roles')
export const getAgentRole = (id: string) => apiClient.get<AgentRoleAsset>(`/agent-roles/${id}`)
export const createAgentRole = (data: CreateAgentRoleRequest) => apiClient.post<AgentRoleAsset>('/agent-roles', data)
export const updateAgentRole = (id: string, data: UpdateAgentRoleRequest) => apiClient.put<AgentRoleAsset>(`/agent-roles/${id}`, data)
export const deleteAgentRole = (id: string) => apiClient.delete<{ success: boolean }>(`/agent-roles/${id}`)
export const duplicateAgentRole = (id: string) => apiClient.post<AgentRoleAsset>(`/agent-roles/${id}/duplicate`)


export const getAggregatedInteractions = (params: { source?: string; limit?: number; offset?: number; session_id?: string; project_id?: string; channel?: 'agent' | 'group_chat' } = {}) =>
  apiClient.get<AggregatedInteractionResponse>('/interactions/aggregated', { params })

// ============ 多 Agent 群聊（ChatSession） ============

export type ChatSessionStatus = 'idle' | 'running' | 'synthesizing' | 'completed' | 'terminated'

export interface ChatMember {
  id: string
  kind: 'agent' | 'author'
  name: string
  description: string
  category: AgentRoleCategory
  systemPrompt?: string
}

export interface ChatMessageRecord {
  id: string
  sessionId: string
  memberId: string
  memberName: string
  kind: 'agent' | 'author' | 'system'
  category?: AgentRoleCategory
  content: string
  timestamp: string
  replyTo?: string
}

export type ChatSessionEvent =
  | { type: 'system'; data: { message: string; status?: ChatSessionStatus; memberId?: string } }
  | { type: 'chat_message'; data: ChatMessageRecord }
  | { type: 'delta'; data: { messageId: string; memberId: string; memberName: string; content: string; done?: boolean } }
  | { type: 'speaker'; data: { memberId: string; memberName: string; scores: Record<string, number>; reason: string } }
  | { type: 'agent_status'; data: { memberId: string; status: 'thinking' | 'generating' | 'idle' } }
  | { type: 'consensus'; data: { level: number; message: string; signals?: string[] } }
  | { type: 'done'; data: { status: 'completed' | 'terminated'; summary?: string } }
  | { type: 'error'; data: { error: string } }

export interface ChatSessionSnapshot {
  id: string
  projectId: string
  topic: string
  members: ChatMember[]
  messages: ChatMessageRecord[]
  status: ChatSessionStatus
  createdAt: string
  updatedAt: string
  summary?: string
  consensusNodes?: ChatConsensusNode[]
}

export interface ChatConsensusNode {
  level: number
  message: string
  signals?: string[]
}

export interface StartChatSessionRequest {
  projectId: string
  topic: string
  memberIds: string[]
  staticContext?: Record<string, string>
  maxRounds?: number
}

export const startChatSession = (data: StartChatSessionRequest) =>
  apiClient.post<{ sessionId: string; status: ChatSessionStatus; members: ChatMember[]; topic: string }>('/chat-sessions/start', data)

// 项目内讨论会话列表（含共识 / 最终方案，会话恢复入口）。
export const listChatSessions = (projectId: string) =>
  apiClient.get<{ sessions: ChatSessionSnapshot[] }>('/chat-sessions', { params: { projectId } })

export const getChatSession = (sessionId: string) =>
  apiClient.get<ChatSessionSnapshot>(`/chat-sessions/${sessionId}`)

export const sendChatMessage = (sessionId: string, content: string) =>
  apiClient.post<{ success: boolean; message: ChatMessageRecord }>(`/chat-sessions/${sessionId}/message`, { content })

export const stopChatSession = (sessionId: string) =>
  apiClient.post<{ success: boolean; status: ChatSessionStatus }>(`/chat-sessions/${sessionId}/stop`)

// 删除讨论会话（内存 + 磁盘彻底移除）。
export const deleteChatSession = (sessionId: string) =>
  apiClient.delete<{ success: boolean }>(`/chat-sessions/${sessionId}`)

export type ChatApplyTarget = 'document' | 'outline' | 'characters'

export const applyChatPlan = (sessionId: string, target: ChatApplyTarget) =>
  apiClient.post<{ target: ChatApplyTarget; ok: boolean; message: string; relPath?: string; data?: Record<string, unknown> }>(`/chat-sessions/${sessionId}/apply`, { target })

export async function* chatSessionStream(sessionId: string): AsyncGenerator<ChatSessionEvent> {
  const response = await fetch(`/api/chat-sessions/${sessionId}/stream`, {
    headers: { Accept: 'text/event-stream' },
  })
  if (!response.ok || !response.body) {
    throw new Error(`讨论流连接失败: HTTP ${response.status}`)
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let eventType = ''
  const knownEvents = new Set(['system', 'chat_message', 'delta', 'speaker', 'agent_status', 'consensus', 'done', 'error'])
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let boundary
    while ((boundary = buffer.indexOf('\n\n')) !== -1) {
      const rawEvent = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)
      let data = ''
      for (const line of rawEvent.split('\n')) {
        if (line.startsWith('event:')) eventType = line.slice(6).trim()
        if (line.startsWith('data:')) data += line.slice(5).trim()
      }
      if (!data || !knownEvents.has(eventType)) continue
      try {
        // 组装 { type, data } 事件结构：event: 行决定类型，data: 行解析为负载
        yield { type: eventType, data: JSON.parse(data) } as ChatSessionEvent
      } catch {
        // 忽略无法解析的帧
      }
    }
  }
}
