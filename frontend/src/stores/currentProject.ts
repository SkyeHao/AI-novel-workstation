import { reactive } from 'vue'

// 当前打开的项目（持久化到 localStorage，侧边栏项目页签固定显示）
const STORAGE_KEY = 'ai-novel-current-project'

export interface CurrentProject {
  id: string
  name: string
}

function load(): CurrentProject {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const p = JSON.parse(raw)
      if (p && p.id) return { id: p.id, name: p.name || '' }
    }
  } catch {
    /* 忽略解析错误 */
  }
  return { id: '', name: '' }
}

const state = reactive<CurrentProject>(load())

export function useCurrentProject() {
  return state
}

export function setCurrentProject(id: string, name = '') {
  state.id = id
  state.name = name
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    /* 忽略存储失败 */
  }
}

export function clearCurrentProject() {
  state.id = ''
  state.name = ''
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* 忽略 */
  }
}
