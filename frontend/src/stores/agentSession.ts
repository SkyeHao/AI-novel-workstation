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

function sessionStoreKey(projectId: string): string {
  return STORAGE_PREFIX + '.session.' + projectId
}

export const SESSION_SNAP_VERSION = 1

/** 会话渲染快照：消息 + ask 卡片 + UI 瞬态 + 输入框草稿（localStorage 持久化） */
export interface SessionSnapshot {
  version: number
  savedAt: number
  messages: ChatMsg[]
  activeAsk: AskQuestion | null
  askState: { selectedOptions: string[]; customAnswer: string; customOpen: boolean }
  draft: string
  state: string
}

function sessionSnapKey(projectId: string, sessionId: string): string {
  return STORAGE_PREFIX + '.snap.' + projectId + '.' + sessionId
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

export function snapshotToLocalStorage(projectId: string, sessionId: string, snap: SessionSnapshot): void {
  if (!sessionId) return
  try { localStorage.setItem(sessionSnapKey(projectId, sessionId), JSON.stringify(snap)) } catch { /* ignore */ }
}

export function snapshotFromLocalStorage(projectId: string, sessionId: string): SessionSnapshot | null {
  if (!sessionId) return null
  try {
    const raw = localStorage.getItem(sessionSnapKey(projectId, sessionId))
    if (raw) {
      const snap = JSON.parse(raw) as SessionSnapshot
      if (snap && snap.version === SESSION_SNAP_VERSION) return snap
    }
  } catch { /* ignore */ }
  return null
}

export function clearLocalSnapshot(projectId: string, sessionId: string): void {
  try { localStorage.removeItem(sessionSnapKey(projectId, sessionId)) } catch { /* ignore */ }
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
