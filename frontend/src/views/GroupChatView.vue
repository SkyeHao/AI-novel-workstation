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

    <div class="chat-main-layout">
      <!-- 左侧：会话列表 -->
      <aside class="session-panel">
        <div class="session-panel-header">
          <span class="session-panel-title">讨论会话</span>
          <el-button size="small" type="primary" plain :loading="starting" @click="goNewChat">
            <el-icon style="margin-right: 4px"><ChatDotRound /></el-icon>
            新建
          </el-button>
        </div>
        <div class="session-list">
          <div
            v-for="s in sessions"
            :key="s.id"
            class="session-item"
            :class="{ 'session-active': s.id === sessionId }"
            @click="switchSession(s)"
          >
            <div class="session-item-top">
              <span class="session-item-topic" :title="s.topic">{{ s.topic }}</span>
              <el-tag :type="statusTagTypeFor(s.status)" size="small" effect="plain">{{ statusLabelFor(s.status) }}</el-tag>
              <el-button
                class="session-delete-btn"
                size="small"
                text
                type="danger"
                title="删除会话"
                @click.stop="deleteSession(s)"
              >
                <el-icon><Delete /></el-icon>
              </el-button>
            </div>
            <div class="session-item-meta">
              <span>{{ s.messages.length }} 条消息</span>
              <span>{{ formatDateTime(s.updatedAt) }}</span>
            </div>
          </div>
          <el-empty v-if="sessions.length === 0" description="暂无讨论会话，点击「新建」开启" :image-size="60" />
        </div>
      </aside>

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
          <el-form-item label="会话标题" required>
            <el-input
              v-model="form.topic"
              type="textarea"
              :rows="3"
              placeholder="给这个讨论会话起个名字，例如：第 10 章剧情走向讨论"
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

    <!-- 阶段 1：群聊房间（中栏消息 + 右栏会话信息/成员） -->
    <div v-else class="room-body">
      <!-- 右侧：会话信息 + 成员（CSS order 置于消息区之后） -->
      <aside class="info-panel">
        <div class="info-panel-title">会话信息</div>
        <div class="info-section">
          <div class="info-row">
            <span class="info-label">主题</span>
            <span class="info-value info-topic">{{ topic }}</span>
          </div>
          <div class="info-row">
            <span class="info-label">状态</span>
            <el-tag :type="statusTagType" effect="plain" size="small">{{ statusLabel }}</el-tag>
          </div>
          <div class="info-row">
            <span class="info-label">开始时间</span>
            <span class="info-value">{{ formatDateTime(createdAt) }}</span>
          </div>
          <div class="info-row">
            <span class="info-label">消息数</span>
            <span class="info-value">{{ messages.length }} 条</span>
          </div>
        </div>
        <div v-if="summary" class="info-summary">
          <div class="info-label">最终方案</div>
          <div class="info-summary-text">{{ summary }}</div>
        </div>
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
            <el-button v-if="isRunning || sessionStatus === 'idle'" type="danger" plain size="small" :loading="stopping" @click="stopChat">
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
                <div class="bubble-text" v-html="renderMarkdown(msg.content + (msg.streaming ? ' ▌' : ''))"></div>
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
                <div class="bubble-text" v-html="renderMarkdown(msg.content + (msg.streaming ? ' ▌' : ''))"></div>
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
              :disabled="!canSend"
              resize="none"
              :placeholder="
                sessionStatus === 'idle'
                  ? '输入第一条消息，开启讨论'
                  : isRunning
                    ? '输入你的发言，按 Ctrl+Enter 发送'
                    : '讨论已结束，无法发送消息'
              "
              @keydown.ctrl.enter.prevent="sendAuthorMessage"
            />
          </div>
          <div class="chat-input-actions">
            <span v-if="sending" class="sending-tip"><el-icon class="is-loading"><Loading /></el-icon> 发送中…</span>
            <span v-if="canSend" class="mention-tip">点击左侧成员可快速 @</span>
            <el-button type="primary" :disabled="!canSend || !draft.trim()" :loading="sending" @click="sendAuthorMessage">
              <el-icon style="margin-right: 4px"><Promotion /></el-icon>
              发送
            </el-button>
          </div>
        </div>
      </main>
    </div>
  </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, nextTick } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import {
  getAgentRoles,
  getProjectDocumentsByKind,
  readProjectDocument,
  getProjectMemory,
  getChatSession,
  listChatSessions,
  startChatSession,
  sendChatMessage,
  stopChatSession,
  deleteChatSession,
  applyChatPlan,
  chatSessionStream,
  type AgentRoleAsset,
  type AgentRoleCategory,
  type ChatMember,
  type ChatMessageRecord,
  type ChatSessionSnapshot,
  type ChatSessionEvent,
  type ChatSessionStatus,
  type ChatApplyTarget,
} from '@/api'
import { useCurrentProject } from '@/stores/currentProject'
import PageHeader from '@/components/PageHeader.vue'

/** 展示用消息：带流式光标标记（delta 进行中为 true，chat_message / done 到达后清除）。 */
interface DisplayMessage extends ChatMessageRecord {
  streaming?: boolean
}

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
const createdAt = ref('')
const members = ref<ChatMember[]>([])
const messages = ref<DisplayMessage[]>([])
const sessionStatus = ref<ChatSessionStatus>('idle')
const summary = ref('')
const sessions = ref<ChatSessionSnapshot[]>([])
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
/** 可发送：idle（等待首条消息激活）或运行中；结束后不可发送。 */
const canSend = computed(() => sessionStatus.value === 'idle' || isRunning.value)

const statusLabel = computed(() => statusLabelFor(sessionStatus.value))

const statusTagType = computed(() => {
  if (sessionStatus.value === 'completed') return 'success'
  if (sessionStatus.value === 'terminated') return 'danger'
  if (isRunning.value) return 'warning'
  return 'info'
})

const STATUS_LABELS: Record<ChatSessionStatus, string> = {
  idle: '等待开始',
  running: '讨论中',
  synthesizing: '合成中',
  completed: '已完成',
  terminated: '已终止',
}

function statusLabelFor(status: ChatSessionStatus): string {
  return STATUS_LABELS[status] || status
}

function statusTagTypeFor(status: ChatSessionStatus): string {
  if (status === 'completed') return 'success'
  if (status === 'terminated') return 'danger'
  if (status === 'running' || status === 'synthesizing') return 'warning'
  return 'info'
}

function formatDateTime(iso: string): string {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    const date = d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
    const time = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    return date + ' ' + time
  } catch {
    return ''
  }
}

const displayMessages = computed(() => {
  const seen = new Set<string>()
  const out: DisplayMessage[] = []
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
  if (!canSend.value) return
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
    createdAt.value = new Date().toISOString()
    members.value = data.members
    messages.value = []
    sessionStatus.value = data.status
    summary.value = ''
    enterRoom()
    pushSystemMessage('讨论已创建，发送第一条消息开启讨论')
  } catch (err: any) {
    console.error('开启群聊失败:', err)
    ElMessage.error((err?.response?.data?.error as string) || '开启群聊失败')
  } finally {
    starting.value = false
  }
}

/** 返回配置阶段新建讨论（保留当前作品与已选角色）。 */
function goNewChat() {
  closeStream()
  sessionId.value = ''
  topic.value = ''
  createdAt.value = ''
  members.value = []
  messages.value = []
  sessionStatus.value = 'idle'
  summary.value = ''
  speakingMemberId.value = ''
  speakingMemberName.value = ''
  memberStatus.value = {}
  sessionStorage.removeItem(SESSION_STORAGE_KEY)
  phase.value = 'config'
  if (currentProject.id) loadSessions()
}

/** 切换会话：关闭旧流 → 载入快照 → 进入房间 → 连接事件流。 */
async function switchSession(s: ChatSessionSnapshot) {
  if (!s || s.id === sessionId.value) return
  closeStream()
  sessionId.value = s.id
  topic.value = s.topic
  createdAt.value = s.createdAt || ''
  members.value = s.members || []
  messages.value = (s.messages || []).map((m) => ({ ...m, streaming: false }))
  sessionStatus.value = s.status || 'idle'
  summary.value = s.summary || ''
  speakingMemberId.value = ''
  speakingMemberName.value = ''
  memberStatus.value = {}
  enterRoom()
}

/** 加载项目内讨论会话列表（按 updatedAt 倒序）。 */
async function loadSessions() {
  if (!currentProject.id) return
  try {
    const res = await listChatSessions(currentProject.id)
    sessions.value = res.data?.sessions || []
  } catch (err) {
    console.warn('加载讨论会话列表失败:', err)
  }
}

function enterRoom() {
  phase.value = 'room'
  sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ sessionId: sessionId.value, projectId: currentProject.id }))
  loadSessions()
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
      const existing = messages.value.find((m) => m.id === msg.id)
      if (existing) {
        // 流式预览到达终稿：以终稿（已剥离自评行）替换并清除光标
        existing.content = msg.content
        existing.streaming = false
      } else {
        messages.value.push({ ...msg, streaming: false })
      }
      scrollToBottom()
      break
    }
    case 'delta': {
      const data = event.data
      if (!data || !data.messageId) break
      const existing = messages.value.find((m) => m.id === data.messageId)
      if (existing) {
        existing.content = data.content
        existing.streaming = !data.done
      } else {
        messages.value.push({
          id: data.messageId,
          sessionId: sessionId.value,
          memberId: data.memberId,
          memberName: data.memberName,
          kind: data.memberId === 'author' ? 'author' : 'agent',
          content: data.content,
          timestamp: new Date().toISOString(),
          streaming: !data.done,
        })
      }
      scrollToBottom()
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
      if (data.level >= 1 && /合成者产出最终方案/.test(data.message || '')) {
        // 完整总结已在合成者流式预览中上屏，这里只给简短状态行，避免重复
        pushSystemMessage('合成者已产出最终方案，讨论完成')
      } else {
        pushSystemMessage('共识达成（置信度 ' + Math.round((data.level || 0) * 100) + '%）：' + (data.message || ''))
      }
      scrollToBottom()
      break
    }
    case 'done': {
      const data = event.data
      sessionStatus.value = data.status || 'completed'
      speakingMemberId.value = ''
      speakingMemberName.value = ''
      messages.value.forEach((m) => (m.streaming = false))
      if (data.summary) {
        summary.value = data.summary
      }
      pushSystemMessage(data.status === 'terminated' ? '讨论已终止' : '讨论已完成，可查看右侧最终方案并应用')
      sessionStorage.removeItem(SESSION_STORAGE_KEY)
      loadSessions()
      scrollToBottom()
      break
    }
    case 'error': {
      const data = event.data
      sessionStatus.value = 'terminated'
      speakingMemberId.value = ''
      speakingMemberName.value = ''
      messages.value.forEach((m) => (m.streaming = false))
      pushSystemMessage('讨论出错：' + (data.error || '未知错误'))
      sessionStorage.removeItem(SESSION_STORAGE_KEY)
      loadSessions()
      scrollToBottom()
      ElMessage.error((data.error as string) || '讨论失败')
      break
    }
  }
}

async function sendAuthorMessage() {
  const content = draft.value.trim()
  if (!content || !sessionId.value || !canSend.value) return
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

/** 删除会话：二次确认 → 关闭当前流 → 后端彻底删除 → 刷新列表。 */
async function deleteSession(s: ChatSessionSnapshot) {
  try {
    await ElMessageBox.confirm(
      `确定删除讨论会话「${s.topic}」吗？删除后内存与磁盘记录将一并清除，且不可恢复。`,
      '删除会话',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消', confirmButtonClass: 'el-button--danger' },
    )
  } catch {
    return // 用户取消
  }
  const isCurrent = s.id === sessionId.value
  if (isCurrent) closeStream()
  try {
    await deleteChatSession(s.id)
    if (isCurrent) {
      goNewChat() // 回到配置页并清除本地状态
    } else {
      await loadSessions()
    }
    ElMessage.success('会话已删除')
  } catch (err: any) {
    console.error('删除讨论会话失败:', err)
    ElMessage.error((err?.response?.data?.error as string) || '删除会话失败')
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
    createdAt.value = data.createdAt || ''
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
  await loadSessions()
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

/* ===== 三栏主布局：左侧会话列表 + 中间配置/消息 + 右侧信息 ===== */
.chat-main-layout {
  display: grid;
  grid-template-columns: 260px 1fr;
  gap: 16px;
  height: calc(100vh - 200px);
  min-height: 480px;
}

/* 左侧：会话列表 */
.session-panel {
  background: var(--surface);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 0;
}

.session-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-soft);
}

.session-panel-title {
  font-weight: 600;
  color: var(--text-title);
}

.session-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.session-item {
  padding: 10px 12px;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background var(--transition-fast), border-color var(--transition-fast);
}

.session-item:hover {
  background: var(--surface-hover);
}

.session-item.session-active {
  background: var(--accent-soft);
  border-color: var(--accent-border);
}

.session-item-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.session-item-topic {
  font-weight: 600;
  font-size: 13px;
  color: var(--text-title);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  min-width: 0;
}

.session-item-meta {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-top: 4px;
  font-size: 11px;
  color: var(--text-aux);
}

/* 中栏 + 右栏（房间态） */
.room-body {
  display: grid;
  grid-template-columns: 1fr 280px;
  gap: 16px;
  height: 100%;
  min-height: 0;
  min-width: 0;
}

/* 右侧：会话信息 + 成员 */
.info-panel {
  background: var(--surface);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 0;
  order: 2;
}

.info-panel-title {
  padding: 12px 16px;
  font-weight: 600;
  color: var(--text-title);
  border-bottom: 1px solid var(--border-soft);
}

.info-section {
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-soft);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.info-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 13px;
}

.info-label {
  color: var(--text-aux);
  flex-shrink: 0;
}

.info-value {
  color: var(--text-regular);
  text-align: right;
  min-width: 0;
  word-break: break-word;
}

.info-topic {
  font-weight: 600;
  color: var(--text-title);
}

.info-summary {
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-soft);
}

.info-summary-text {
  margin-top: 6px;
  font-size: 13px;
  color: var(--text-regular);
  line-height: 1.6;
  max-height: 200px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-word;
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
  min-width: 0;
  min-height: 0;
  order: 1;
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
.session-delete-btn {
  margin-left: auto;
  flex-shrink: 0;
  padding: 4px;
}
</style>
