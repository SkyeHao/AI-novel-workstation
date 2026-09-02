<template>
  <div class="agent-view">
    <PageHeader title="创作引擎" subtitle="与创作 Agent 对话 · 支持多会话 · 自动构建流程节点上下文" icon="ChatDotRound">
      <template #actions>
        <el-tag size="small" type="primary" effect="light" round>{{ ctx.current_label || '未定义节点' }}</el-tag>
      </template>
    </PageHeader>

    <div class="agent-page">
      <!-- 对话主区 -->
      <div class="agent-chat">
        <div class="session-toolbar">
          <div class="session-left">
            <el-icon class="session-icon"><ChatDotRound /></el-icon>
            <el-select
              v-model="store.currentSessionId"
              class="session-select"
              placeholder="选择会话"
              filterable
              :loading="store.sessionsLoading"
              :disabled="store.streaming"
              @change="onSessionSelect"
            >
              <el-option v-for="s in store.sessions" :key="s.id" :value="s.id" :label="s.title">
                <div class="session-opt">
                  <span class="so-title">{{ s.title }}</span>
                  <span class="so-id mono">#{{ shortId(s.id) }}</span>
                  <span class="so-count">{{ s.message_count }} 条</span>
                </div>
              </el-option>
            </el-select>
            <span v-if="store.currentSessionId" class="session-current-id mono" :title="store.currentSessionId">#{{ shortId(store.currentSessionId) }}</span>
          </div>
          <div class="session-actions">
            <el-button type="primary" plain size="small" :disabled="store.streaming || !!store.activeAsk" @click="newSession">
              <el-icon><Plus /></el-icon>
              <span>新建会话</span>
            </el-button>
            <RowActions :items="sessionMenuItems" @command="onSessionMenuCommand" />
          </div>
        </div>

        <div v-loading="store.chatLoading" ref="chatBodyRef" class="chat-body" @scroll="onChatScroll">
          <el-empty v-if="store.messages.length === 0 && !store.streaming && !store.chatLoading" description="与创作 Agent 对话：灵感捕捉、世界观构建、人物塑造、大纲、正文生成、质量审查…" :image-size="80">
            <div class="suggest-chips">
              <el-tag v-for="tip in tips" :key="tip" class="chip" effect="plain" @click="quickSend(tip)">{{ tip }}</el-tag>
            </div>
          </el-empty>

          <div v-for="(m, idx) in store.messages" :key="idx" class="msg-row" :class="m.role">
            <div class="msg-avatar" v-if="m.role !== 'note'">
              <el-icon v-if="m.role === 'user'"><UserFilled /></el-icon>
              <el-icon v-else><MagicStick /></el-icon>
            </div>
            <div v-if="m.role === 'note'" class="msg-note">{{ m.content }}<span v-if="m.ts" class="note-time">{{ fmtTime(m.ts) }}</span></div>
            <div class="msg-bubble" v-else-if="m.role !== 'assistant' || !!m.content">
              <template v-if="m.role === 'thinking'">
                <div class="think-head">
                  <span v-if="!m.content" class="think-spinner" aria-hidden="true"></span>
                  <span class="think-head-label">{{ m.content ? '思考过程' : '思考中' }}</span>
                </div>
                <div class="think-text" :class="{ 'think-empty': !m.content }">{{ m.content || 'Agent 正在思考…' }}</div>
                <div v-if="m.ts" class="msg-time">{{ fmtTime(m.ts) }}</div>
              </template>
              <template v-else-if="m.role === 'tool'">
                <div class="tool-bubbles">
                  <div v-for="(line, li) in m.steps" :key="li" class="tool-bubble">
                    <div class="tool-head">
                      <el-icon class="tool-icon"><Wrench /></el-icon>
                      <span class="tool-name">调用工具 · {{ line.tool_name || '未知' }}</span>
                      <span v-if="!line.observation" class="tool-running">
                        <span class="think-spinner think-spinner-sm" aria-hidden="true"></span>
                        <span>执行中…</span>
                      </span>
                      <el-tag v-else size="small" type="success" effect="plain" round class="tool-done-tag">完成</el-tag>
                    </div>
                    <div v-if="line.observation" class="tool-obs-block">
                      <div class="tool-obs-label">执行结果</div>
                      <div class="tool-obs">{{ line.observation }}</div>
                    </div>
                  </div>
                  <div v-if="m.ts" class="msg-time">{{ fmtTime(m.ts) }}</div>
                </div>
              </template>
              <template v-else-if="m.role === 'assistant'">
                <MarkdownView v-if="m.content" :content="m.content" class="msg-md" />
                <div v-if="m.ts" class="msg-time">{{ fmtTime(m.ts) }}</div>
              </template>
              <template v-else>
                <div class="msg-text" v-if="m.content">{{ m.content }}</div>
                <div v-if="m.ts" class="msg-time">{{ fmtTime(m.ts) }}</div>
              </template>
            </div>
          </div>

          <!-- 调用工具独立气泡 -->
          <div v-if="store.activeAsk" class="msg-row tool">
            <div class="msg-avatar"><el-icon><MagicStick /></el-icon></div>
            <div class="msg-bubble">
              <div class="tool-bubbles">
                <div class="tool-bubble">
                  <div class="tool-head">
                    <el-icon class="tool-icon"><Wrench /></el-icon>
                    <span class="tool-name">调用工具 · ask_user</span>
                    <span class="tool-running">
                      <span class="think-spinner think-spinner-sm" aria-hidden="true"></span>
                      <span>等待作者回答…</span>
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <!-- ask 选择卡片独立气泡 -->
          <div v-if="store.activeAsk" class="msg-row tool ask-row">
            <div class="msg-avatar"><el-icon><MagicStick /></el-icon></div>
            <div class="msg-bubble">
              <div class="ask-card">
                <div class="ask-head">
                  <el-icon class="ask-icon"><QuestionFilled /></el-icon>
                  <span class="ask-title">{{ store.activeAsk.question }}</span>
                  <el-tag v-if="store.activeAsk.multiple" size="small" type="warning" effect="plain" round>可多选</el-tag>
                </div>
                <div v-if="store.activeAsk.options.length" class="ask-options">
                  <el-button
                    v-for="opt in store.activeAsk.options"
                    :key="opt"
                    size="small"
                    :type="isSelected(opt) ? 'primary' : 'default'"
                    :plain="!isSelected(opt)"
                    :class="{
                      'opt-checked': isSelected(opt),
                      'opt-custom': opt === ASK_CUSTOM_OPTION,
                    }"
                    @click="pickOption(opt)"
                  >{{ opt }}</el-button>
                </div>
                <div v-if="store.activeAsk.options.length === 0" class="ask-custom-solo">
                  <el-input v-model="store.customAnswer" placeholder="输入你的回答，回车提交" size="small" @keyup.enter="submitCustom" />
                  <el-button size="small" type="primary" :disabled="!store.customAnswer.trim()" @click="submitCustom">提交</el-button>
                </div>
                <div v-if="store.customOpen" class="ask-custom">
                  <el-input v-model="store.customAnswer" :placeholder="`输入自定义回答，回车${store.activeAsk.multiple ? '加入已选' : '提交'}`" size="small" @keyup.enter="submitCustom" />
                  <el-button size="small" type="primary" :disabled="!store.customAnswer.trim()" @click="submitCustom">{{ store.activeAsk.multiple ? '加入已选' : '提交' }}</el-button>
                </div>
                <div v-if="store.activeAsk.multiple" class="ask-multi-bar">
                  <span class="multi-picked">已选：{{ store.selectedOptions.join('、') || '（尚未选择）' }}</span>
                  <el-button size="small" type="primary" :disabled="store.selectedOptions.length === 0" @click="submitMultiple">提交多选</el-button>
                </div>
              </div>
            </div>
          </div>

          <!-- Agent 运行中指示器 -->
          <div v-if="showStreamingIndicator" class="msg-row assistant streaming-indicator">
            <div class="msg-avatar"><el-icon><MagicStick /></el-icon></div>
            <div class="msg-bubble">
              <span class="think-spinner" aria-hidden="true"></span>
              <span class="streaming-label">Agent 正在运行…</span>
            </div>
          </div>
        </div>

        <!-- 回到最新消息（微信式浮动按钮） -->
        <transition name="jump-fade">
          <div v-if="showJumpButton" class="jump-latest" title="回到最新消息" @click="jumpToLatest">
            <el-badge v-if="unreadCount > 0" :value="unreadCount" :max="99" class="jump-badge">
              <span class="jump-circle"><el-icon><ArrowDownBold /></el-icon></span>
            </el-badge>
            <span v-else class="jump-circle"><el-icon><ArrowDownBold /></el-icon></span>
          </div>
        </transition>

        <div class="chat-input-area">
          <el-input v-model="input" type="textarea" :rows="2" placeholder="告诉 Agent 你想做什么…（回车发送，Shift+Enter 换行）" :disabled="store.streaming || !!store.activeAsk || !store.currentSessionId" @keydown.enter.prevent="send" />
          <el-button v-if="store.streaming" type="danger" :loading="stopping" :disabled="stopping" @click="stop">
            <el-icon><VideoPause /></el-icon>
            <span>{{ stopping ? '正在停止…' : '停止生成' }}</span>
          </el-button>
          <el-button v-else type="primary" :disabled="!input.trim() || !!store.activeAsk || !store.currentSessionId" @click="send">发送</el-button>
        </div>
      </div>

      <!-- 右侧上下文面板 -->
      <div class="agent-side">
        <el-collapse v-model="sideOpen" class="group-collapse side-collapse">
          <el-collapse-item name="state">
            <template #title>
              <div class="collapse-title"><el-icon><Switch /></el-icon><span>当前创作状态</span><span class="collapse-count">{{ ctx.current_label || ctx.current_state }}</span></div>
            </template>
            <div class="current-state" :style="{ borderColor: stateColor(ctx.current_state) }">
              <div class="cs-label">{{ ctx.current_label || ctx.current_state }}</div>
              <div class="cs-key mono">{{ ctx.current_state }}</div>
            </div>
            <div class="state-switch">
              <div v-for="s in ctx.states" :key="s.key" class="state-chip" :class="{ on: s.key === ctx.current_state, off: s.enabled_in_project === false }" @click="switchState(s.key)">{{ s.label }}</div>
            </div>
            <div v-if="ctx.work_unit" class="work-unit">工作单元：{{ ctx.work_unit }}</div>
          </el-collapse-item>
          <el-collapse-item name="memory">
            <template #title>
              <div class="collapse-title"><el-icon><Collection /></el-icon><span>本书记忆</span></div>
            </template>
            <div class="mem-grid">
              <div class="mem"><span class="n">{{ ctx.memory_stats?.facts ?? 0 }}</span><span>事实</span></div>
              <div class="mem"><span class="n">{{ ctx.memory_stats?.foreshadow ?? 0 }}</span><span>伏笔</span></div>
              <div class="mem"><span class="n">{{ ctx.memory_stats?.characters ?? 0 }}</span><span>人物塑造</span></div>
              <div class="mem"><span class="n">{{ ctx.memory_stats?.summaries ?? 0 }}</span><span>摘要</span></div>
            </div>
            <el-divider style="margin: 10px 0" />
            <div class="prereq">
              <div v-for="(ok, key) in ctx.prereq" :key="key" class="prereq-item">
                <el-tag size="small" :type="ok ? 'success' : 'info'">{{ key }}</el-tag>
                <span>{{ ok ? '已就绪' : '未完成' }}</span>
              </div>
            </div>
          </el-collapse-item>
        </el-collapse>
      </div>
    </div>
  </div>
</template>
<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import MarkdownView from '@/components/MarkdownView.vue'
import RowActions, { type RowActionItem } from '@/components/RowActions.vue'
import PageHeader from '@/components/PageHeader.vue'
import {
  getAgentContext, agentTurnStream, agentAnswer, agentSwitchState,
  getAgentSessions, createAgentSession, renameAgentSession, deleteAgentSession,
  getAgentSessionMessages, getAgentPendingAsk, agentTurnStop,
  type AgentContext, type AgentChatRecord,
} from '@/api'
import {
  useAgentSession, snapshotToLocalStorage, snapshotFromLocalStorage, clearLocalSnapshot,
  rememberSession, forgetSession,
  SESSION_SNAP_VERSION,
  type ChatMsg, type SessionSnapshot,
} from '@/stores/agentSession'

const route = useRoute()
const projectId = route.params.id as string
const store = useAgentSession(projectId)
const input = ref('')
const stopping = ref(false)
const sideOpen = ref(['state', 'memory'])

// ---- 回到最新消息：滚动跟随 + 浮动按钮 ----
const chatBodyRef = ref<HTMLElement | null>(null)
const nearBottom = ref(true)
const unreadCount = ref(0)
const SCROLL_BOTTOM_THRESHOLD = 120
const showJumpButton = computed(() => store.messages.length > 0 && !nearBottom.value)

function isNearBottom(el: HTMLElement | null): boolean {
  if (!el) return true
  return el.scrollHeight - el.scrollTop - el.clientHeight < SCROLL_BOTTOM_THRESHOLD
}

function scrollChatToBottom(behavior: ScrollBehavior = 'smooth'): void {
  const el = chatBodyRef.value
  if (!el) return
  el.scrollTo({ top: el.scrollHeight, behavior })
}

function onChatScroll(): void {
  nearBottom.value = isNearBottom(chatBodyRef.value)
  if (nearBottom.value) unreadCount.value = 0
}

function jumpToLatest(): void {
  scrollChatToBottom('smooth')
  nearBottom.value = true
  unreadCount.value = 0
}

// 新消息行数变化：在底部则跟随滚动，已上滑则累计未读数并显示按钮
watch(
  () => store.messages.length,
  () => {
    nextTick(() => {
      if (isNearBottom(chatBodyRef.value)) {
        nearBottom.value = true
        unreadCount.value = 0
        scrollChatToBottom('auto')
      } else {
        unreadCount.value += 1
      }
    })
  }
)

// 流式内容更新（思考/正文/工具结果）时，若用户仍停留在底部则持续跟随
watch(
  () => store.messages,
  () => {
    if (isNearBottom(chatBodyRef.value)) scrollChatToBottom('auto')
  },
  { deep: true, flush: 'post' }
)

const ctx = reactive<{ current_state: string; current_label: string; states: AgentContext['states']; work_unit: string; memory_stats: AgentContext['memory_stats']; prereq: Record<string, boolean> }>({
  current_state: '', current_label: '', states: [], work_unit: '', memory_stats: { facts: 0, foreshadow: 0, characters: 0, summaries: 0 }, prereq: {},
})

const tips = ['帮我把这个灵感做成项目，先问我要素', '生成世界观构建设定', '生成人物塑造卡片', '生成大纲生成', '写第三章正文生成', '质量审查第一章']

const sessionMenuItems = computed<RowActionItem[]>(() => [
  { command: 'rename', label: '重命名会话', icon: 'Edit' },
  { command: 'refresh', label: '刷新列表', icon: 'Refresh' },
  { command: 'delete', label: '删除会话', icon: 'Delete', type: 'danger', divided: true, disabled: !store.currentSessionId },
])

function shortId(id: string): string { return id ? id.slice(0, 8) : '' }

function fmtTime(ts: number | string): string {
  const t = typeof ts === 'number' ? ts : Number(new Date(ts).getTime())
  const d = new Date(t)
  if (Number.isNaN(d.getTime())) return ''
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function stateColor(key: string): string {
  const map: Record<string, string> = { ideation: '#6366f1', worldview: '#4f46e5', characters: '#00b578', outline: '#ff9f43', writing: '#eb5757', review: '#ef4444', foreshadow: '#722ed1' }
  return map[key] || '#909399'
}

/** 判断是否为裸/空 JSON 对象（{"": ""}、{}、[]），此类内容对用户不可读，渲染时替换为占位文案 */
function isBareJsonContent(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  let value: any
  try {
    value = JSON.parse(t)
  } catch {
    return false
  }
  if (Array.isArray(value)) return value.length === 0
  if (value && typeof value === 'object') {
    const vals = Object.values(value)
    if (vals.length === 0) return true
    return vals.every((x) => x === null || x === undefined || String(x).trim() === '')
  }
  return false
}

function toChatMsg(records: AgentChatRecord[]): ChatMsg[] {
  const out: ChatMsg[] = []
  let lastTool: ChatMsg | null = null
  // 暂存工具调用前的 thought：遇到工具结果时先作为独立的 thinking 气泡展示（与实时渲染一致）
  let pendingThought: { text: string; ts?: string } | null = null
  const flushThought = (): void => {
    if (pendingThought) {
      if (pendingThought.text.trim()) out.push({ role: 'assistant', content: pendingThought.text, ts: pendingThought.ts })
      pendingThought = null
    }
  }
  const takeThought = (): { text: string; ts?: string } => {
    const t = pendingThought ?? { text: '', ts: undefined }
    pendingThought = null
    return t
  }
  for (const r of records) {
    const ts = r.timestamp ? String(r.timestamp) : undefined
    if (r.role === 'user') {
      const content = r.content ?? ''
      const toolMatch = content.match(/^工具\s+([^\s:：]+?)(?:\s*执行结果)?[：:]\s*/)
      if (toolMatch) {
        const thought = takeThought()
        if (thought.text.trim()) out.push({ role: 'thinking', content: thought.text, ts: thought.ts ?? ts })
        const obs = content.replace(/^工具\s+[^\s:：]+?(?:\s*执行结果)?[：:]\s*/, '')
        out.push({ role: 'tool', content: '', steps: [{ thought: '', tool_name: toolMatch[1]!, tool_args: {}, observation: obs, is_final: false }], ts })
      } else if (content.startsWith('作者的选择：')) {
        const thought = takeThought()
        if (thought.text.trim()) out.push({ role: 'thinking', content: thought.text, ts: thought.ts ?? ts })
        out.push({ role: 'tool', content: '', steps: [{ thought: '', tool_name: 'ask_user', tool_args: {}, observation: content, is_final: false }], ts })
      } else {
        flushThought()
        out.push({ role: 'user', content, ts })
      }
      lastTool = null
    } else if (r.role === 'assistant') {
      const content = r.content ?? ''
      if (r.function_call) {
        const thought = takeThought()
        if (thought.text.trim()) out.push({ role: 'thinking', content: thought.text, ts: thought.ts ?? ts })
        lastTool = { role: 'tool', content: '', steps: [{ thought: '', tool_name: String(r.function_call.name ?? ''), tool_args: parseToolArgs(r.function_call), observation: '', is_final: false }], ts }
        out.push(lastTool)
      } else if (content.trim()) {
        // 检查是否是 JSON 格式的响应（Agent 输出协议：{"thought":"...","tool_call":...,"done":...}）
        let actualContent = content
        try {
          const parsed = parseAgentJsonfc(content)
          if (parsed) {
            actualContent = parsed.thought || ''
            if (parsed.tool_call && parsed.tool_call.name) {
              const th = takeThought()
              if (th.text.trim()) out.push({ role: 'thinking', content: th.text, ts: th.ts ?? ts })
              lastTool = { role: 'tool', content: '', steps: [{ thought: actualContent, tool_name: String(parsed.tool_call.name), tool_args: parsed.tool_call.arguments || {}, observation: '', is_final: false }], ts }
              out.push(lastTool)
              actualContent = ''
            }
          }
        } catch {
          // 不是 JSON，保持原样
        }
        if (actualContent.trim()) {
          if (isBareJsonContent(actualContent)) {
            actualContent = '（本轮输出未完成，请继续发送消息）'
          }
          pendingThought = { text: actualContent, ts }
        }
      }
    } else if (r.role === 'function' && lastTool && lastTool.steps?.length) {
      lastTool.steps[0].observation = r.content ?? ''
    }
  }
  flushThought()
  return out
}

/** 流式进行中且没有空思考气泡时，显示"Agent 运行中"指示器（覆盖工具执行/回复阶段） */
const showStreamingIndicator = computed(() => store.streaming && !store.messages.some((m) => m.role === 'thinking' && !m.content))

function parseToolArgs(fc: Record<string, any>): Record<string, any> {
  const raw = fc.arguments
  if (raw && typeof raw === 'string') { try { return JSON.parse(raw) } catch { return { raw } } }
  return raw && typeof raw === 'object' ? raw : {}
}

/**
 * 解析 Agent 协议 JSON（{"thought","tool_call","done"}）。
 * 模型偶尔会输出重复键的畸形 JSON（如两个 thought、两个 tool_call），
 * JSON.parse 会保留最后一个键值对，导致真实的 tool_call 被 null 覆盖。
 * 这里按"取第一个出现的字段值"处理，与后端 parseJsonfc 保持一致。
 */
function parseAgentJsonfc(content: string): { thought: string; tool_call: Record<string, any> | null; done: boolean } | null {
  if (!content) return null
  const start = content.indexOf('{')
  const end = content.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  const json = content.slice(start, end + 1)

  const thoughtVals = topLevelFieldValues(json, 'thought')
  const toolVals = topLevelFieldValues(json, 'tool_call')
  const doneVals = topLevelFieldValues(json, 'done')
  if (thoughtVals.length === 0 && toolVals.length === 0 && doneVals.length === 0) return null

  const thought = thoughtVals.find((v): v is string => typeof v === 'string' && v.trim() !== '') ?? ''
  const toolCallRaw = toolVals.find(
    (v): v is { name?: unknown; arguments?: unknown } => !!v && typeof v === 'object' && !Array.isArray(v) && typeof (v as { name?: unknown }).name === 'string'
  )
  const done = doneVals.find((v): v is boolean => typeof v === 'boolean') ?? false
  return { thought, tool_call: toolCallRaw ?? null, done }
}

/** 扫描一段 JSON 对象文本，返回指定顶层键的"所有出现"值（按出现顺序，容忍重复键）。 */
function topLevelFieldValues(json: string, key: string): unknown[] {
  const values: unknown[] = []
  const n = json.length
  let depth = 0
  let i = 0
  while (i < n) {
    const ch = json[i]
    if (ch === '"') {
      let j = i + 1
      while (j < n) {
        if (json[j] === '\\') { j += 2; continue }
        if (json[j] === '"') break
        j++
      }
      const token = json.slice(i + 1, j)
      let c = j + 1
      while (c < n && (json[c] === ' ' || json[c] === '\t' || json[c] === '\n' || json[c] === '\r')) c++
      if (depth === 1 && c < n && json[c] === ':' && token === key) {
        let v = c + 1
        while (v < n && (json[v] === ' ' || json[v] === '\t' || json[v] === '\n' || json[v] === '\r')) v++
        const vEnd = scanJsonValueEnd(json, v)
        if (vEnd > v) {
          try { values.push(JSON.parse(json.slice(v, vEnd))) } catch { /* 单值解析失败则跳过 */ }
        }
        i = vEnd
        continue
      }
      i = j + 1
      continue
    }
    if (ch === '{' || ch === '[') { depth++; i++; continue }
    if (ch === '}' || ch === ']') { depth--; i++; continue }
    i++
  }
  return values
}

/** 返回从位置 v 开始的 JSON 值的结束位置（含结束字符），无法识别时返回 v。 */
function scanJsonValueEnd(json: string, v: number): number {
  const n = json.length
  const first = json[v]
  if (first === '{' || first === '[') {
    const close = first === '{' ? '}' : ']'
    let d = 0
    let inStr = false
    for (let i = v; i < n; i++) {
      const ch = json[i]
      if (inStr) {
        if (ch === '\\') { i++; continue }
        if (ch === '"') inStr = false
        continue
      }
      if (ch === '"') { inStr = true; continue }
      if (ch === first) d++
      else if (ch === close) { d--; if (d === 0) return i + 1 }
    }
  } else if (first === '"') {
    for (let i = v + 1; i < n; i++) {
      const ch = json[i]
      if (ch === '\\') { i++; continue }
      if (ch === '"') return i + 1
    }
  } else {
    let i = v
    while (i < n && !/[},\]\s]/.test(json[i])) i++
    return i
  }
  return v
}

/** 把当前会话的渲染现场（消息 + ask 卡片 + UI 瞬态 + 草稿）落盘到 localStorage */
function saveSnapshot(sessionId: string): void {
  if (!sessionId) return
  const meta = store.sessions.find((s) => s.id === sessionId)
  const snap: SessionSnapshot = {
    version: SESSION_SNAP_VERSION,
    savedAt: Date.now(),
    messages: store.messages,
    activeAsk: store.activeAsk,
    askState: { selectedOptions: store.selectedOptions, customAnswer: store.customAnswer, customOpen: store.customOpen },
    draft: input.value,
    state: meta?.state ?? '',
  }
  snapshotToLocalStorage(projectId, sessionId, snap)
}

// ------------------------------------------------------------------
// 会话管理
// ------------------------------------------------------------------

async function loadSessions(): Promise<void> {
  store.sessionsLoading = true
  try {
    const { data } = await getAgentSessions(projectId)
    store.sessions = data.sessions
    const currentValid = store.currentSessionId && store.sessions.some((s) => s.id === store.currentSessionId)
    if (!currentValid) {
      const next = store.sessions[0]
      if (next) {
        store.currentSessionId = next.id
        rememberSession(projectId, next.id)
        await loadSessionMessages(next.id)
      } else {
        store.currentSessionId = ''
        store.loadedSessionId = ''
        store.messages = []
        store.activeAsk = null
        forgetSession(projectId)
      }
    }
  } catch (err: any) {
    ElMessage.error(err?.response?.data?.error || '加载会话失败')
  } finally {
    store.sessionsLoading = false
  }
}

async function loadSessionMessages(sessionId: string): Promise<void> {
  store.chatLoading = true
  // 1) 用本地渲染快照恢复"一模一样"（消息 + ask 卡片 + UI 瞬态 + 输入框草稿）
  const snap = snapshotFromLocalStorage(projectId, sessionId)
  if (snap) {
    store.messages = snap.messages.filter((m) => !(m.role === 'thinking' && !m.content))
    store.activeAsk = snap.activeAsk
    store.selectedOptions = snap.askState?.selectedOptions ?? []
    store.customAnswer = snap.askState?.customAnswer ?? ''
    store.customOpen = snap.askState?.customOpen ?? false
    input.value = snap.draft ?? ''
  } else {
    store.messages = []
    store.activeAsk = null
    store.selectedOptions = []
    store.customAnswer = ''
    store.customOpen = false
    input.value = ''
  }
  // 2) 后端权威消息校正（重建渲染，避免本地快照残留不完整状态；保留 ask 瞬态）
  try {
    const { data } = await getAgentSessionMessages(projectId, sessionId)
    const restored = toChatMsg(data.messages)
    if (restored.length > 0) {
      const keepAskState = { selectedOptions: store.selectedOptions, customAnswer: store.customAnswer, customOpen: store.customOpen }
      store.messages = restored
      store.selectedOptions = keepAskState.selectedOptions
      store.customAnswer = keepAskState.customAnswer
      store.customOpen = keepAskState.customOpen
    }
    store.loadedSessionId = sessionId
  } catch (err: any) {
    ElMessage.error(err?.response?.data?.error || '加载会话消息失败')
  } finally {
    store.chatLoading = false
  }
  // 3) 后端待答问题兜底（现在跨重启可靠）
  await restorePendingAsk(sessionId)
  // 4) 加载完成后回到最新消息
  nextTick(() => scrollChatToBottom('auto'))
}

async function restorePendingAsk(sessionId: string): Promise<void> {
  try {
    const { data } = await getAgentPendingAsk(projectId, sessionId)
    if (data.has_pending && data.question) {
      const sameQuestion = store.activeAsk && store.activeAsk.question === data.question.question
      if (!sameQuestion) {
        store.activeAsk = data.question
        store.customAnswer = ''
        store.selectedOptions = []
        store.customOpen = false
      }
      // ask 挂起中：最后一条 assistant 是 ask 前的思考，还原为紫色 thinking 气泡（与实时渲染一致）
      const lastMsg = store.messages[store.messages.length - 1]
      if (lastMsg && lastMsg.role === 'assistant') lastMsg.role = 'thinking'
    } else {
      // 后端已无等待中的问题：清除本地可能残留的过期 ask 卡片（如已超时自动回答）
      store.activeAsk = null
      store.customAnswer = ''
      store.selectedOptions = []
      store.customOpen = false
    }
  } catch { /* 忽略 */ }
}

async function refreshSessionMeta(): Promise<void> {
  try {
    const { data } = await getAgentSessions(projectId)
    store.sessions = data.sessions
  } catch { /* 忽略 */ }
}

async function onSessionSelect(id: string): Promise<void> {
  if (!id || id === store.loadedSessionId) return
  if (store.loadedSessionId && store.messages.length > 0) {
    saveSnapshot(store.loadedSessionId)
  }
  store.currentSessionId = id
  rememberSession(projectId, id)
  await loadSessionMessages(id)
  await loadContext()
}

async function newSession(): Promise<void> {
  if (store.streaming || store.activeAsk) { ElMessage.warning('请先完成当前生成'); return }
  try {
    const { data } = await createAgentSession(projectId, { state: ctx.current_state || undefined })
    if (store.loadedSessionId && store.messages.length > 0) {
      saveSnapshot(store.loadedSessionId)
    }
    store.sessions.push(data)
    store.currentSessionId = data.id
    store.loadedSessionId = data.id
    rememberSession(projectId, data.id)
    store.messages = []
    store.activeAsk = null
    store.selectedOptions = []
    store.customAnswer = ''
    store.customOpen = false
    input.value = ''
    ElMessage.success('已创建新会话')
    await loadContext()
  } catch (err: any) { ElMessage.error(err?.response?.data?.error || '创建会话失败') }
}

async function onSessionMenuCommand(cmd: string): Promise<void> {
  if (cmd === 'refresh') { await loadSessions(); return }
  if (cmd === 'rename') { await renameCurrentSession(); return }
  if (cmd === 'delete') { await removeCurrentSession() }
}

async function renameCurrentSession(): Promise<void> {
  if (!store.currentSessionId) return
  const meta = store.sessions.find((s: any) => s.id === store.currentSessionId)
  try {
    const { value } = await ElMessageBox.prompt('输入会话名称', '重命名会话', { inputValue: meta?.title ?? '', confirmButtonText: '保存', cancelButtonText: '取消', inputValidator: (v: string) => (v.trim() ? true : '名称不能为空') })
    const { data } = await renameAgentSession(projectId, store.currentSessionId, value.trim())
    const idx = store.sessions.findIndex((s) => s.id === data.id)
    if (idx >= 0) store.sessions[idx] = data
    ElMessage.success('会话已重命名')
  } catch { /* 用户取消 */ }
}

async function removeCurrentSession(): Promise<void> {
  if (store.streaming) { ElMessage.warning('正在生成中，请稍后再删除'); return }
  if (!store.currentSessionId) return
  const removedId = store.currentSessionId
  const meta = store.sessions.find((s: any) => s.id === removedId)
  try { await ElMessageBox.confirm(`确定删除会话「${meta?.title ?? ''}」？其中的对话记录将不可恢复。`, '删除会话', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }) } catch { return }
  try {
    await deleteAgentSession(projectId, removedId)
    clearLocalSnapshot(projectId, removedId)
    store.sessions = store.sessions.filter((s: any) => s.id !== removedId)
    const next = store.sessions[0]
    if (next) { store.currentSessionId = next.id; rememberSession(projectId, next.id); await loadSessionMessages(next.id); await loadContext() }
    else { store.currentSessionId = ''; store.loadedSessionId = ''; store.messages = []; store.activeAsk = null; store.selectedOptions = []; store.customAnswer = ''; store.customOpen = false; input.value = ''; forgetSession(projectId) }
    ElMessage.success('会话已删除')
  } catch (err: any) { ElMessage.error(err?.response?.data?.error || '删除失败') }
}

// ------------------------------------------------------------------
// Agent 上下文与对话
// ------------------------------------------------------------------

async function loadContext() {
  try {
    const res = await getAgentContext(projectId, store.currentSessionId ?? undefined)
    ctx.current_state = res.data.current_state
    ctx.current_label = res.data.current_label
    ctx.states = res.data.states
    ctx.work_unit = res.data.work_unit
    ctx.memory_stats = res.data.memory_stats
    ctx.prereq = res.data.prereq
  } catch (err: any) { ElMessage.error(err?.response?.data?.error || '加载 Agent 上下文失败') }
}

async function switchState(key: string) {
  if (key === ctx.current_state) return
  try {
    await agentSwitchState(projectId, key, undefined, store.currentSessionId ?? undefined)
    ctx.current_state = key
    const s = ctx.states.find((x) => x.key === key)
    ctx.current_label = s?.label ?? key
    ElMessage.success(`已切换到 ${ctx.current_label}`)
  } catch (err: any) { ElMessage.error(err?.response?.data?.error || '切换失败') }
}

function quickSend(tip: string) { input.value = tip; send() }

/** 停止当前生成：通知后端中断本轮，流式端会收到 aborted 事件 */
async function stop(): Promise<void> {
  if (!store.streaming || !store.currentSessionId || stopping.value) return
  const sessionId = store.currentSessionId
  stopping.value = true
  try {
    await agentTurnStop(projectId, sessionId)
  } catch (err: any) {
    ElMessage.error(err?.response?.data?.message || err?.message || '发送停止指令失败')
  } finally {
    // 后端可能已提前结束流式并发送 aborted；停止请求本身很快返回
    setTimeout(() => { stopping.value = false }, 800)
  }
}

async function send() {
  const text = input.value.trim()
  if (!text || store.streaming || store.activeAsk || !store.currentSessionId) return
  const sessionId = store.currentSessionId
  input.value = ''
  store.messages.push({ role: 'user', content: text, ts: Date.now() })
  store.messages.push({ role: 'thinking', content: '', ts: Date.now() })

  let thinkingMsg: ChatMsg | null = store.messages[store.messages.length - 1] as ChatMsg
  store.streaming = true
  let assistantText = ''

  const closeThinking = (): void => {
    if (!thinkingMsg) return
    if (!thinkingMsg.content) { const idx = store.messages.indexOf(thinkingMsg); if (idx >= 0) store.messages.splice(idx, 1) }
    else { thinkingMsg.role = 'thinking' }
    thinkingMsg = null
  }
  const ensureThinking = (): ChatMsg => {
    if (thinkingMsg) return thinkingMsg
    store.messages.push({ role: 'thinking', content: '', ts: Date.now() })
    thinkingMsg = store.messages[store.messages.length - 1] as ChatMsg
    return thinkingMsg
  }

  try {
    for await (const evt of agentTurnStream(projectId, text, sessionId)) {
      if (evt.type === 'thinking') { ensureThinking().content += evt.data }
      else if (evt.type === 'step') {
        if (evt.data.tool_name) { closeThinking(); store.messages.push({ role: 'tool', content: '', steps: [evt.data], ts: Date.now() }) }
        else if (evt.data.is_final) { assistantText = evt.data.thought }
      } else if (evt.type === 'chunk') { assistantText += evt.data }
      else if (evt.type === 'ask') {
        closeThinking()
        // ask 卡片行自带“调用工具 · ask_user”气泡，移除 step 事件创建的空工具气泡，避免重复
        const lastMsg = store.messages[store.messages.length - 1] as ChatMsg | undefined
        if (lastMsg && lastMsg.role === 'tool' && lastMsg.steps?.[0]?.tool_name === 'ask_user' && !lastMsg.steps[0].observation) store.messages.pop()
        store.activeAsk = evt.data; store.customAnswer = ''; store.selectedOptions = []; store.customOpen = false; saveSnapshot(sessionId)
      }
      else if (evt.type === 'done') {
        const result = evt.data
        if (!assistantText && result.reply) assistantText = result.reply
        if (evt.data.is_done) assistantText = assistantText || result.reply
        if (result.error) ElMessage.error(result.error)
        store.activeAsk = null; store.selectedOptions = []; store.customAnswer = ''; store.customOpen = false
      }
      else if (evt.type === 'aborted') {
        // 生成被中断：保留已完成进度，清空半截思考/回复，追加提示
        closeThinking()
        store.activeAsk = null; store.selectedOptions = []; store.customAnswer = ''; store.customOpen = false
        if (!assistantText.trim()) {
          store.messages.push({ role: 'note', content: '⏹ 生成已中断，已保留已有进度，你可以继续输入消息让它基于已有进度续接', ts: Date.now() })
        }
        assistantText = ''
      }
      else if (evt.type === 'error') { ElMessage.error(evt.data.error || 'Agent 执行出错'); store.activeAsk = null; store.selectedOptions = []; store.customAnswer = ''; store.customOpen = false }
    }
  } catch (err: any) { ElMessage.error(err?.message || '请求失败') }
  finally {
    store.streaming = false
    // 最终回复直接渲染为正式回复气泡，不再依赖后端延迟重载（重载失败会丢消息），
    // 并避免与思考气泡重复：当前思考气泡已含完整回复时升级为 assistant，否则新建。
    const finalText = (assistantText || thinkingMsg?.content || '').trim()
    if (finalText) {
      if (thinkingMsg && thinkingMsg.content && thinkingMsg.content.trim()) {
        thinkingMsg.role = 'assistant'
        thinkingMsg.content = finalText
        thinkingMsg.ts = Date.now()
      } else {
        closeThinking()
        store.messages.push({ role: 'assistant', content: finalText, ts: Date.now() })
      }
      thinkingMsg = null
    } else {
      closeThinking()
    }
    saveSnapshot(sessionId)
    // 重载后端消息以校正工具气泡与顺序（覆盖式替换，不会重复追加）
    setTimeout(() => loadSessionMessages(sessionId).catch(() => {}), 500)
    await loadContext(); await refreshSessionMeta()
  }
}

/** ask 回答提交后的统一处理：正常时推本地工具气泡；服务重启降级（restart）时把回答作为新 turn 重新发起 SSE */
async function afterAskAnswer(sessionId: string, answer: string, data: any): Promise<void> {
  if (data && data.restart && !data.resumed) {
    // Agent 进程已重启、内存等待器丢失：把回答作为新消息重新发起生成（走 /turn/stream 流式），
    // 后端 runTurn 会把该消息写入会话历史，Agent 基于历史继续推进，不再重复落盘。
    input.value = '作者的选择：' + answer
    await send()
    return
  }
  store.messages.push({ role: 'tool', content: '', steps: [{ thought: '', tool_name: 'ask_user', tool_args: {}, observation: '作者的选择：' + answer, is_final: false }], ts: Date.now() })
  if (!store.streaming) { setTimeout(() => loadSessionMessages(sessionId).catch(() => {}), 2000); setTimeout(() => loadSessionMessages(sessionId).catch(() => {}), 12000) }
}

async function submitMultiple() {
  if (!store.activeAsk || store.selectedOptions.length === 0 || !store.currentSessionId) return
  const answer = store.selectedOptions.join('，')
  const sessionId = store.currentSessionId
  let data: any
  try { data = (await agentAnswer(projectId, answer, sessionId)).data }
  catch (err: any) { ElMessage.error(err?.response?.data?.message || '提交失败'); return }
  store.activeAsk = null; store.customAnswer = ''; store.selectedOptions = []; store.customOpen = false
  saveSnapshot(sessionId)
  await afterAskAnswer(sessionId, answer, data)
}

function isSelected(opt: string): boolean { return store.selectedOptions.includes(opt) }

/** 自定义回答选项的标记文案（与后端 AskResolver 保持一致）：点击它打开自定义输入，而非作为普通选项提交 */
const ASK_CUSTOM_OPTION = '✏️ 自定义回答…'

function pickOption(opt: string): void {
  if (!store.activeAsk) return
  // 工单 14：自定义回答选项不参与选中/提交，点击改为打开/收起输入框
  if (opt === ASK_CUSTOM_OPTION) {
    store.customOpen = !store.customOpen
    saveSnapshot(store.currentSessionId)
    return
  }
  if (store.activeAsk.multiple) { const i = store.selectedOptions.indexOf(opt); if (i >= 0) store.selectedOptions.splice(i, 1); else store.selectedOptions.push(opt); saveSnapshot(store.currentSessionId) }
  else { answerAsk(opt) }
}

function submitCustom(): void {
  if (!store.activeAsk) return
  const text = store.customAnswer.trim()
  if (!text) return
  if (store.activeAsk.multiple) { if (!store.selectedOptions.includes(text)) store.selectedOptions.push(text); store.customAnswer = ''; store.customOpen = false; saveSnapshot(store.currentSessionId) }
  else { answerAsk(text) }
}

async function answerAsk(answer: string) {
  if (!store.activeAsk || !store.currentSessionId) return
  const sessionId = store.currentSessionId
  let data: any
  try { data = (await agentAnswer(projectId, answer, sessionId)).data }
  catch (err: any) { ElMessage.error(err?.response?.data?.message || '提交失败'); return }
  store.activeAsk = null; store.customAnswer = ''; store.selectedOptions = []; store.customOpen = false
  saveSnapshot(sessionId)
  await afterAskAnswer(sessionId, answer, data)
}

// ------------------------------------------------------------------
// 生命周期
// ------------------------------------------------------------------

// 输入草稿自动保存（防抖 300ms）：任意时刻切页/刷新都不丢失
let draftTimer: ReturnType<typeof setTimeout> | null = null
watch(input, () => {
  if (!store.currentSessionId || store.streaming || store.activeAsk) return
  if (draftTimer) clearTimeout(draftTimer)
  draftTimer = setTimeout(() => {
    saveSnapshot(store.currentSessionId)
  }, 300)
})

onMounted(async () => {
  await loadContext()
  await loadSessions()
  if (store.currentSessionId && store.loadedSessionId !== store.currentSessionId) {
    await loadSessionMessages(store.currentSessionId)
  }
  // 重挂载（切页返回）时内存消息仍在但 input 是新空 ref：
  // 无条件从本地快照恢复输入框草稿，保证切换页面后输入不丢失
  if (store.currentSessionId) {
    const snap = snapshotFromLocalStorage(projectId, store.currentSessionId)
    if (snap) input.value = snap.draft ?? ''
  }
})

onUnmounted(() => {
  if (draftTimer) clearTimeout(draftTimer)
  if (store.loadedSessionId) {
    saveSnapshot(store.loadedSessionId)
  }
})
</script>
<style scoped>
.agent-view { display: flex; flex-direction: column; height: calc(100vh - 120px); }
.agent-page { display: flex; gap: 16px; flex: 1; min-height: 0; }

/* ---------- 对话主区 ---------- */
.agent-chat {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  position: relative;
  background: #fff;
  border: 1px solid var(--border-color-light);
  border-radius: 12px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
  overflow: hidden;
}
.session-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-color-light);
  background: linear-gradient(90deg, #fafafa 0%, #ffffff 100%);
  flex-wrap: wrap;
  flex-shrink: 0;
}
.session-left { display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1; }
.session-icon { color: var(--app-primary); font-size: 18px; flex-shrink: 0; }
.session-current-id { font-size: 11px; color: var(--text-placeholder); flex-shrink: 0; cursor: default; }
.session-select { width: 300px; max-width: 100%; }
.session-actions { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
.session-opt { display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%; }
.so-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.so-id { font-size: 11px; color: var(--text-placeholder); flex-shrink: 0; }
.so-count { font-size: 12px; color: var(--text-secondary); flex-shrink: 0; }

.chat-body { flex: 1; min-height: 0; overflow-y: auto; padding: 18px 20px; }
.chat-body::-webkit-scrollbar { width: 6px; }
.chat-body::-webkit-scrollbar-thumb { background: #d8dee8; border-radius: 3px; }

/* ---------- 回到最新消息（微信式浮动按钮） ---------- */
.jump-latest {
  position: absolute;
  right: 18px;
  bottom: 96px;
  z-index: 20;
  cursor: pointer;
  user-select: none;
}
.jump-circle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: #fff;
  border: 1px solid #e2e8f5;
  box-shadow: 0 4px 14px rgba(79, 70, 229, 0.18);
  color: #4f46e5;
  font-size: 18px;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}
.jump-circle:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 18px rgba(79, 70, 229, 0.28);
}
.jump-badge { display: block; }
.jump-fade-enter-active, .jump-fade-leave-active { transition: opacity 0.2s ease, transform 0.2s ease; }
.jump-fade-enter-from, .jump-fade-leave-to { opacity: 0; transform: translateY(8px); }

/* ---------- 消息行 ---------- */
.msg-row { margin-bottom: 12px; display: flex; align-items: flex-start; gap: 10px; }
.msg-row.user { flex-direction: row-reverse; }
.msg-avatar {
  width: 32px; height: 32px; border-radius: 50%; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center; font-size: 15px;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.1);
}
.msg-row.user .msg-avatar { background: linear-gradient(135deg, #6366f1, #4f46e5); color: #fff; }
.msg-row.assistant .msg-avatar, .msg-row.tool .msg-avatar { background: linear-gradient(135deg, #4f46e5, #4f46e5); color: #fff; }
.msg-row.thinking .msg-avatar { background: linear-gradient(135deg, #4f46e5, #4f46e5); color: #fff; }
.msg-bubble { max-width: 76%; padding: 9px 14px; border-radius: 12px; font-size: 14px; line-height: 1.65; word-break: break-word; }
.msg-row.assistant .msg-bubble { background: linear-gradient(180deg, #F7F9FF 0%, #EDF1FC 100%); border: 1px solid #E2E8F5; border-top-left-radius: 4px; box-shadow: 0 2px 10px rgba(79, 70, 229, 0.10); padding: 12px 16px; }
.msg-row.user .msg-bubble { background: linear-gradient(135deg, #6366f1, #4f46e5); color: #fff; border-top-right-radius: 4px; }
.msg-row.tool .msg-bubble { background: #fafafa; border: 1px dashed #e4e4e7; padding: 8px 12px; max-width: 70%; }
.msg-row.thinking .msg-bubble { background: #eef2ff; border: 1px solid #e0e7ff; padding: 8px 12px; max-width: 70%; }
.msg-md { word-break: break-word; }
.msg-md.markdown-view { min-height: 0; }
.msg-md :deep(.markdown-body) { font-size: 14px; line-height: 1.65; color: var(--text-primary); }
.msg-md :deep(.markdown-body p) { margin: 4px 0; }
.msg-md :deep(.markdown-body h1) { font-size: 18px; margin: 12px 0 8px; padding-bottom: 5px; }
.msg-md :deep(.markdown-body h2) { font-size: 16px; margin: 10px 0 6px; padding-bottom: 4px; }
.msg-md :deep(.markdown-body h3) { font-size: 15px; margin: 10px 0 6px; }
.msg-md :deep(.markdown-body h4) { font-size: 14px; margin: 8px 0 4px; }
.msg-md :deep(.markdown-body ul), .msg-md :deep(.markdown-body ol) { margin: 6px 0; padding-left: 20px; }
.msg-md :deep(.markdown-body li) { margin: 2px 0; }
.msg-md :deep(.markdown-body blockquote) { margin: 8px 0; padding: 6px 12px; }
.msg-md :deep(.markdown-body code) { font-size: 13px; }
.msg-md :deep(.markdown-body pre) { padding: 10px 12px; margin: 8px 0; }
.msg-text { white-space: pre-wrap; }
.msg-row.note { justify-content: center; margin-bottom: 10px; }
.note-time { font-size: 11px; color: var(--text-placeholder); margin-left: 8px; }
.msg-time { font-size: 11px; line-height: 1.2; color: var(--text-placeholder); margin-top: 4px; text-align: right; }
.msg-row.user .msg-time { color: rgba(255, 255, 255, 0.75); }
.msg-note {
  font-size: 12px; line-height: 1.6; color: var(--text-secondary);
  background: #f5f5f7; border: 1px solid var(--border-color-light);
  border-radius: 999px; padding: 4px 12px; max-width: 85%; word-break: break-word;
}

/* ---------- 思考气泡 ---------- */
.think-head { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; color: #4f46e5; margin-bottom: 4px; }
.think-text { font-size: 12px; color: var(--text-secondary); white-space: pre-wrap; max-height: 160px; overflow-y: auto; }
.think-empty { animation: think-pulse 1.2s ease-in-out infinite; }
@keyframes think-pulse { 0%, 100% { opacity: .55; } 50% { opacity: 1; } }
.think-spinner {
  width: 13px; height: 13px; flex-shrink: 0;
  border: 2px solid #c7d2fe; border-top-color: #6366f1; border-right-color: #6366f1;
  border-radius: 50%; display: inline-block;
  animation: think-rotate 0.7s linear infinite;
}
.think-spinner-sm { width: 11px; height: 11px; border-width: 1.5px; }
@keyframes think-rotate { to { transform: rotate(360deg); } }

/* ---------- 工具气泡 ---------- */
.tool-bubbles { display: flex; flex-direction: column; gap: 8px; }
.tool-bubble { border-left: 3px solid #c7d2fe; padding-left: 10px; }
.tool-head { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.tool-icon { color: #6366f1; flex-shrink: 0; font-size: 14px; }
.tool-name { font-size: 12px; font-weight: 600; color: var(--text-primary); }
.tool-running { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; color: #4f46e5; font-weight: 500; }
.tool-done-tag { font-size: 11px; }
.tool-obs-block { margin-top: 6px; }
.tool-obs-label { font-size: 11px; font-weight: 600; color: var(--text-aux); margin-bottom: 3px; }
.tool-obs {
  font-size: 12px; color: var(--text-secondary); white-space: pre-wrap; word-break: break-word;
  max-height: 120px; overflow-y: auto; background: #fff; border: 1px solid var(--border-color-light);
  border-radius: 8px; padding: 8px 10px; line-height: 1.6;
}

/* ---------- Agent 运行中指示器 ---------- */
.streaming-indicator .msg-bubble {
  display: inline-flex; align-items: center; gap: 8px;
  background: #eef2ff; border: 1px solid #e0e7ff; border-top-left-radius: 4px;
  padding: 9px 14px;
}
.streaming-label { font-size: 13px; color: #4f46e5; font-weight: 500; }

/* ---------- ask 选择卡片 ---------- */
.ask-card { border: 1px solid #6366f1; border-radius: 12px; padding: 14px 16px; margin-bottom: 14px; background: #eef2ff; }
.msg-row.ask-row .msg-bubble { background: transparent; border: none; padding: 0; max-width: 85%; }
.msg-row.ask-row .ask-card { margin-bottom: 0; }
.ask-head { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.ask-icon { color: #6366f1; font-size: 16px; flex-shrink: 0; }
.ask-title { font-weight: 600; flex: 1; }
.ask-options { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; }
.ask-options .el-button + .el-button { margin-left: 0; }
.opt-checked { box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.35); }
.opt-custom { border-style: dashed !important; color: #8a6d3b !important; }
.ask-custom, .ask-custom-solo { display: flex; gap: 8px; margin-bottom: 10px; }
.ask-multi-bar {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  margin-top: 4px; padding: 8px 12px; border-radius: 8px; background: #f5f5f7;
}
.multi-picked { font-size: 12px; color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* ---------- 输入区 ---------- */
.chat-input-area {
  display: flex; gap: 10px; align-items: flex-end;
  padding: 12px 16px;
  border-top: 1px solid var(--border-color-light);
  background: #fafafa;
  flex-shrink: 0;
}
.suggest-chips { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; }
.chip { cursor: pointer; }

/* ---------- 右侧上下文 ---------- */
.agent-side {
  width: 320px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  flex-shrink: 0;
  min-height: 0;
  overflow-y: auto;
}
.side-collapse {
  width: 100%;
  background: #fff;
  border: 1px solid var(--border-color-light);
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
}
.side-collapse :deep(.el-collapse-item__header) {
  background: linear-gradient(90deg, #fafafa 0%, #ffffff 100%);
  border-bottom: 1px solid var(--border-color-light);
  height: 44px; line-height: 44px; padding: 0 14px;
}
.side-collapse :deep(.el-collapse-item__wrap) { border-bottom: none; }
.side-collapse :deep(.el-collapse-item__content) { padding: 14px 16px 16px; }
.collapse-title {
  display: flex; align-items: center; gap: 8px;
  font-size: 14px; font-weight: 600; color: var(--text-primary);
}
.collapse-title .el-icon { color: #6366f1; font-size: 16px; }
.collapse-count {
  margin-left: auto;
  font-size: 11px; font-weight: 500;
  background: #eef2ff; color: #4f46e5;
  padding: 1px 8px; border-radius: 999px;
}

.current-state {
  border: 1.5px solid #6366f1; border-radius: 10px;
  padding: 12px; text-align: center; margin-bottom: 12px;
  background: #fafcff;
}
.cs-label { font-size: 17px; font-weight: 700; }
.cs-key { font-size: 11px; color: var(--text-placeholder); margin-top: 2px; }
.state-switch { display: flex; flex-wrap: wrap; gap: 6px; }
.state-chip {
  font-size: 12px; padding: 4px 10px; border-radius: 999px;
  background: #f5f5f7; cursor: pointer; border: 1px solid var(--border-color-light);
  transition: all 0.15s;
}
.state-chip:hover { border-color: #6366f1; color: #6366f1; }
.state-chip.on { background: #6366f1; color: #fff; border-color: #6366f1; }
.state-chip.off { opacity: 0.45; cursor: not-allowed; }
.work-unit {
  margin-top: 10px; font-size: 13px; color: var(--text-secondary);
  background: #f5f5f7; border-radius: 8px; padding: 6px 10px;
}
.mem-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
.mem { display: flex; flex-direction: column; align-items: center; gap: 2px; font-size: 12px; color: var(--text-secondary); }
.mem .n { font-size: 18px; font-weight: 700; color: var(--app-primary); }
.prereq-item { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; font-size: 13px; color: var(--text-secondary); }
</style>
