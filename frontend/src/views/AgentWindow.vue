<template>
  <div class="agent-page">
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

      <div v-loading="store.chatLoading" class="chat-body">
        <el-empty v-if="store.messages.length === 0 && !store.streaming && !store.chatLoading" description="与创作 Agent 对话：创意孵化、世界观生成、章纲、正文、审阅…" :image-size="90">
          <div class="suggest-chips">
            <el-tag v-for="tip in tips" :key="tip" class="chip" effect="plain" @click="quickSend(tip)">{{ tip }}</el-tag>
          </div>
        </el-empty>

        <div v-for="(m, idx) in store.messages" :key="idx" class="msg-row" :class="m.role">
          <div class="msg-avatar" v-if="m.role !== 'thinking' && m.role !== 'note'">
            <el-icon v-if="m.role === 'user'"><UserFilled /></el-icon>
            <el-icon v-else><MagicStick /></el-icon>
          </div>
          <div v-if="m.role === 'note'" class="msg-note">{{ m.content }}<span v-if="m.ts" class="note-time">{{ fmtTime(m.ts) }}</span></div>
          <div class="msg-bubble" v-else-if="m.role !== 'assistant' || !!m.content">
            <template v-if="m.role === 'thinking'">
              <div class="think-head">💭 思考过程</div>
              <div class="think-text" :class="{ 'think-empty': !m.content }">{{ m.content || '正在思考…' }}</div>
              <div v-if="m.ts" class="msg-time">{{ fmtTime(m.ts) }}</div>
            </template>
            <template v-else-if="m.role === 'tool'">
              <div class="tool-cards">
                <div v-for="(line, li) in m.steps" :key="li" class="tool-card">
                  <el-icon class="tool-icon"><MagicStick /></el-icon>
                  <div class="tool-body">
                    <div class="tool-name" v-if="line.tool_name">调用工具 · {{ line.tool_name }}</div>
                    <div class="tool-obs" v-if="line.observation">{{ line.observation }}</div>
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
      </div>

      <div v-if="store.activeAsk" class="ask-card">
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
            :class="{ 'opt-checked': isSelected(opt) }"
            @click="pickOption(opt)"
          >{{ opt }}</el-button>
          <el-button
            size="small"
            class="opt-custom-toggle"
            :type="store.customOpen ? 'primary' : 'default'"
            :plain="!store.customOpen"
            @click="store.customOpen = !store.customOpen"
          >
            <el-icon><EditPen /></el-icon>
            <span>{{ store.customOpen ? '收起自定义' : '自定义输入' }}</span>
          </el-button>
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

      <div class="chat-input-area">
        <el-input v-model="input" type="textarea" :rows="2" placeholder="告诉 Agent 你想做什么…（回车发送，Shift+Enter 换行）" :disabled="store.streaming || !!store.activeAsk || !store.currentSessionId" @keydown.enter.prevent="send" />
        <el-button type="primary" :loading="store.streaming" :disabled="!input.trim() || !!store.activeAsk || !store.currentSessionId" @click="send">{{ store.streaming ? '生成中…' : '发送' }}</el-button>
      </div>
    </div>

    <div class="agent-side">
      <el-collapse v-model="sideOpen" class="group-collapse side-collapse">
        <el-collapse-item name="state">
          <template #title>
            <div class="collapse-title"><el-icon><Switch /></el-icon><span>当前创作状态</span><span class="collapse-count">{{ ctx.current_label || ctx.current_state }}</span></div>
          </template>
          <div class="current-state" :style="{ borderColor: stateColor(ctx.current_state) }">
            <div class="cs-label">{{ ctx.current_label || ctx.current_state }}</div>
            <div class="cs-key">{{ ctx.current_state }}</div>
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
            <div class="mem"><span class="n">{{ ctx.memory_stats?.characters ?? 0 }}</span><span>人物</span></div>
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
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import MarkdownView from '@/components/MarkdownView.vue'
import RowActions, { type RowActionItem } from '@/components/RowActions.vue'
import {
  getAgentContext, agentTurnStream, agentAnswer, agentSwitchState,
  getAgentSessions, createAgentSession, renameAgentSession, deleteAgentSession,
  getAgentSessionMessages, getAgentPendingAsk,
  type AgentContext, type AgentChatRecord,
} from '@/api'
import {
  useAgentSession, snapshotToSessionStorage, snapshotFromSessionStorage,
  clearSnapshot, rememberSession, forgetSession,
  type ChatMsg,
} from '@/stores/agentSession'

const route = useRoute()
const projectId = route.params.id as string
const store = useAgentSession(projectId)
const input = ref('')
const sideOpen = ref(['state', 'memory'])

const ctx = reactive<{ current_state: string; current_label: string; states: AgentContext['states']; work_unit: string; memory_stats: AgentContext['memory_stats']; prereq: Record<string, boolean> }>({
  current_state: '', current_label: '', states: [], work_unit: '', memory_stats: { facts: 0, foreshadow: 0, characters: 0, summaries: 0 }, prereq: {},
})

const tips = ['帮我把这个灵感做成项目，先问我要素', '生成世界观设定', '生成人物卡片', '生成章纲', '写第三章正文', '审阅第一章']

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
  const map: Record<string, string> = { ideation: '#4f8cff', worldview: '#6f5cff', characters: '#00b578', outline: '#ff9f43', writing: '#eb5757', review: '#f5222d', foreshadow: '#722ed1' }
  return map[key] || '#909399'
}

function toChatMsg(records: AgentChatRecord[]): ChatMsg[] {
  const out: ChatMsg[] = []
  let lastTool: ChatMsg | null = null
  for (const r of records) {
    const ts = r.timestamp ? String(r.timestamp) : undefined
    if (r.role === 'user') {
      const content = r.content ?? ''
      const toolMatch = content.match(/^工具\s+([^\s:：]+?)(?:\s*执行结果)?[：:]\s*/)
      if (toolMatch) {
        const obs = content.replace(/^工具\s+[^\s:：]+?(?:\s*执行结果)?[：:]\s*/, '')
        out.push({ role: 'tool', content: '', steps: [{ thought: '', tool_name: toolMatch[1]!, tool_args: {}, observation: obs, is_final: false }], ts })
      } else if (content.startsWith('作者的选择：')) {
        out.push({ role: 'tool', content: '', steps: [{ thought: '', tool_name: 'ask_user', tool_args: {}, observation: content, is_final: false }], ts })
      } else {
        out.push({ role: 'user', content, ts })
      }
      lastTool = null
    } else if (r.role === 'assistant') {
      if (r.function_call) {
        lastTool = { role: 'tool', content: '', steps: [{ thought: r.content ?? '', tool_name: String(r.function_call.name ?? ''), tool_args: parseToolArgs(r.function_call), observation: '', is_final: false }], ts }
        out.push(lastTool)
      } else {
        const content = r.content ?? ''
        if (content.trim()) out.push({ role: 'assistant', content, ts })
        lastTool = null
      }
    } else if (r.role === 'function' && lastTool && lastTool.steps?.length) {
      lastTool.steps[0].observation = r.content ?? ''
    }
  }
  return out
}

function parseToolArgs(fc: Record<string, any>): Record<string, any> {
  const raw = fc.arguments
  if (raw && typeof raw === 'string') { try { return JSON.parse(raw) } catch { return { raw } } }
  return raw && typeof raw === 'object' ? raw : {}
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
        await restorePendingAsk(next.id)
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
  store.activeAsk = null
  try {
    const cached = snapshotFromSessionStorage(projectId, sessionId)
    if (cached && cached.length > 0) store.messages = cached
    const { data } = await getAgentSessionMessages(projectId, sessionId)
    const restored = toChatMsg(data.messages)
    if (restored.length > 0 || store.messages.length === 0) store.messages = restored
    store.loadedSessionId = sessionId
  } catch (err: any) {
    ElMessage.error(err?.response?.data?.error || '加载会话消息失败')
  } finally {
    store.chatLoading = false
  }
}

async function restorePendingAsk(sessionId: string): Promise<void> {
  try {
    const { data } = await getAgentPendingAsk(projectId, sessionId)
    if (data.has_pending && data.question) {
      store.activeAsk = data.question
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
    snapshotToSessionStorage(projectId, store.loadedSessionId, store.messages)
  }
  store.currentSessionId = id
  rememberSession(projectId, id)
  await loadSessionMessages(id)
  await restorePendingAsk(id)
}

async function newSession(): Promise<void> {
  if (store.streaming || store.activeAsk) { ElMessage.warning('请先完成当前生成'); return }
  try {
    const { data } = await createAgentSession(projectId, { state: ctx.current_state || undefined })
    if (store.loadedSessionId && store.messages.length > 0) {
      snapshotToSessionStorage(projectId, store.loadedSessionId, store.messages)
    }
    store.sessions.push(data)
    store.currentSessionId = data.id
    store.loadedSessionId = data.id
    rememberSession(projectId, data.id)
    store.messages = []
    store.activeAsk = null
    ElMessage.success('已创建新会话')
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
    clearSnapshot(projectId, removedId)
    store.sessions = store.sessions.filter((s: any) => s.id !== removedId)
    const next = store.sessions[0]
    if (next) { store.currentSessionId = next.id; rememberSession(projectId, next.id); await loadSessionMessages(next.id); await restorePendingAsk(next.id) }
    else { store.currentSessionId = ''; store.loadedSessionId = ''; store.messages = []; store.activeAsk = null; forgetSession(projectId) }
    ElMessage.success('会话已删除')
  } catch (err: any) { ElMessage.error(err?.response?.data?.error || '删除失败') }
}

// ------------------------------------------------------------------
// Agent 上下文与对话
// ------------------------------------------------------------------

async function loadContext() {
  try {
    const res = await getAgentContext(projectId)
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
    await agentSwitchState(projectId, key)
    ctx.current_state = key
    const s = ctx.states.find((x) => x.key === key)
    ctx.current_label = s?.label ?? key
    ElMessage.success(`已切换到 ${ctx.current_label}`)
  } catch (err: any) { ElMessage.error(err?.response?.data?.error || '切换失败') }
}

function quickSend(tip: string) { input.value = tip; send() }

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
      else if (evt.type === 'ask') { closeThinking(); store.activeAsk = evt.data; store.customAnswer = ''; store.selectedOptions = []; store.customOpen = false }
      else if (evt.type === 'done') { const result = evt.data; if (!assistantText && result.reply) assistantText = result.reply; if (evt.data.is_done) assistantText = assistantText || result.reply; if (result.error) ElMessage.error(result.error) }
      else if (evt.type === 'error') { ElMessage.error(evt.data.error || 'Agent 执行出错') }
    }
  } catch (err: any) { ElMessage.error(err?.message || '请求失败') }
  finally {
    store.streaming = false; closeThinking()
    const finalText = assistantText.trim()
    if (finalText) store.messages.push({ role: 'assistant', content: finalText, ts: Date.now() })
    snapshotToSessionStorage(projectId, sessionId, store.messages)
    await loadContext(); await refreshSessionMeta()
  }
}

async function submitMultiple() {
  if (!store.activeAsk || store.selectedOptions.length === 0 || !store.currentSessionId) return
  const answer = store.selectedOptions.join('，')
  const sessionId = store.currentSessionId
  try { await agentAnswer(projectId, answer, sessionId); store.messages.push({ role: 'note', content: `已提交多选：${answer}`, ts: Date.now() }) }
  catch (err: any) { ElMessage.error(err?.response?.data?.message || '提交失败'); return }
  store.activeAsk = null; store.customAnswer = ''; store.selectedOptions = []; store.customOpen = false
  snapshotToSessionStorage(projectId, sessionId, store.messages)
  if (!store.streaming) { setTimeout(() => loadSessionMessages(sessionId).catch(() => {}), 2000); setTimeout(() => loadSessionMessages(sessionId).catch(() => {}), 12000) }
}

function isSelected(opt: string): boolean { return store.selectedOptions.includes(opt) }

function pickOption(opt: string): void {
  if (!store.activeAsk) return
  if (store.activeAsk.multiple) { const i = store.selectedOptions.indexOf(opt); if (i >= 0) store.selectedOptions.splice(i, 1); else store.selectedOptions.push(opt) }
  else { answerAsk(opt) }
}

function submitCustom(): void {
  if (!store.activeAsk) return
  const text = store.customAnswer.trim()
  if (!text) return
  if (store.activeAsk.multiple) { if (!store.selectedOptions.includes(text)) store.selectedOptions.push(text); store.customAnswer = ''; store.customOpen = false }
  else { answerAsk(text) }
}

async function answerAsk(answer: string) {
  if (!store.activeAsk || !store.currentSessionId) return
  const sessionId = store.currentSessionId
  try { await agentAnswer(projectId, answer, sessionId); store.messages.push({ role: 'note', content: `已提交选择：${answer}`, ts: Date.now() }) }
  catch (err: any) { ElMessage.error(err?.response?.data?.message || '提交失败'); return }
  store.activeAsk = null; store.customAnswer = ''; store.selectedOptions = []; store.customOpen = false
  snapshotToSessionStorage(projectId, sessionId, store.messages)
  if (!store.streaming) { setTimeout(() => loadSessionMessages(sessionId).catch(() => {}), 2000); setTimeout(() => loadSessionMessages(sessionId).catch(() => {}), 12000) }
}

// ------------------------------------------------------------------
// 生命周期
// ------------------------------------------------------------------

onMounted(async () => {
  await loadContext()
  await loadSessions()
  if (store.currentSessionId && store.loadedSessionId !== store.currentSessionId) {
    await loadSessionMessages(store.currentSessionId)
    await restorePendingAsk(store.currentSessionId)
  }
})

onUnmounted(() => {
  if (store.loadedSessionId && store.messages.length > 0) {
    snapshotToSessionStorage(projectId, store.loadedSessionId, store.messages)
  }
})
</script>

<style scoped>
.agent-page { display: flex; gap: 16px; height: 100%; min-height: 76vh; }
.agent-chat { flex: 1; display: flex; flex-direction: column; background: #fff; border-radius: 12px; border: 1px solid var(--border-color-light); padding: 20px; min-width: 0; }
.agent-side { width: 300px; display: flex; flex-direction: column; gap: 16px; flex-shrink: 0; }
.side-collapse { width: 100%; }
.side-collapse :deep(.el-collapse-item__content) { padding: 14px 16px 16px; }
.session-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-bottom: 14px; margin-bottom: 14px; border-bottom: 1px solid var(--border-color-light); flex-wrap: wrap; }
.session-left { display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1; }
.session-icon { color: var(--app-primary); font-size: 18px; flex-shrink: 0; }
.session-current-id { font-size: 11px; color: var(--text-placeholder); flex-shrink: 0; cursor: default; }
.session-select { width: 300px; max-width: 100%; }
.session-actions { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
.session-opt { display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%; }
.so-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.so-id { font-size: 11px; color: var(--text-placeholder); flex-shrink: 0; }
.so-count { font-size: 12px; color: var(--text-secondary); flex-shrink: 0; }
.think-empty { animation: think-pulse 1.2s ease-in-out infinite; }
@keyframes think-pulse { 0%, 100% { opacity: .55; } 50% { opacity: 1; } }
.chat-body { flex: 1; min-height: 0; overflow-y: auto; margin-bottom: 12px; }
.msg-row { margin-bottom: 14px; display: flex; align-items: flex-start; gap: 10px; }
.msg-row.user { flex-direction: row-reverse; }
.msg-avatar { width: 34px; height: 34px; border-radius: 50%; flex-shrink: 0; display: flex; align-items: center; justify-content: center; }
.msg-row.user .msg-avatar { background: linear-gradient(135deg, #4f8cff, #6f5cff); color: #fff; }
.msg-row.assistant .msg-avatar, .msg-row.tool .msg-avatar { background: linear-gradient(135deg, #6f5cff, #8a5cf6); color: #fff; }
.msg-bubble { max-width: 78%; padding: 10px 14px; border-radius: 12px; font-size: 14px; line-height: 1.7; word-break: break-word; }
.msg-row.assistant .msg-bubble { background: #fff; border: 1px solid var(--border-color-light); border-top-left-radius: 4px; box-shadow: 0 1px 3px rgba(0, 0, 0, .04); }
.msg-row.user .msg-bubble { background: linear-gradient(135deg, #4f8cff, #6f5cff); color: #fff; border-top-right-radius: 4px; }
.msg-row.tool .msg-bubble { background: #f8f9fb; border: 1px dashed var(--border-color-light); padding: 8px 12px; max-width: 70%; }
.msg-row.thinking .msg-bubble { background: #fbf5ff; border: 1px solid #f0e3fb; padding: 8px 12px; max-width: 70%; }
.msg-md { word-break: break-word; }
.msg-text { white-space: pre-wrap; }
.msg-row.note { justify-content: center; margin-bottom: 10px; }
.note-time { font-size: 11px; color: var(--text-placeholder); margin-left: 8px; }
.msg-time { font-size: 11px; line-height: 1.2; color: var(--text-placeholder); margin-top: 3px; text-align: right; }
.msg-row.user .msg-time { color: rgba(255, 255, 255, .75); }
.msg-note { font-size: 12px; line-height: 1.6; color: var(--text-secondary); background: #f5f7fa; border: 1px solid var(--border-color-light); border-radius: 999px; padding: 4px 12px; max-width: 85%; word-break: break-word; }
.think-head { font-size: 12px; font-weight: 600; color: #9b59b6; margin-bottom: 4px; }
.think-text { font-size: 12px; color: var(--text-secondary); white-space: pre-wrap; max-height: 160px; overflow-y: auto; }
.tool-cards { display: flex; flex-direction: column; gap: 6px; }
.tool-card { display: flex; gap: 8px; align-items: flex-start; }
.tool-icon { color: var(--app-primary); margin-top: 2px; flex-shrink: 0; }
.tool-body { min-width: 0; }
.tool-name { font-size: 12px; font-weight: 600; color: var(--text-primary); }
.tool-obs { font-size: 12px; color: var(--text-secondary); white-space: pre-wrap; word-break: break-word; max-height: 120px; overflow-y: auto; margin-top: 2px; }
.ask-card { border: 1px solid #4f8cff; border-radius: 12px; padding: 14px 16px; margin-bottom: 14px; background: #f0f5ff; }
.ask-head { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.ask-icon { color: #4f8cff; font-size: 16px; flex-shrink: 0; }
.ask-title { font-weight: 600; flex: 1; }
.ask-options { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; }
.ask-options .el-button + .el-button { margin-left: 0; }
.opt-checked { box-shadow: 0 0 0 2px rgba(79, 140, 255, .35); }
.opt-custom-toggle { gap: 4px; }
.ask-custom, .ask-custom-solo { display: flex; gap: 8px; margin-bottom: 10px; }
.ask-multi-bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 4px; padding: 8px 12px; border-radius: 8px; background: #f7f9fc; }
.multi-picked { font-size: 12px; color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chat-input-area { margin-top: auto; display: flex; gap: 10px; align-items: flex-end; }
.suggest-chips { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; }
.chip { cursor: pointer; }
.current-state { border: 2px solid #4f8cff; border-radius: 12px; padding: 14px; text-align: center; margin-bottom: 12px; }
.cs-label { font-size: 18px; font-weight: 700; }
.cs-key { font-size: 12px; color: var(--text-placeholder); margin-top: 2px; }
.state-switch { display: flex; flex-wrap: wrap; gap: 6px; }
.state-chip { font-size: 12px; padding: 5px 10px; border-radius: 999px; background: #f5f7fa; cursor: pointer; border: 1px solid var(--border-color-light); }
.state-chip.on { background: #4f8cff; color: #fff; border-color: #4f8cff; }
.state-chip.off { opacity: .45; cursor: not-allowed; }
.work-unit { margin-top: 10px; font-size: 13px; color: var(--text-secondary); }
.mem-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
.mem { display: flex; flex-direction: column; align-items: center; gap: 2px; font-size: 12px; color: var(--text-secondary); }
.mem .n { font-size: 18px; font-weight: 700; color: var(--app-primary); }
.prereq-item { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; font-size: 13px; color: var(--text-secondary); }
</style>
