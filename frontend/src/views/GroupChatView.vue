<template>
  <div class="group-chat-view">
    <PageHeader
      :title="phase === 'config' ? '群聊式剧情讨论' : '群聊房间'"
      :subtitle="phase === 'config' ? '多个 Agent 角色围绕剧情自由讨论，作者可作为群聊成员参与' : '正在围绕讨论主题实时讨论，作者可随时发言或终止'"
      icon="ChatLineSquare"
    >
      <template #actions>
        <el-tag v-if="phase === 'room'" :type="statusTagType" effect="plain" round>{{ statusLabel }}</el-tag>
        <el-tag v-else type="primary" effect="plain" round>对话模式</el-tag>
      </template>
    </PageHeader>

    <!-- 阶段 0：配置阶段 -->
    <div v-if="phase === 'config'" class="config-panel">
      <el-card shadow="never">
        <template #header>
          <div class="card-header">
            <span>开启群聊</span>
          </div>
        </template>

        <el-alert
          v-if="!currentProject.id"
          type="warning"
          :closable="false"
          show-icon
          title="尚未选择作品"
          description="请在右上角切换作品后，再开始群聊讨论。"
          style="margin-bottom: 16px"
        />

        <el-form :model="form" label-width="100px">
          <el-form-item label="讨论主题" required>
            <el-input
              v-model="form.topic"
              type="textarea"
              :rows="3"
              placeholder="例如：主角在第 10 章应该遇到什么危机？如何推动剧情发展？"
            />
          </el-form-item>

          <el-form-item label="参与角色" required>
            <div class="role-picker">
              <el-checkbox-group v-model="form.memberIds">
                <div v-for="role in allRoles" :key="role.id" class="role-pick-item">
                  <el-checkbox :value="role.id">
                    <div class="role-pick-info">
                      <span class="role-pick-name">{{ role.name }}</span>
                      <el-tag :type="getCategoryTagType(role.category)" size="small" effect="plain">{{ getCategoryLabel(role.category) }}</el-tag>
                    </div>
                    <div class="role-pick-desc">{{ role.description }}</div>
                  </el-checkbox>
                </div>
              </el-checkbox-group>
              <el-empty v-if="allRoles.length === 0" description="暂无 Agent 角色，请先到「Agent 角色蓝图」创建" :image-size="60" />
            </div>
          </el-form-item>

          <el-form-item label="静态设定">
            <el-checkbox-group v-model="form.contextKeys">
              <el-checkbox value="core_elements">核心要素</el-checkbox>
              <el-checkbox value="worldview">世界观</el-checkbox>
              <el-checkbox value="characters">人物设定</el-checkbox>
              <el-checkbox value="outline">大纲</el-checkbox>
              <el-checkbox value="memory">记忆（事实/伏笔）</el-checkbox>
            </el-checkbox-group>
          </el-form-item>

          <el-form-item label="发言轮数">
            <el-slider v-model="form.maxRounds" :min="1" :max="8" :step="1" show-stops style="max-width: 320px" />
            <span class="slider-value">{{ form.maxRounds }} 轮</span>
          </el-form-item>
        </el-form>

        <div class="config-actions">
          <el-button type="primary" :disabled="!currentProject.id || !form.topic.trim() || form.memberIds.length === 0" :loading="starting" @click="startChat">
            <el-icon style="margin-right: 4px"><ChatDotRound /></el-icon>
            开始群聊
          </el-button>
        </div>
      </el-card>
    </div>

    <!-- 阶段 1：群聊房间 -->
    <div v-else class="room-layout">
      <!-- 成员面板 -->
      <aside class="member-panel">
        <div class="member-panel-title">成员（{{ members.length }}）</div>
        <div class="member-list">
          <div
            v-for="m in members"
            :key="m.id"
            class="member-item"
            :class="{ 'member-speaking': speakingMemberId === m.id, 'member-clickable': m.kind === 'agent' }"
            :title="m.kind === 'agent' ? '点击快速 @' + m.name : ''"
            @click="quickMention(m)"
          >
            <div class="member-avatar" :class="avatarClass(m)">
              {{ m.name.slice(0, 1) }}
            </div>
            <div class="member-body">
              <div class="member-name-row">
                <span class="member-name">{{ m.name }}</span>
                <el-tag v-if="m.kind === 'author'" size="small" type="primary" effect="plain">作者</el-tag>
                <el-tag v-else :type="getCategoryTagType(m.category)" size="small" effect="plain">{{ getCategoryLabel(m.category) }}</el-tag>
              </div>
              <div class="member-status">
                <span v-if="m.kind === 'author'">在线</span>
                <template v-else>
                  <el-icon v-if="memberStatus[m.id] === 'thinking'" class="is-loading" :size="12"><Loading /></el-icon>
                  <span class="status-text">{{ memberStatusText(m.id) }}</span>
                </template>
              </div>
            </div>
          </div>
        </div>
      </aside>

      <!-- 消息主区 -->
      <main class="chat-panel">
        <div class="chat-header">
          <div class="chat-topic">
            <el-icon><ChatLineSquare /></el-icon>
            <span class="chat-topic-text">{{ topic }}</span>
          </div>
          <div class="chat-header-actions">
            <el-button v-if="isRunning" type="danger" plain size="small" :loading="stopping" @click="stopChat">
              <el-icon style="margin-right: 4px"><VideoPause /></el-icon>
              终止讨论
            </el-button>
          </div>
        </div>

        <!-- 应用最终方案（工单 08） -->
        <div v-if="sessionStatus === 'completed' && summary" class="apply-panel">
          <div class="apply-panel-info">
            <el-icon class="apply-panel-icon"><Finished /></el-icon>
            <div class="apply-panel-text">
              <div class="apply-panel-title">讨论已完成，最终方案已生成</div>
              <div class="apply-panel-desc">可将方案保存为参考文档，或合并进既有的大纲 / 人物设定。</div>
            </div>
          </div>
          <div class="apply-panel-actions">
            <el-button type="primary" plain :loading="applying === 'document'" @click="applyPlan('document')">
              <el-icon style="margin-right: 4px"><DocumentAdd /></el-icon>
              保存为文档
            </el-button>
            <el-button type="success" plain :loading="applying === 'outline'" @click="applyPlan('outline')">
              <el-icon style="margin-right: 4px"><Memo /></el-icon>
              应用到大纲
            </el-button>
            <el-button type="warning" plain :loading="applying === 'characters'" @click="applyPlan('characters')">
              <el-icon style="margin-right: 4px"><User /></el-icon>
              应用到人设
            </el-button>
          </div>
        </div>

        <!-- 正在发言提示 -->
        <div v-if="speakingMemberId && isRunning" class="speaker-banner">
          <el-icon class="is-loading"><Loading /></el-icon>
          <span>「{{ speakingMemberName }}」正在发言…</span>
        </div>

        <div class="message-list" ref="messageListRef">
          <template v-for="msg in displayMessages" :key="msg.id">
            <!-- 系统消息 -->
            <div v-if="msg.kind === 'system'" class="system-message">
              <div class="system-dot"></div>
              <span class="system-text">{{ msg.content }}</span>
            </div>

            <!-- 作者消息 -->
            <div v-else-if="msg.kind === 'author'" class="message-row message-author">
              <div class="bubble-author">
                <div class="bubble-meta">
                  <span class="bubble-name">{{ msg.memberName }}</span>
                  <span class="bubble-time">{{ formatTime(msg.timestamp) }}</span>
                </div>
                <div class="bubble-text" v-html="renderMarkdown(msg.content)"></div>
              </div>
            </div>

            <!-- Agent 消息 -->
            <div v-else class="message-row">
              <div class="msg-avatar" :class="avatarClass(msg)">{{ msg.memberName.slice(0, 1) }}</div>
              <div class="bubble-agent">
                <div class="bubble-meta">
                  <span class="bubble-name">{{ msg.memberName }}</span>
                  <el-tag :type="getCategoryTagType(msg.category)" size="small" effect="plain">{{ getCategoryLabel(msg.category) }}</el-tag>
                  <span class="bubble-time">{{ formatTime(msg.timestamp) }}</span>
                </div>
                <div class="bubble-text" v-html="renderMarkdown(msg.content)"></div>
              </div>
            </div>
          </template>
        </div>

        <!-- 输入区 -->
        <div class="chat-input-area">
          <div class="chat-input-box">
            <el-input
              v-model="draft"
              type="textarea"
              :rows="2"
              :disabled="!isRunning"
              resize="none"
              :placeholder="isRunning ? '输入你的发言，按 Ctrl+Enter 发送' : '讨论已结束，无法发送消息'"
              @keydown.ctrl.enter.prevent="sendAuthorMessage"
            />
          </div>
          <div class="chat-input-actions">
            <span v-if="sending" class="sending-tip"><el-icon class="is-loading"><Loading /></el-icon> 发送中…</span>
            <span v-if="isRunning" class="mention-tip">点击左侧成员可快速 @</span>
            <el-button type="primary" :disabled="!isRunning || !draft.trim()" :loading="sending" @click="sendAuthorMessage">
              <el-icon style="margin-right: 4px"><Promotion /></el-icon>
              发送
            </el-button>
          </div>
        </div>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import {
  getAgentRoles,
  getProjectDocumentsByKind,
  readProjectDocument,
  getProjectMemory,
  getChatSession,
  startChatSession,
  sendChatMessage,
  stopChatSession,
  applyChatPlan,
  chatSessionStream,
  type AgentRoleAsset,
  type AgentRoleCategory,
  type ChatMember,
  type ChatMessageRecord,
  type ChatSessionEvent,
  type ChatSessionStatus,
  type ChatApplyTarget,
} from '@/api'
import { useCurrentProject } from '@/stores/currentProject'
import PageHeader from '@/components/PageHeader.vue'

const route = useRoute()
const currentProject = useCurrentProject()

type Phase = 'config' | 'room'
const phase = ref<Phase>('config')

const allRoles = ref<AgentRoleAsset[]>([])
const starting = ref(false)
const sending = ref(false)
const stopping = ref(false)

const form = ref({
  topic: '',
  memberIds: [] as string[],
  contextKeys: ['core_elements', 'worldview', 'characters'] as string[],
  maxRounds: 3,
})

// 会话状态
const sessionId = ref('')
const topic = ref('')
const members = ref<ChatMember[]>([])
const messages = ref<ChatMessageRecord[]>([])
const sessionStatus = ref<ChatSessionStatus>('idle')
const summary = ref('')
const applying = ref<'' | ChatApplyTarget>('')
const memberStatus = ref<Record<string, 'thinking' | 'generating' | 'idle'>>({})
const speakingMemberId = ref('')
const speakingMemberName = ref('')
const draft = ref('')
const messageListRef = ref<HTMLElement | null>(null)

let streamController: AbortController | null = null
let reconnectTimer: number | null = null
let reconnectAttempts = 0
const SESSION_STORAGE_KEY = 'ai-novel-active-chat-session'

const isRunning = computed(() => sessionStatus.value === 'running' || sessionStatus.value === 'synthesizing')

const statusLabel = computed(() => {
  const map: Record<ChatSessionStatus, string> = {
    idle: '等待开始',
    running: '讨论中',
    synthesizing: '合成中',
    completed: '已完成',
    terminated: '已终止',
  }
  return map[sessionStatus.value] || sessionStatus.value
})

const statusTagType = computed(() => {
  if (sessionStatus.value === 'completed') return 'success'
  if (sessionStatus.value === 'terminated') return 'danger'
  if (isRunning.value) return 'warning'
  return 'info'
})

const displayMessages = computed(() => {
  const seen = new Set<string>()
  const out: ChatMessageRecord[] = []
  for (const m of messages.value) {
    if (seen.has(m.id)) continue
    seen.add(m.id)
    out.push(m)
  }
  return out
})

function getCategoryLabel(category?: AgentRoleCategory | string): string {
  const labels: Record<string, string> = {
    proposer: '提案者',
    synthesizer: '合成者',
    reviewer: '评审者',
  }
  if (!category) return ''
  return labels[category] || category
}

function getCategoryTagType(category?: AgentRoleCategory | string): string {
  const types: Record<string, string> = {
    proposer: 'success',
    synthesizer: 'warning',
    reviewer: 'info',
  }
  if (!category) return 'info'
  return types[category] || 'info'
}

function avatarClass(target: { kind?: string; memberId?: string; id?: string }): string {
  const kind = target.kind ?? (target.memberId === 'author' ? 'author' : 'agent')
  if (kind === 'author') return 'avatar-author'
  const cat = (target as ChatMessageRecord).category
  if (cat === 'proposer') return 'avatar-proposer'
  if (cat === 'synthesizer') return 'avatar-synthesizer'
  if (cat === 'reviewer') return 'avatar-reviewer'
  return 'avatar-agent'
}

function memberStatusText(memberId: string): string {
  const s = memberStatus.value[memberId]
  if (s === 'thinking') return '思考中…'
  if (s === 'generating') return '生成中…'
  return '在线'
}

/** 工单 03：点击成员快速 @ 该角色，插入到输入框。 */
function quickMention(member: ChatMember) {
  if (!isRunning.value) return
  if (member.kind === 'author') return
  const name = member.name
  if (draft.value.includes('@' + name)) return
  const prefix = draft.value.trim() ? draft.value.replace(/\s+$/, ' ') + ' ' : ''
  draft.value = prefix + '@' + name + ' '
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch {
    return ''
  }
}

function renderMarkdown(text: string): string {
  if (!text) return ''
  const raw = marked.parse(text, { breaks: true }) as string
  return DOMPurify.sanitize(raw)
}

function scrollToBottom() {
  nextTick(() => {
    if (messageListRef.value) {
      messageListRef.value.scrollTop = messageListRef.value.scrollHeight
    }
  })
}

async function loadRoles() {
  try {
    const res = await getAgentRoles()
    allRoles.value = res.data || []
  } catch (err) {
    console.error('加载 Agent 角色失败:', err)
    ElMessage.error('加载 Agent 角色失败')
  }
}

async function loadStaticContext(): Promise<Record<string, string>> {
  if (!currentProject.id) return {}
  const context: Record<string, string> = {}
  const kindMap: Record<string, string> = {
    core_elements: 'core-elements',
    worldview: 'worldview',
    characters: 'characters',
    outline: 'outline',
  }
  try {
    for (const key of form.value.contextKeys) {
      if (key === 'memory') {
        const mem = await getProjectMemory(currentProject.id)
        const facts = mem.data?.facts || []
        if (facts.length > 0) context.memory = JSON.stringify(facts, null, 2)
        continue
      }
      const kind = kindMap[key]
      if (!kind) continue
      const res = await getProjectDocumentsByKind(currentProject.id, kind)
      const docs = res.data?.documents
      if (docs && docs.length > 0) {
        const rd = await readProjectDocument(currentProject.id, docs[0].path)
        if (rd.data.success && rd.data.content) context[key] = rd.data.content
      }
    }
  } catch (err) {
    console.warn('加载静态设定失败:', err)
  }
  return context
}

async function startChat() {
  if (!currentProject.id) {
    ElMessage.warning('请先选择作品')
    return
  }
  starting.value = true
  try {
    const staticContext = await loadStaticContext()
    const res = await startChatSession({
      projectId: currentProject.id,
      topic: form.value.topic.trim(),
      memberIds: form.value.memberIds,
      staticContext,
      maxRounds: form.value.maxRounds,
    })
    const data = res.data
    sessionId.value = data.sessionId
    topic.value = data.topic
    members.value = data.members
    messages.value = []
    sessionStatus.value = data.status
    summary.value = ''
    enterRoom()
  } catch (err: any) {
    console.error('开启群聊失败:', err)
    ElMessage.error((err?.response?.data?.error as string) || '开启群聊失败')
  } finally {
    starting.value = false
  }
}

function enterRoom() {
  phase.value = 'room'
  sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ sessionId: sessionId.value, projectId: currentProject.id }))
  // 作者永远在成员列表中
  if (!members.value.some((m) => m.id === 'author')) {
    members.value = [
      ...members.value,
      { id: 'author', kind: 'author', name: '作者', description: '作品作者', category: 'proposer' as AgentRoleCategory },
    ]
  }
  connectStream()
}

function pushSystemMessage(text: string) {
  messages.value.push({
    id: 'sys-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
    sessionId: sessionId.value,
    memberId: 'system',
    memberName: '系统',
    kind: 'system',
    content: text,
    timestamp: new Date().toISOString(),
  })
}

async function connectStream() {
  if (!sessionId.value) return
  closeStream()
  reconnectAttempts = 0
  await openStream()
}

async function openStream() {
  if (!sessionId.value || !phase.value) return
  streamController = new AbortController()
  try {
    for await (const event of chatSessionStream(sessionId.value)) {
      if (streamController?.signal.aborted) break
      handleChatEvent(event)
    }
  } catch (err) {
    console.error('讨论流中断:', err)
  } finally {
    if (streamController?.signal.aborted) return
    scheduleReconnect()
  }
}

function scheduleReconnect() {
  if (!sessionId.value) return
  if (sessionStatus.value === 'completed' || sessionStatus.value === 'terminated') return
  reconnectAttempts += 1
  if (reconnectAttempts > 5) {
    ElMessage.error('讨论流连接多次失败，请刷新页面重试')
    return
  }
  const delay = Math.min(1000 * Math.pow(2, reconnectAttempts - 1), 8000)
  reconnectTimer = window.setTimeout(() => {
    openStream()
  }, delay)
}

function handleChatEvent(event: ChatSessionEvent) {
  if (!event || !event.type) return
  switch (event.type) {
    case 'system': {
      const data = event.data
      if (data.status) sessionStatus.value = data.status
      if (data.message) pushSystemMessage(data.message)
      scrollToBottom()
      break
    }
    case 'chat_message': {
      const msg = event.data
      if (!msg || !msg.id) break
      if (!messages.value.some((m) => m.id === msg.id)) {
        messages.value.push(msg)
        scrollToBottom()
      }
      break
    }
    case 'agent_status': {
      const data = event.data
      if (data.memberId) memberStatus.value[data.memberId] = data.status || 'idle'
      break
    }
    case 'speaker': {
      const data = event.data
      speakingMemberId.value = data.memberId || ''
      speakingMemberName.value = data.memberName || ''
      break
    }
    case 'consensus': {
      const data = event.data
      pushSystemMessage('共识达成（置信度 ' + Math.round((data.level || 0) * 100) + '%）：' + (data.message || ''))
      scrollToBottom()
      break
    }
    case 'done': {
      const data = event.data
      sessionStatus.value = data.status || 'completed'
      speakingMemberId.value = ''
      speakingMemberName.value = ''
      if (data.summary) {
        summary.value = data.summary
        pushSystemMessage('讨论总结：' + data.summary)
      }
      pushSystemMessage(data.status === 'terminated' ? '讨论已终止' : '讨论已完成')
      sessionStorage.removeItem(SESSION_STORAGE_KEY)
      scrollToBottom()
      break
    }
    case 'error': {
      const data = event.data
      sessionStatus.value = 'terminated'
      speakingMemberId.value = ''
      speakingMemberName.value = ''
      pushSystemMessage('讨论出错：' + (data.error || '未知错误'))
      sessionStorage.removeItem(SESSION_STORAGE_KEY)
      scrollToBottom()
      ElMessage.error((data.error as string) || '讨论失败')
      break
    }
  }
}

async function sendAuthorMessage() {
  const content = draft.value.trim()
  if (!content || !sessionId.value || !isRunning.value) return
  sending.value = true
  try {
    await sendChatMessage(sessionId.value, content)
    draft.value = ''
  } catch (err: any) {
    console.error('发送消息失败:', err)
    ElMessage.error((err?.response?.data?.error as string) || '发送失败')
  } finally {
    sending.value = false
  }
}

async function stopChat() {
  if (!sessionId.value) return
  stopping.value = true
  try {
    await stopChatSession(sessionId.value)
    sessionStatus.value = 'terminated'
    sessionStorage.removeItem(SESSION_STORAGE_KEY)
    pushSystemMessage('正在终止讨论…')
    ElMessage.info('已请求终止讨论')
  } catch (err: any) {
    console.error('终止讨论失败:', err)
    ElMessage.error((err?.response?.data?.error as string) || '终止失败')
  } finally {
    stopping.value = false
  }
}

function closeStream() {
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  if (streamController) {
    streamController.abort()
    streamController = null
  }
}

/** 工单 08：把最终方案落地到文档 / 大纲 / 人设。 */
async function applyPlan(target: ChatApplyTarget) {
  if (!sessionId.value || applying.value) return
  applying.value = target
  try {
    const res = await applyChatPlan(sessionId.value, target)
    const data = res.data
    if (data.ok) {
      ElMessage.success(data.message + (data.relPath ? '：' + data.relPath : ''))
    } else {
      ElMessage.warning(data.message || '应用失败')
    }
  } catch (err: any) {
    console.error('应用最终方案失败:', err)
    ElMessage.error((err?.response?.data?.error as string) || '应用失败')
  } finally {
    applying.value = ''
  }
}

async function restoreSession() {
  const raw = sessionStorage.getItem(SESSION_STORAGE_KEY)
  if (!raw) return
  try {
    const saved = JSON.parse(raw)
    if (!saved || !saved.sessionId) return
    if (saved.projectId && saved.projectId !== currentProject.id) {
      sessionStorage.removeItem(SESSION_STORAGE_KEY)
      return
    }
    const res = await getChatSession(saved.sessionId)
    const data = res.data
    sessionId.value = data.id
    topic.value = data.topic
    members.value = data.members
    messages.value = data.messages
    sessionStatus.value = data.status
    summary.value = data.summary || ''
    enterRoom()
  } catch (err) {
    console.warn('恢复会话失败:', err)
    sessionStorage.removeItem(SESSION_STORAGE_KEY)
  }
}

onMounted(async () => {
  // 从资产页跳转时通过 query 预选角色
  const q = route.query
  if (q && q.roles) {
    const ids = String(q.roles).split(',').filter(Boolean)
    if (ids.length > 0) form.value.memberIds = ids
  }
  await loadRoles()
  await restoreSession()
})

onBeforeUnmount(() => {
  closeStream()
})
</script>

<style scoped>
.group-chat-view {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-weight: 600;
  color: var(--text-title);
}

/* ===== 配置阶段 ===== */
.config-panel {
  max-width: 760px;
}

.role-picker {
  width: 100%;
}

.role-pick-item {
  padding: 8px 10px;
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  margin-bottom: 8px;
  transition: border-color var(--transition-fast), background var(--transition-fast);
}

.role-pick-item:hover {
  border-color: var(--accent-border);
  background: var(--accent-soft);
}

.role-pick-info {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 2px;
}

.role-pick-name {
  font-weight: 600;
  color: var(--text-title);
}

.role-pick-desc {
  font-size: 12px;
  color: var(--text-aux);
  line-height: 1.5;
}

.slider-value {
  margin-left: 12px;
  font-weight: 600;
  color: var(--accent);
}

.config-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 8px;
}

/* ===== 房间布局 ===== */
.room-layout {
  display: grid;
  grid-template-columns: 240px 1fr;
  gap: 16px;
  height: calc(100vh - 200px);
  min-height: 480px;
}

.member-panel {
  background: var(--surface);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.member-panel-title {
  padding: 12px 16px;
  font-weight: 600;
  color: var(--text-title);
  border-bottom: 1px solid var(--border-soft);
}

.member-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.member-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px;
  border-radius: var(--radius-md);
  transition: background var(--transition-fast);
}

.member-item:hover {
  background: var(--surface-hover);
}

.member-item.member-clickable {
  cursor: pointer;
}

.member-item.member-speaking {
  background: var(--accent-soft);
  outline: 1px solid var(--accent-border);
}

.member-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-weight: 600;
  font-size: 15px;
  flex-shrink: 0;
}

.member-body {
  min-width: 0;
}

.member-name-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.member-name {
  font-weight: 600;
  font-size: 13px;
  color: var(--text-title);
}

.member-status {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--text-aux);
  margin-top: 2px;
}

/* ===== 消息主区 ===== */
.chat-panel {
  background: var(--surface);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-soft);
}

.chat-topic {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.chat-topic-text {
  font-weight: 600;
  color: var(--text-title);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.speaker-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 16px;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 13px;
  border-bottom: 1px solid var(--accent-border);
}

.apply-panel {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  padding: 12px 16px;
  background: var(--success-soft, rgba(103, 194, 58, 0.08));
  border-bottom: 1px solid var(--success-border, rgba(103, 194, 58, 0.25));
}

.apply-panel-info {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  min-width: 260px;
}

.apply-panel-icon {
  font-size: 20px;
  color: var(--el-color-success);
  margin-top: 2px;
}

.apply-panel-title {
  font-weight: 600;
  color: var(--text-title);
  font-size: 14px;
}

.apply-panel-desc {
  color: var(--text-aux);
  font-size: 12px;
  margin-top: 2px;
}

.apply-panel-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.message-list {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: var(--bg-soft);
}

.system-message {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: var(--text-aux);
  font-size: 12px;
}

.system-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--text-muted);
}

.message-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}

.message-row.message-author {
  justify-content: flex-end;
}

.msg-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-weight: 600;
  font-size: 14px;
  flex-shrink: 0;
}

.avatar-proposer { background: linear-gradient(135deg, #10B981, #059669); }
.avatar-synthesizer { background: linear-gradient(135deg, #F59E0B, #D97706); }
.avatar-reviewer { background: linear-gradient(135deg, #64748B, #475569); }
.avatar-agent { background: linear-gradient(135deg, #4F46E5, #2563EB); }
.avatar-author { background: linear-gradient(135deg, #EF4444, #DC2626); }

.bubble-agent {
  background: var(--surface);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-md);
  padding: 10px 14px;
  max-width: 82%;
  box-shadow: var(--shadow-sm);
}

.bubble-author {
  background: var(--accent);
  color: #fff;
  border-radius: var(--radius-md);
  padding: 10px 14px;
  max-width: 82%;
}

.bubble-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.bubble-name {
  font-weight: 600;
  font-size: 13px;
  color: var(--text-title);
}

.message-author .bubble-name {
  color: rgba(255, 255, 255, 0.92);
}

.bubble-time {
  font-size: 11px;
  color: var(--text-aux);
}

.message-author .bubble-time {
  color: rgba(255, 255, 255, 0.7);
}

.bubble-text {
  font-size: 14px;
  line-height: 1.7;
  color: var(--text-regular);
  word-break: break-word;
}

.message-author .bubble-text {
  color: #fff;
}

.bubble-text :deep(p) {
  margin: 0 0 8px;
}

.bubble-text :deep(p:last-child) {
  margin-bottom: 0;
}

.bubble-text :deep(pre) {
  background: var(--bg-soft);
  border: 1px solid var(--border-soft);
  border-radius: 6px;
  padding: 10px;
  overflow-x: auto;
}

/* ===== 输入区 ===== */
.chat-input-area {
  border-top: 1px solid var(--border-soft);
  padding: 12px 16px;
  background: var(--surface);
}

.chat-input-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 8px;
}

.sending-tip {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--text-aux);
}

.mention-tip {
  font-size: 12px;
  color: var(--text-aux);
}
</style>
