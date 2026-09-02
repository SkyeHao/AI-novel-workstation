<template>
  <div class="group-chat-view">
    <PageHeader
      :title="phase === 'config' ? '圆桌会议' : '圆桌会议'"
      :subtitle="phase === 'config' ? '多个 Agent 角色围绕剧情自由讨论，作者可作为圆桌会议成员参与' : '正在围绕讨论主题实时讨论，作者可随时发言或终止'"
      icon="ChatLineSquare"
    >
      <template #actions>
        <el-tag v-if="phase === 'room'" :type="statusTagType" effect="plain" round>{{ statusLabel }}</el-tag>
        <el-tag v-else type="primary" effect="plain" round>对话模式</el-tag>
      </template>
    </PageHeader>

    <div class="chat-main-layout" :style="{ gridTemplateColumns: sessionPanelCollapsed ? '48px 1fr' : '260px 1fr' }">
      <!-- 左侧：会话列表 -->
      <aside class="session-panel" :class="{ collapsed: sessionPanelCollapsed }">
        <!-- 收起态：窄条 + 展开按钮 -->
        <div v-if="sessionPanelCollapsed" class="panel-rail" title="展开会话列表" @click="sessionPanelCollapsed = false">
          <el-icon :size="18"><ArrowRight /></el-icon>
          <span class="rail-label">会话</span>
        </div>
        <template v-else>
          <div class="session-panel-header">
            <span class="session-panel-title">讨论会话</span>
            <div class="session-panel-header-actions">
              <el-button size="small" text title="收起会话列表" @click="sessionPanelCollapsed = true">
                <el-icon><Fold /></el-icon>
              </el-button>
              <el-button size="small" type="primary" plain :loading="starting" @click="goNewChat">
                <el-icon style="margin-right: 4px"><ChatDotRound /></el-icon>
                新建
              </el-button>
            </div>
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
                <span class="session-id mono" :title="s.id">#{{ shortId(s.id) }}</span>
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
        </template>
      </aside>

      <!-- 阶段 0：配置阶段 -->
      <div v-if="phase === 'config'" class="config-panel">
      <el-card shadow="never">
        <template #header>
          <div class="card-header">
            <span>开启圆桌会议</span>
          </div>
        </template>

        <el-alert
          v-if="!currentProject.id"
          type="warning"
          :closable="false"
          show-icon
          title="尚未选择作品"
          description="请在右上角切换作品后，再开始圆桌会议讨论。"
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
                  <el-checkbox :value="role.id" :disabled="isSynthesizerLocked(role.id)">
                    <div class="role-pick-info">
                      <span class="role-pick-name">{{ role.name }}</span>
                      <el-tag :type="getCategoryTagType(role.category)" size="small" effect="plain">{{ getCategoryLabel(role.category) }}</el-tag>
                      <el-tag
                        v-for="s in getRoleScenarios(role)"
                        :key="s"
                        :type="getScenarioTagType(s)"
                        size="small"
                        effect="plain"
                      >{{ getScenarioLabel(s) }}</el-tag>
                    </div>
                    <div class="role-pick-desc">{{ role.description }}</div>
                  </el-checkbox>
                </div>
              </el-checkbox-group>
              <div class="synthesizer-note">
                <el-icon><InfoFilled /></el-icon>
                <span>合成者负责在达成共识后收敛最终方案，必须保留至少一名，已默认选中。</span>
              </div>
              <el-empty v-if="allRoles.length === 0" description="暂无 Agent 角色，请先到「提示词管理 → 圆桌会议」创建" :image-size="60" />
            </div>
          </el-form-item>


          <el-form-item label="发言轮数">
            <div class="rounds-config">
              <el-slider
                v-model="form.maxRounds"
                :min="1"
                :max="40"
                :step="1"
                show-stops
                style="max-width: 320px"
                :disabled="form.unlimitedRounds"
              />
              <span class="slider-value">{{ form.unlimitedRounds ? '不限（直到达成共识）' : form.maxRounds + ' 轮' }}</span>
            </div>
            <el-checkbox v-model="form.unlimitedRounds" class="unlimited-rounds-check">
              不限轮次，直到达成共识
            </el-checkbox>
            <div class="rounds-hint">选择不限轮次时，讨论会持续进行，直到共识裁判判定成员达成一致，由合成者产出最终方案。</div>
          </el-form-item>

          <el-form-item label="讨论配置">
            <span class="form-config-hint">上下文预算与工具调用次数统一在「提示词管理 → 圆桌会议」中配置，创建讨论时无需重复设置</span>
          </el-form-item>
        </el-form>

        <div class="config-actions">
          <el-button type="primary" :disabled="!currentProject.id || !form.topic.trim() || form.memberIds.length === 0" :loading="starting" @click="startChat">
            <el-icon style="margin-right: 4px"><ChatDotRound /></el-icon>
            开始圆桌会议
          </el-button>
        </div>
      </el-card>
    </div>

    <!-- 阶段 1：圆桌会议（中栏消息 + 右栏会话信息/成员） -->
    <div v-else class="room-body" :class="{ 'info-hidden': infoPanelCollapsed }" :style="{ gridTemplateColumns: infoPanelCollapsed ? '1fr' : '1fr 280px' }">
      <!-- 右侧：会话信息 + 成员（CSS order 置于消息区之后） -->
      <aside class="info-panel" :class="{ collapsed: infoPanelCollapsed }">
        <template v-if="!infoPanelCollapsed">
        <div class="info-panel-title">
          <span>会话信息</span>
          <el-button size="small" text title="收起会话信息" @click="infoPanelCollapsed = true">
            <el-icon><Fold /></el-icon>
          </el-button>
        </div>
        <div class="info-section">
          <div class="info-row">
            <span class="info-label">主题</span>
            <span class="info-value info-topic">{{ topic }}</span>
          </div>
          <div class="info-row">
            <span class="info-label">会话 ID</span>
            <span class="info-value mono" :title="sessionId">#{{ shortId(sessionId) }}</span>
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
        </template>
      </aside>
      <!-- 收起态：右侧浮动展开按钮 -->
      <button v-if="infoPanelCollapsed" class="info-rail" title="展开会话信息" @click="infoPanelCollapsed = false">
        <el-icon :size="16"><ArrowLeft /></el-icon>
        <span>信息</span>
      </button>

      <!-- 消息主区 -->
      <main class="chat-panel">
        <div class="chat-header">
          <div class="chat-topic">
            <el-icon><ChatLineSquare /></el-icon>
            <span class="chat-topic-text">{{ topic }}</span>
            <span class="session-id mono" :title="sessionId">#{{ shortId(sessionId) }}</span>
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
              <div class="apply-panel-desc">可将最终方案保存为固定格式的参考文档，随时在「讨论参考文档」中查看。</div>
            </div>
          </div>
          <div class="apply-panel-actions">
            <el-button type="primary" plain :loading="applying === 'document'" @click="applyPlan('document')">
              <el-icon style="margin-right: 4px"><DocumentAdd /></el-icon>
              保存为文档
            </el-button>
          </div>
        </div>

        <!-- 正在发言提示 -->
        <div v-if="speakingMemberId && isRunning" class="speaker-banner">
          <el-icon class="is-loading"><Loading /></el-icon>
          <span>「{{ speakingMemberName }}」正在发言…</span>
        </div>

        <!-- 调度决策：群聊导演选出的下一位发言者（可折叠，默认收起不打扰） -->
        <div v-if="lastProbe" class="willingness-strip">
          <div class="willingness-header" @click="probeOpen = !probeOpen">
            <el-icon><Finished /></el-icon>
            <span class="willingness-title">调度决策</span>
            <el-tag v-if="lastProbe.fallback" size="small" type="info" effect="plain">走兜底</el-tag>
            <el-tag v-else size="small" type="success" effect="plain">已选 {{ members.find((m) => m.id === lastProbe!.chosenId)?.name ?? lastProbe!.chosenId }}</el-tag>
            <el-icon class="willingness-arrow" :class="{ open: probeOpen }"><ArrowDown /></el-icon>
          </div>
          <el-collapse-transition>
            <div v-show="probeOpen" class="willingness-body">
              <div v-for="r in lastProbe.ranking" :key="r.memberId" class="willingness-row" :class="{ chosen: r.memberId === lastProbe!.chosenId }">
                <span class="willingness-name">{{ members.find((m) => m.id === r.memberId)?.name ?? r.memberId }}</span>
                <el-tag size="small" type="primary" effect="plain">优先级 {{ r.priority }}</el-tag>
                <span class="willingness-reason">{{ r.reason }}</span>
              </div>
              <div v-if="lastProbe.note" class="willingness-note">导演指引：{{ lastProbe.note }}</div>
              <div v-if="lastProbe.fallback" class="willingness-parse">导演决策失败/超时，已按规则兜底</div>
            </div>
          </el-collapse-transition>
        </div>

        <div class="message-list" ref="messageListRef" @scroll="handleScroll">
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

            <template v-else>
            <!-- 过程气泡：思考/工具调用，可折叠，上下文仅含最终结论 -->
            <div v-if="processMap.get(msg.id)" class="process-bubble" @click="toggleProcess(msg.id)">
              <div class="process-header">
                <el-icon><View /></el-icon>
                <span>思考过程 · {{ (processMap.get(msg.id)?.thoughts?.length ?? 0) }}步 · 调用{{ (processMap.get(msg.id)?.toolCalls?.length ?? 0) }}个工具</span>
                <el-icon class="process-arrow" :class="{open: !processMap.get(msg.id)?.collapsed}"><ArrowDown /></el-icon>
              </div>
              <div v-show="!processMap.get(msg.id)?.collapsed" class="process-body">
                <div v-for="(t, ti) in (processMap.get(msg.id)?.thoughts || [])" :key="ti" class="process-thought">💭 {{t}}</div>
                <div v-for="(tc, tci) in (processMap.get(msg.id)?.toolCalls || [])" :key="tci" class="process-tool">
                  <div class="tool-call">🔧 {{tc.tool}} <span class="tool-args">{{JSON.stringify(tc.args)}}</span></div>
                  <div class="tool-result" :class="{success: tc.success, error: !tc.success}">{{tc.result}}</div>
                </div>
              </div>
            </div>
            <!-- Agent 消息：最终结论，独立气泡 -->
            <div class="message-row">
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
          </template>
        </div>

        <!-- ask_user 提问卡片（工单 12）：Agent 需要作者拍板时挂起本轮，等待作者作答 -->
        <div v-if="activeAsk" class="ask-card-wrap">
          <div class="ask-card">
            <div class="ask-card-head">
              <div class="ask-asker">
                <span class="ask-avatar" :class="avatarClass({ kind: 'agent', category: askMember?.category })">
                  {{ (askMemberName || '作者').slice(0, 1) }}
                </span>
                <div class="ask-asker-text">
                  <span class="ask-asker-name">{{ askMemberName || '作者' }} 正在向你提问</span>
                  <span class="ask-question">{{ activeAsk.question }}</span>
                </div>
              </div>
              <el-tag v-if="activeAsk.multiple" size="small" type="warning" effect="plain" round>可多选</el-tag>
              <el-tag v-if="answeringAsk" size="small" type="info" effect="plain">提交中…</el-tag>
            </div>

            <div v-if="activeAsk.options && activeAsk.options.length" class="ask-options">
              <el-button
                v-for="opt in activeAsk.options"
                :key="opt"
                size="small"
                :type="askSelectedOptions.includes(opt) ? 'primary' : 'default'"
                :plain="!askSelectedOptions.includes(opt)"
                :disabled="answeringAsk"
                :class="{
                  'ask-opt-checked': askSelectedOptions.includes(opt),
                  'ask-opt-custom': opt === ASK_CUSTOM_OPTION,
                }"
                @click="toggleAskOption(opt)"
              >{{ opt }}</el-button>
            </div>

            <div v-if="!activeAsk.options || activeAsk.options.length === 0" class="ask-custom-row">
              <el-input
                v-model="askCustomAnswer"
                placeholder="输入你的回答，回车提交"
                size="small"
                :disabled="answeringAsk"
                @keyup.enter="submitAskCustom"
              />
              <el-button
                size="small"
                type="primary"
                :disabled="answeringAsk || !askCustomAnswer.trim()"
                :loading="answeringAsk"
                @click="submitAskCustom"
              >提交</el-button>
            </div>

            <div v-if="askCustomOpen" class="ask-custom-row">
              <el-input
                v-model="askCustomAnswer"
                :placeholder="'输入自定义回答，回车' + (activeAsk.multiple ? '加入已选' : '提交')"
                size="small"
                :disabled="answeringAsk"
                @keyup.enter="submitAskCustom"
              />
              <el-button
                size="small"
                type="primary"
                :disabled="answeringAsk || !askCustomAnswer.trim()"
                :loading="answeringAsk"
                @click="submitAskCustom"
              >{{ activeAsk.multiple ? '加入已选' : '提交' }}</el-button>
            </div>

            <div v-if="activeAsk.multiple" class="ask-multi-bar">
              <span class="ask-multi-picked">已选：{{ askSelectedOptions.join('、') || '（尚未选择）' }}</span>
              <el-button
                size="small"
                type="primary"
                :disabled="answeringAsk || askSelectedOptions.length === 0"
                :loading="answeringAsk"
                @click="submitAskMultiple"
              >提交多选</el-button>
            </div>
          </div>
        </div>

        <!-- 回到最新消息（创作引擎同款）：只要不在底部就悬浮，徽标显示新消息数 -->
        <transition name="jump-fade">
          <div v-if="showJumpButton" class="jump-latest" title="回到最新消息" @click="jumpToBottom">
            <el-badge v-if="newMessageCount > 0" :value="newMessageCount" :max="99" class="jump-badge">
              <span class="jump-circle"><el-icon><ArrowDownBold /></el-icon></span>
            </el-badge>
            <span v-else class="jump-circle"><el-icon><ArrowDownBold /></el-icon></span>
          </div>
        </transition>

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
                activeAsk
                  ? '有 Agent 正在等你回答，请在上方卡片作答'
                  : sessionStatus === 'idle'
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
import { computed, onBeforeUnmount, onMounted, ref, nextTick, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import {
  getAgentRoles,
  getChatSession,
  listChatSessions,
  startChatSession,
  sendChatMessage,
  stopChatSession,
  deleteChatSession,
  applyChatPlan,
  chatSessionStream,
  getChatPendingAsk,
  answerChatAsk,
  resumeChatSession,
  type AgentRoleAsset,
  type AskQuestion,
  type AgentRoleCategory,
  type AgentRoleScenario,
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

/** 窄屏断点（px）：低于此宽度自动收起会话列表 / 会话信息面板。 */
const PANEL_BREAKPOINT = 1100
const SESSION_PANEL_KEY = 'anw:gc-session-panel'
const INFO_PANEL_KEY = 'anw:gc-info-panel'

/** 会话列表面板是否收起（localStorage 记忆；窄屏自动收起）。 */
const sessionPanelCollapsed = ref(false)
/** 会话信息面板是否收起（localStorage 记忆；窄屏自动收起）。 */
const infoPanelCollapsed = ref(false)

/** 初始化面板收起状态：记忆优先，窄屏强制收起。 */
function initPanelCollapse(): void {
  const narrow = window.innerWidth < PANEL_BREAKPOINT
  sessionPanelCollapsed.value = narrow || localStorage.getItem(SESSION_PANEL_KEY) === 'true'
  infoPanelCollapsed.value = narrow || localStorage.getItem(INFO_PANEL_KEY) === 'true'
  window.addEventListener('resize', applyResponsivePanels)
}

/** 窗口变窄时自动收起两侧面板（用户手动展开不强制，仅窄屏触发）。 */
function applyResponsivePanels(): void {
  if (window.innerWidth < PANEL_BREAKPOINT) {
    if (!sessionPanelCollapsed.value) sessionPanelCollapsed.value = true
    if (!infoPanelCollapsed.value) infoPanelCollapsed.value = true
  }
}

watch(sessionPanelCollapsed, (v) => localStorage.setItem(SESSION_PANEL_KEY, String(v)))
watch(infoPanelCollapsed, (v) => localStorage.setItem(INFO_PANEL_KEY, String(v)))

const allRoles = ref<AgentRoleAsset[]>([])
const starting = ref(false)
const sending = ref(false)
const stopping = ref(false)

const form = ref({
  topic: '',
  memberIds: [] as string[],
  maxRounds: 3,
  unlimitedRounds: false,
})

/** 全部合成者角色 id */
const synthesizerRoleIds = computed<string[]>(() =>
  allRoles.value.filter((r) => r.category === 'synthesizer').map((r) => r.id),
)

/** 当前已选中的合成者数量 */
const selectedSynthesizerCount = computed<number>(() =>
  form.value.memberIds.filter((id) => synthesizerRoleIds.value.includes(id)).length,
)

/** 合成者必须保留至少一名：当它是当前唯一已选合成者时锁定不可取消 */
function isSynthesizerLocked(roleId: string): boolean {
  const role = allRoles.value.find((r) => r.id === roleId)
  if (role?.category !== 'synthesizer') return false
  return selectedSynthesizerCount.value <= 1 && form.value.memberIds.includes(roleId)
}

/** 确保至少选中一名合成者（默认全部选中） */
function ensureSynthesizerSelected() {
  if (synthesizerRoleIds.value.length === 0) return
  const hasSyn = form.value.memberIds.some((id) => synthesizerRoleIds.value.includes(id))
  if (!hasSyn) {
    form.value.memberIds = [...new Set([...form.value.memberIds, ...synthesizerRoleIds.value])]
  }
}

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
/** 是否位于消息列表底部附近（自动跟随滚动的开关） */
const atBottom = ref(true)
/** 自动跟随暂停期间累计到达的新消息数 */
const newMessageCount = ref(0)
/** 判定“已到最底部”的滚动容差（px） */
const SCROLL_BOTTOM_THRESHOLD = 120
/** 只要不在最新位置就展示悬浮按钮，类似创作引擎 */
const showJumpButton = computed(() => messages.value.length > 0 && !atBottom.value)
const lastProbe = ref<null | { round: number; ranking: Array<{ memberId: string; priority: number; reason: string }>; note?: string; chosenId: string | null; fallback: boolean; parseOk: boolean; raw: string }>(null)
const probeOpen = ref(false)

// ask_user 提问卡片（工单 12）：某位 Agent 需要作者拍板时挂起本轮，等待作者选择
const activeAsk = ref<AskQuestion | null>(null)
/** 自定义回答选项的标记文案（与后端 AskResolver 保持一致）：点击它打开自定义输入，而非作为普通选项提交 */
const ASK_CUSTOM_OPTION = '✏️ 自定义回答…'
const askMemberId = ref('')
const askMemberName = ref('')
const askSelectedOptions = ref<string[]>([])
const askCustomAnswer = ref('')
const askCustomOpen = ref(false)
const answeringAsk = ref(false)
/** 提问成员（取 category 用于头像配色） */
const askMember = computed(() => members.value.find((m) => m.id === askMemberId.value))

// 过程气泡：按 messageId 聚合思考/工具调用，折叠展示
const processMap = ref<Map<string, { thoughts: string[]; toolCalls: Array<{tool:string, args:any, result:string, success:boolean}>; collapsed: boolean }>>(new Map())

// 系统消息去重（会话级）：系统消息没有稳定 id，重复订阅 / 重连回放会让
// 「讨论开始 / 成员加入」等事件翻倍。记录本会话最近出现过的系统消息内容，相同则跳过。
let recentSystemMessages: string[] = []

let streamController: AbortController | null = null
let streamEpoch = 0
let reconnectTimer: number | null = null
let reconnectAttempts = 0
const SESSION_STORAGE_KEY = 'ai-novel-active-chat-session'

const isRunning = computed(() => sessionStatus.value === 'running' || sessionStatus.value === 'synthesizing')
/** 可发送：idle（等待首条消息激活）或运行中；结束后不可发送；有待回答提问时引导作者用卡片作答。 */
const canSend = computed(() => (sessionStatus.value === 'idle' || isRunning.value) && !activeAsk.value)

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

function toggleProcess(messageId: string) {
  const entry = processMap.value.get(messageId);
  if (entry) { entry.collapsed = !entry.collapsed; processMap.value.set(messageId, { ...entry }); }
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

function shortId(id: string): string {
  return id ? id.slice(0, 8) : ''
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
    reviewer: '挑刺者',
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

function getScenarioLabel(s: AgentRoleScenario): string {
  const labels: Record<AgentRoleScenario, string> = {
    theme: '题材',
    worldview: '世界观',
    outline: '大纲',
    character: '人设',
    plot: '剧情',
    general: '通用',
  }
  return labels[s] || s
}

function getScenarioTagType(s: AgentRoleScenario): string {
  const types: Record<AgentRoleScenario, string> = {
    theme: 'primary',
    worldview: 'success',
    outline: 'warning',
    character: 'danger',
    plot: 'info',
    general: '',
  }
  return types[s] || 'info'
}

function getRoleScenarios(role: AgentRoleAsset): AgentRoleScenario[] {
  return Array.isArray(role.scenario) && role.scenario.length > 0 ? role.scenario : ['general']
}

function avatarClass(target: { kind?: string; memberId?: string; id?: string; category?: AgentRoleCategory | string }): string {
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

/** 是否处于消息列表底部附近 */
function isNearBottom(): boolean {
  const el = messageListRef.value
  if (!el) return true
  return el.scrollTop + el.clientHeight >= el.scrollHeight - SCROLL_BOTTOM_THRESHOLD
}

function scrollToBottom(force = false) {
  nextTick(() => {
    const el = messageListRef.value
    if (!el) return
    if (force || atBottom.value) {
      el.scrollTo({ top: el.scrollHeight, behavior: force ? 'smooth' : 'auto' })
      atBottom.value = true
      newMessageCount.value = 0
    }
  })
}

/** 滚动监听：更新底部状态；用户手动滑回底部时清除未读数并恢复跟随。 */
function handleScroll() {
  const near = isNearBottom()
  atBottom.value = near
  if (near) newMessageCount.value = 0
}

/** 点击悬浮按钮：强制滚到底部并恢复自动跟随。 */
function jumpToBottom() {
  const el = messageListRef.value
  if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  atBottom.value = true
  newMessageCount.value = 0
}

// 创作引擎同款：消息数变化时自动跟随或累计未读；流式更新时若仍在底部则持续跟随
watch(
  () => messages.value.length,
  () => {
    nextTick(() => {
      if (isNearBottom()) {
        atBottom.value = true
        newMessageCount.value = 0
        const el = messageListRef.value
        if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'auto' })
      } else {
        newMessageCount.value += 1
      }
    })
  }
)
watch(
  () => messages.value,
  () => {
    if (isNearBottom()) {
      const el = messageListRef.value
      if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'auto' })
    }
  },
  { deep: true, flush: 'post' }
)

/** ask_user：单选直接提交；多选切换选中集合。 */
function toggleAskOption(opt: string): void {
  if (!activeAsk.value || answeringAsk.value) return
  // 工单 14：自定义回答选项不参与选中/提交，点击改为打开/收起输入框
  if (opt === ASK_CUSTOM_OPTION) {
    askCustomOpen.value = !askCustomOpen.value
    return
  }
  if (activeAsk.value.multiple) {
    const i = askSelectedOptions.value.indexOf(opt)
    if (i >= 0) askSelectedOptions.value.splice(i, 1)
    else askSelectedOptions.value.push(opt)
  } else {
    submitAskAnswer(opt)
  }
}

/** 提交作者对 ask_user 的回答；回答会以 chat_message（作者消息）事件回写讨论历史。 */
async function submitAskAnswer(answer: string): Promise<void> {
  if (!sessionId.value || !activeAsk.value || answeringAsk.value) return
  const text = String(answer ?? '').trim()
  if (!text) return
  answeringAsk.value = true
  try {
    const res = await answerChatAsk(sessionId.value, text)
    // 回答会以 chat_message 事件到达并写入讨论历史，这里先收起卡片
    clearAsk()
    // 工单 12：会话刚由磁盘重建（进程重启后）——回答已写入历史，重建事件流以继续接收后续讨论
    if (res.data?.resumed) {
      connectStream()
    }
  } catch (err: any) {
    console.error('提交作者回答失败:', err)
    ElMessage.error((err?.response?.data?.error as string) || '提交回答失败，请重试')
  } finally {
    answeringAsk.value = false
  }
}

/** ask_user 自定义输入：单选直接提交；多选先加入已选集合，再由「提交多选」统一提交。 */
async function submitAskCustom(): Promise<void> {
  if (!activeAsk.value || answeringAsk.value) return
  const v = askCustomAnswer.value.trim()
  if (!v) return
  if (activeAsk.value.multiple) {
    if (!askSelectedOptions.value.includes(v)) askSelectedOptions.value.push(v)
    askCustomAnswer.value = ''
    return
  }
  await submitAskAnswer(v)
}

/** ask_user 多选提交。 */
async function submitAskMultiple(): Promise<void> {
  if (!activeAsk.value || askSelectedOptions.value.length === 0) return
  await submitAskAnswer(askSelectedOptions.value.join('，'))
}

/** 断连 / 刷新后恢复等待中的 ask 卡片。 */
async function loadPendingAsk() {
  if (!sessionId.value) return
  try {
    const res = await getChatPendingAsk(sessionId.value)
    const d = res.data
    if (d?.has_pending && d.question) {
      activeAsk.value = d.question
      askMemberId.value = d.memberId || ''
      askMemberName.value = d.memberName || '作者'
      askSelectedOptions.value = []
      askCustomAnswer.value = ''
      askCustomOpen.value = false
    }
  } catch (err) {
    console.warn('加载待回答提问失败:', err)
  }
}

/** 清空 ask 卡片状态。 */
function clearAsk() {
  activeAsk.value = null
  askMemberId.value = ''
  askMemberName.value = ''
  askSelectedOptions.value = []
  askCustomAnswer.value = ''
  askCustomOpen.value = false
  answeringAsk.value = false
}

async function loadRoles() {
  try {
    const res = await getAgentRoles()
    // 导演 / 共识裁判为系统角色，不作为讨论成员参与发言，从成员选择器过滤
    allRoles.value = (res.data || []).filter((r) => !r.roleType || r.roleType === 'participant')
    ensureSynthesizerSelected()
  } catch (err) {
    console.error('加载 Agent 角色失败:', err)
    ElMessage.error('加载 Agent 角色失败')
  }
}

async function loadStaticContext(): Promise<Record<string, string>> {
  // 前端只给基础信息，上下文由Agent通过只读工具按需拉取
  return {};
}

async function startChat() {
  if (!currentProject.id) {
    ElMessage.warning('请先选择作品')
    return
  }
  if (selectedSynthesizerCount.value === 0) {
    ElMessage.warning('圆桌会议必须包含至少一名合成者，用于收敛最终方案')
    ensureSynthesizerSelected()
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
      maxRounds: form.value.unlimitedRounds ? 0 : form.value.maxRounds,
      // 上下文预算 / 工具调用次数统一采用「提示词管理 → 圆桌会议」的全局配置，创建表单不再单独配置
    })
    const data = res.data
    sessionId.value = data.sessionId
    topic.value = data.topic
    createdAt.value = new Date().toISOString()
    members.value = data.members
    messages.value = []
    processMap.value.clear()
    clearAsk()
    sessionStatus.value = data.status
    summary.value = ''
    enterRoom()
    pushSystemMessage('讨论已创建，发送第一条消息开启讨论')
  } catch (err: any) {
    console.error('开启圆桌会议失败:', err)
    ElMessage.error((err?.response?.data?.error as string) || '开启圆桌会议失败')
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
  lastProbe.value = null
  probeOpen.value = false
  clearAsk()
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
  processMap.value.clear()
  messages.value = (s.messages || []).map((m) => ({ ...m, streaming: false }))
  sessionStatus.value = s.status || 'idle'
  summary.value = s.summary || ''
  speakingMemberId.value = ''
  speakingMemberName.value = ''
  memberStatus.value = {}
  lastProbe.value = null
  probeOpen.value = false
  clearAsk()
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

/** 节流刷新会话列表：高频事件（状态切换 / 消息 / agent 状态）下 500ms 合并为一次拉取，避免列表停留在旧快照。 */
let sessionsReloadTimer: number | null = null
function refreshSessions() {
  if (sessionsReloadTimer !== null) return
  sessionsReloadTimer = window.setTimeout(() => {
    sessionsReloadTimer = null
    loadSessions()
  }, 500)
}

/** 当前会话状态变化时立即同步列表项，解决「发言后列表仍显示等待开始」： */
function syncSessionStatus(status?: string, extra?: Partial<ChatSessionSnapshot>) {
  if (!sessionId.value) return
  const s = sessions.value.find((x) => x.id === sessionId.value)
  if (s) {
    if (status) s.status = status as ChatSessionStatus
    if (extra) Object.assign(s, extra)
    s.updatedAt = new Date().toISOString()
  }
}

function enterRoom() {
  // 进入新会话时清空系统消息指纹，避免跨会话误判
  recentSystemMessages = []
  phase.value = 'room'
  sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ sessionId: sessionId.value, projectId: currentProject.id }))
  loadSessions()
  lastProbe.value = null;
  probeOpen.value = false;
  // 作者永远在成员列表中
  if (!members.value.some((m) => m.id === 'author')) {
    members.value = [
      ...members.value,
      { id: 'author', kind: 'author', name: '作者', description: '作品作者', category: 'proposer' as AgentRoleCategory },
    ]
  }
  connectStream()
  // 断连 / 刷新后恢复等待中的 ask 卡片
  loadPendingAsk()
  // 进入会话：强制回到底部，恢复自动跟随
  scrollToBottom(true)
}

function pushSystemMessage(text: string) {
  // 防抖：同一会话在重复 SSE 订阅 / 重连回放下，系统事件（讨论开始 / 成员加入 / 讨论主题）
  // 会翻倍到达。这些消息没有稳定 id，改用「最近出现过的内容集合」去重（比只比最近一条更稳）。
  const trimmed = String(text ?? '').trim()
  if (!trimmed) return
  if (recentSystemMessages.includes(trimmed)) return
  recentSystemMessages.push(trimmed)
  if (recentSystemMessages.length > 20) recentSystemMessages.shift()
  messages.value.push({
    id: 'sys-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
    sessionId: sessionId.value,
    memberId: 'system',
    memberName: '系统',
    kind: 'system',
    content: trimmed,
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
  // 流代际守卫：并发/重连时旧的 openStream 循环可能仍持有 streamController 引用，
  // 用 epoch 让过期循环（含其 finally 重连逻辑）立即退出，避免事件重复上屏与重复重连。
  streamController?.abort()
  streamController = new AbortController()
  const epoch = ++streamEpoch
  const controller = streamController
  try {
    for await (const event of chatSessionStream(sessionId.value)) {
      if (controller.signal.aborted || epoch !== streamEpoch) break
      handleChatEvent(event)
    }
  } catch (err) {
    if (epoch !== streamEpoch) return
    console.error('讨论流中断:', err)
  } finally {
    if (epoch !== streamEpoch) return
    if (controller.signal.aborted) return
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
      case 'scheduler_probe': {
        const d = event.data as unknown as { round: number; ranking: Array<{ memberId: string; priority: number; reason: string }>; note?: string; chosenId: string | null; fallback: boolean; parseOk: boolean; raw: string };
        lastProbe.value = { round: d.round, ranking: d.ranking ?? [], note: d.note, chosenId: d.chosenId ?? null, fallback: !!d.fallback, parseOk: !!d.parseOk, raw: d.raw ?? '' };
        probeOpen.value = false;
        const chosenName = members.value.find((m) => m.id === d.chosenId)?.name ?? d.chosenId ?? '';
        const header = d.fallback ? '导演决策失败/超时，按规则兜底选择' : '调度决策：' + chosenName;
        let detail = '';
        if (d.ranking && d.ranking.length > 0) {
          const rows = d.ranking.map((r) => '· ' + (members.value.find((m) => m.id === r.memberId)?.name ?? r.memberId) + '（优先级 ' + r.priority + '）' + (d.chosenId === r.memberId ? ' ←选中' : '') + '「' + r.reason + '」');
          detail = '\n' + rows.join('\n');
        }
        if (d.note) detail += '\n· 导演指引：' + d.note;
        pushSystemMessage(header + detail);
        break;
      }
      case 'thinking': {
        const d = event.data as any;
        if (!d.messageId) break;
        const entry = processMap.value.get(d.messageId) || { thoughts: [], toolCalls: [], collapsed: true };
        entry.thoughts.push(d.content);
        processMap.value.set(d.messageId, entry);
        break;
      }
      case 'tool_call': {
        const d = event.data as any;
        if (!d.messageId) break;
        const entry = processMap.value.get(d.messageId) || { thoughts: [], toolCalls: [], collapsed: true };
        entry.toolCalls.push({ tool: d.tool, args: d.args, result: '', success: true });
        processMap.value.set(d.messageId, entry);
        break;
      }
      case 'tool_result': {
        const d = event.data as any;
        if (!d.messageId) break;
        const entry = processMap.value.get(d.messageId);
        if (entry && entry.toolCalls.length > 0) {
          const last = entry.toolCalls[entry.toolCalls.length-1];
          if (last && last.tool === d.tool) { last.result = d.content; last.success = d.success; }
        }
        processMap.value.set(d.messageId, entry!);
        break;
      }
      case 'ask': {
        const d = event.data
        activeAsk.value = d.question
        askMemberId.value = d.memberId || ''
        askMemberName.value = d.memberName || '作者'
        askSelectedOptions.value = []
        askCustomAnswer.value = ''
        askCustomOpen.value = false
        pushSystemMessage(d.memberName + ' 需要你拍板，请在上方卡片作答')
        break
      }
      case 'system': {
      const data = event.data
      if (data.status) {
        sessionStatus.value = data.status
        syncSessionStatus(data.status)
      }
      if (data.message) pushSystemMessage(data.message)
      refreshSessions()
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
      refreshSessions()
      break
    }
    case 'delta': {
      const data = event.data
      if (!data || !data.messageId) break
      const existing = messages.value.find((m) => m.id === data.messageId)
      if (existing) {
        existing.content = data.content
        existing.streaming = !data.done
        scrollToBottom()
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
      break
    }
    case 'agent_status': {
      const data = event.data
      if (data.memberId) memberStatus.value[data.memberId] = data.status || 'idle'
      refreshSessions()
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
      break
    }
    case 'done': {
      const data = event.data
      sessionStatus.value = data.status || 'completed'
      syncSessionStatus(data.status || 'completed')
      speakingMemberId.value = ''
      speakingMemberName.value = ''
      messages.value.forEach((m) => (m.streaming = false))
      clearAsk()
      if (data.summary) {
        summary.value = data.summary
      }
      pushSystemMessage(data.status === 'terminated' ? '讨论已终止' : '讨论已完成，可查看右侧最终方案并应用')
      sessionStorage.removeItem(SESSION_STORAGE_KEY)
      loadSessions()
      break
    }
    case 'error': {
      const data = event.data
      sessionStatus.value = 'terminated'
      syncSessionStatus('terminated')
      speakingMemberId.value = ''
      speakingMemberName.value = ''
      messages.value.forEach((m) => (m.streaming = false))
      clearAsk()
      pushSystemMessage('讨论出错：' + (data.error || '未知错误'))
      sessionStorage.removeItem(SESSION_STORAGE_KEY)
      loadSessions()
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
  streamEpoch += 1
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
    processMap.value.clear()
    clearAsk()
    sessionStatus.value = data.status
    summary.value = data.summary || ''
    // 工单 12：进程重启后恢复「停在 ask」的会话——先重建后端会话，再进入房间订阅
    if (data.status === 'running' || data.status === 'synthesizing') {
      try {
        await resumeChatSession(saved.sessionId)
      } catch (err) {
        // 非待答 ask 的运行中孤儿会话无法恢复（后端重启后无续跑入口），保持原路径，流端会补发终态
        console.warn('恢复运行中会话失败:', err)
      }
    }
    enterRoom()
  } catch (err) {
    console.warn('恢复会话失败:', err)
    sessionStorage.removeItem(SESSION_STORAGE_KEY)
  }
}

onMounted(() => { initPanelCollapse() })

onMounted(async () => {
  // 从资产页跳转时通过 query 预选角色
  const q = route.query
  if (q && q.roles) {
    const ids = String(q.roles).split(',').filter(Boolean)
    if (ids.length > 0) form.value.memberIds = ids
  }
  await loadRoles()
  // 预选角色后仍保证至少一名合成者
  ensureSynthesizerSelected()
  await loadSessions()
  await restoreSession()
})

onBeforeUnmount(() => {
  closeStream()
  window.removeEventListener('resize', applyResponsivePanels)
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

.synthesizer-note {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 10px;
  padding: 8px 12px;
  background: rgba(79, 70, 229, 0.06);
  border: 1px dashed rgba(79, 70, 229, 0.3);
  border-radius: 8px;
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.5;
}

.synthesizer-note .el-icon {
  color: var(--accent);
  flex-shrink: 0;
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

.rounds-config {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
}

.unlimited-rounds-check {
  margin-top: 8px;
}

.rounds-hint {
  margin-top: 6px;
  font-size: 12px;
  color: var(--text-aux);
  line-height: 1.6;
}

.form-config-hint {
  margin-left: 12px;
  font-size: 12px;
  color: var(--text-aux);
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

/* 收起态：窄条 + 展开按钮（会话列表） */
.session-panel.collapsed,
.info-panel.collapsed {
  align-items: center;
}

.panel-rail {
  flex: 1;
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  gap: 12px;
  padding: 14px 0;
  color: var(--text-aux);
  cursor: pointer;
  transition: color var(--transition-fast), background var(--transition-fast);
}

.panel-rail:hover {
  color: var(--accent);
  background: var(--surface-hover);
}

.rail-label {
  writing-mode: vertical-rl;
  letter-spacing: 3px;
  font-size: 12px;
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

.session-id {
  font-size: 11px;
  color: var(--text-aux);
  flex-shrink: 0;
  white-space: nowrap;
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
  position: relative;
}

/* 收起会话信息时：隐藏面板本体（grid 只剩消息主区一列），保留浮动展开按钮 */
.room-body.info-hidden .info-panel {
  display: none;
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

/* 收起态：右侧浮动展开按钮（会话信息） */
.info-rail {
  position: absolute;
  top: 50%;
  right: 0;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 8px;
  border: 1px solid var(--border-soft);
  border-right: none;
  border-radius: var(--radius-md) 0 0 var(--radius-md);
  background: var(--surface);
  color: var(--text-aux);
  box-shadow: var(--shadow-sm);
  cursor: pointer;
  z-index: 5;
  transition: color var(--transition-fast), background var(--transition-fast);
}

.info-rail:hover {
  color: var(--accent);
  background: var(--surface-hover);
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
.willingness-note {
  margin-top: 4px;
  color: var(--accent);
  font-weight: 600;
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
  position: relative;
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
.willingness-strip {
  border-top: 1px dashed var(--border-soft);
  border-bottom: 1px dashed var(--border-soft);
  padding: 6px 16px;
  background: var(--surface);
  font-size: 12px;
}
.willingness-header {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}
.willingness-title {
  font-weight: 600;
}
.willingness-arrow {
  margin-left: auto;
  transition: transform 0.15s ease;
}
.willingness-arrow.open {
  transform: rotate(180deg);
}
.willingness-body {
  margin-top: 6px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.willingness-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.willingness-row.chosen {
  background: var(--accent-soft);
  border-radius: 4px;
  padding: 2px 6px;
}
.willingness-name {
  min-width: 80px;
  font-weight: 600;
}
.willingness-reason {
  color: var(--text-aux);
}
.willingness-parse {
  color: var(--el-color-danger);
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

/* 回到底部悬浮按钮 */
.scroll-to-bottom-btn {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  bottom: 118px;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border: 1px solid rgba(255, 255, 255, 0.35);
  border-radius: 20px;
  background: var(--accent, #409eff);
  color: #fff;
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.22);
  z-index: 20;
  transition: background 0.15s ease, transform 0.15s ease;
}
.scroll-to-bottom-btn:hover {
  background: #337ecc;
  transform: translateX(-50%) translateY(-1px);
}
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
.jump-fade-enter-active,
.jump-fade-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.jump-fade-enter-from,
.jump-fade-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(6px);
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
.process-bubble {
  background: #f8fafc;
  border: 1px dashed #e2e8f0;
  border-radius: 8px;
  padding: 8px 12px;
  margin: 8px 0 8px 42px;
  max-width: 82%;
  cursor: pointer;
  font-size: 12px;
}
.process-header {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #64748b;
  font-weight: 500;
}
.process-arrow { margin-left: auto; transition: transform 0.15s; }
.process-arrow.open { transform: rotate(180deg); }
.process-body { margin-top: 8px; display: flex; flex-direction: column; gap: 8px; }
.process-thought { color: #475569; background: #fff; padding: 6px 8px; border-radius: 4px; border-left: 3px solid #94a3b8; }
.process-tool { background: #fff; border: 1px solid #e2e8f0; border-radius: 4px; padding: 6px 8px; }
.tool-call { font-weight: 600; color: #0f172a; }
.tool-args { color: #64748b; font-weight: 400; }
.tool-result { margin-top: 4px; padding: 4px 6px; background: #f1f5f9; border-radius: 4px; white-space: pre-wrap; word-break: break-word; }
.tool-result.success { border-left: 3px solid #10b981; }
.tool-result.error { border-left: 3px solid #ef4444; }

/* ===== ask_user 提问卡片 ===== */
.ask-card-wrap {
  padding: 10px 16px 6px;
  border-top: 1px dashed var(--border-soft);
  background: linear-gradient(180deg, rgba(79, 70, 229, 0.05), transparent);
}
.ask-card {
  background: #fff;
  border: 1px solid rgba(79, 70, 229, 0.35);
  border-radius: 10px;
  padding: 12px 14px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.06);
}
.ask-card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
}
.ask-asker {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  min-width: 0;
}
.ask-avatar {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  color: #fff;
  background: var(--accent, #409eff);
}
.ask-asker-text {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.ask-asker-name {
  font-size: 12px;
  color: var(--accent);
  font-weight: 600;
}
.ask-question {
  font-size: 14px;
  color: var(--text-title);
  font-weight: 500;
  line-height: 1.5;
  word-break: break-word;
}
.ask-options {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 10px;
}
.ask-opt-checked { font-weight: 600; }
.ask-opt-custom {
  border-style: dashed !important;
  color: #8a6d3b !important;
}
.ask-custom-row {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}
.ask-custom-row .el-input { flex: 1; }
.ask-multi-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  border-top: 1px dashed var(--border-soft);
  padding-top: 8px;
  margin-top: 2px;
}
.ask-multi-picked {
  font-size: 12px;
  color: var(--text-secondary);
  word-break: break-all;
}
.session-delete-btn {
  margin-left: auto;
  flex-shrink: 0;
  padding: 4px;
}
</style>
