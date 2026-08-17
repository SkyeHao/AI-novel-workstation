// =====================================================================
// Agent 会话 Store（模块级 reactive，跨组件生命周期持久）
// =====================================================================

import { reactive } from 'vue'

const STORAGE_PREFIX = 'anw.agent'

export interface ChatMsg {
  role: 'user' | 'assistant' | 'thinking' | 'tool' | 'note'
  content: string
  steps?: Array<{
    thought: string
    tool_name: string
    tool_args: Record<string, any>
    observation: string
    is_final: boolean
  }>
  ts?: number | string
}

export interface AskQuestion {
  question: string
  options: string[]
  multiple: boolean
  allow_custom: boolean
}

export interface AgentSessionMeta {
  id: string
  title: string
  state: string
  created_at: string
  updated_at: string
  message_count: number
}

interface ProjectAgentState {
  messages: ChatMsg[]
  sessions: AgentSessionMeta[]
  currentSessionId: string
  loadedSessionId: string
  activeAsk: AskQuestion | null
  selectedOptions: string[]
  customAnswer: string
  customOpen: boolean
  streaming: boolean
  chatLoading: boolean
  sessionsLoading: boolean
  pendingAnswer: string | null
  _loaded: boolean
}

function createEmpty(): ProjectAgentState {
  return {
    messages: [],
    sessions: [],
    currentSessionId: '',
    loadedSessionId: '',
    activeAsk: null,
    selectedOptions: [],
    customAnswer: '',
    customOpen: false,
    streaming: false,
    chatLoading: false,
    sessionsLoading: false,
    pendingAnswer: null,
    _loaded: false,
  }
}

const _states = new Map<string, ProjectAgentState>()

function sessionCacheKey(projectId: string, sessionId: string): string {
  return STORAGE_PREFIX + '.cache.' + projectId + '.' + sessionId
}

function sessionStoreKey(projectId: string): string {
  return STORAGE_PREFIX + '.session.' + projectId
}

export function useAgentSession(projectId: string): ProjectAgentState {
  let s = _states.get(projectId)
  if (!s) {
    s = reactive<ProjectAgentState>(createEmpty())
    _states.set(projectId, s)
    try {
      const last = localStorage.getItem(sessionStoreKey(projectId))
      if (last) s.currentSessionId = last
    } catch { /* ignore */ }
  }
  return s
}

export function snapshotToSessionStorage(projectId: string, sessionId: string, messages: ChatMsg[]): void {
  if (!sessionId || messages.length === 0) return
  try { sessionStorage.setItem(sessionCacheKey(projectId, sessionId), JSON.stringify(messages)) } catch { /* ignore */ }
}

export function snapshotFromSessionStorage(projectId: string, sessionId: string): ChatMsg[] | null {
  if (!sessionId) return null
  try {
    const raw = sessionStorage.getItem(sessionCacheKey(projectId, sessionId))
    if (raw) return JSON.parse(raw) as ChatMsg[]
  } catch { /* ignore */ }
  return null
}

export function clearSnapshot(projectId: string, sessionId: string): void {
  try { sessionStorage.removeItem(sessionCacheKey(projectId, sessionId)) } catch { /* ignore */ }
}

export function rememberSession(projectId: string, sessionId: string): void {
  try { localStorage.setItem(sessionStoreKey(projectId), sessionId) } catch { /* ignore */ }
}

export function forgetSession(projectId: string): void {
  try { localStorage.removeItem(sessionStoreKey(projectId)) } catch { /* ignore */ }
}

export function resetAgentSession(projectId: string): void {
  _states.delete(projectId)
}
