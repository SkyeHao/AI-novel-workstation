<template>
  <div class="ideation-view">
    <!-- 区域零：项目信息卡片 -->
    <el-card class="project-info-card" shadow="never">
      <template #header>
        <div class="card-header-title">
          <el-icon class="header-icon"><Collection /></el-icon>
          <span>项目信息</span>
          <el-tag size="small" type="info" effect="plain" round>{{ projectInfo?.status ? statusLabel(projectInfo.status) : '—' }}</el-tag>
          <div class="session-actions">
            <el-button link type="primary" size="small" @click="toggleEditProject">
              <el-icon><Edit v-if="!editingProject" /><Check v-else /></el-icon>
              {{ editingProject ? '完成编辑' : '编辑' }}
            </el-button>
          </div>
        </div>
      </template>

      <!-- 展示模式 -->
      <el-descriptions v-if="!editingProject" :column="2" size="small" border>
        <el-descriptions-item label="书名">{{ projectInfo?.name || '—' }}</el-descriptions-item>
        <el-descriptions-item label="题材类型">{{ projectInfo?.genre || '—' }}</el-descriptions-item>
        <el-descriptions-item label="目标平台">{{ projectInfo?.platform ? platformLabel(projectInfo.platform) : '—' }}</el-descriptions-item>
        <el-descriptions-item label="目标字数">{{ projectInfo?.target_words ? formatWords(projectInfo.target_words) : '—' }}</el-descriptions-item>
        <el-descriptions-item label="核心梗" :span="2">{{ projectInfo?.idea || '（未填写）' }}</el-descriptions-item>
      </el-descriptions>

      <!-- 编辑模式 -->
      <el-form v-else :model="projectEditForm" label-width="80px" class="project-edit-form">
        <el-form-item label="书名">
          <el-input v-model="projectEditForm.name" maxlength="32" show-word-limit />
        </el-form-item>
        <el-form-item label="题材类型">
          <el-select v-model="projectEditForm.genre" placeholder="选择类型" clearable style="width: 100%">
            <el-option v-for="g in genreOptions" :key="g" :label="g" :value="g" />
          </el-select>
        </el-form-item>
        <el-form-item label="核心梗">
          <el-input
            v-model="projectEditForm.idea"
            type="textarea"
            :rows="2"
            placeholder="谁 + 陷入什么死局 + 靠什么翻盘 + 最后爽到什么程度"
          />
        </el-form-item>
        <el-form-item label="目标字数">
          <el-input-number v-model="projectEditForm.target_words" :min="0" :step="500000" :max="5000000" style="width: 100%" />
        </el-form-item>
        <el-form-item label="目标平台">
          <el-select v-model="projectEditForm.platform" placeholder="可选" clearable style="width: 100%">
            <el-option label="番茄" value="fanqie" />
            <el-option label="起点" value="qidian" />
            <el-option label="晋江" value="jinjiang" />
            <el-option label="纵横" value="zongheng" />
          </el-select>
        </el-form-item>
        <div class="edit-actions">
          <el-button size="small" @click="editingProject = false">取消</el-button>
          <el-button type="primary" size="small" :loading="savingProject" @click="saveProjectInfo">保存</el-button>
        </div>
      </el-form>
    </el-card>

    <!-- 区域一：会话信息 / 创建表单 -->
    <el-card class="session-card" shadow="never">
      <template #header>
        <div class="card-header-title">
          <el-icon class="header-icon"><ChatDotRound /></el-icon>
          <span>创意会话</span>
          <el-tag size="small" type="info" effect="plain" round>阶段1 · 多轮对话</el-tag>
          <el-tag v-if="sessionInfo?.done" size="small" type="success" effect="dark" round>
            已完成
          </el-tag>
          <div class="session-actions">
            <el-button
              v-if="sessionInfo?.done && projectId"
              type="success"
              size="small"
              :loading="generatingSettings"
              @click="handleGenerateSettings"
            >
              <el-icon><MagicStick /></el-icon>
              生成设定
            </el-button>
            <el-button v-if="sessionId" link type="danger" size="small" @click="handleDeleteSession">
              <el-icon><Delete /></el-icon>
              结束会话
            </el-button>
            <el-button link type="primary" size="small" @click="handleNewSession">
              <el-icon><Plus /></el-icon>
              新建会话
            </el-button>
          </div>
        </div>
      </template>

      <!-- 未创建会话：显示创建表单 -->
      <el-form v-if="!sessionId" label-position="top" :model="sessionForm" class="create-form">
        <div class="form-row">
          <el-form-item label="项目名称">
            <el-input v-model="sessionForm.project_name" placeholder="留空则从首条消息自动提取" clearable />
          </el-form-item>
          <el-form-item label="题材类型">
            <el-select v-model="sessionForm.genre" placeholder="选择题材" clearable style="width: 100%">
              <el-option v-for="g in genreOptions" :key="g" :label="g" :value="g" />
            </el-select>
          </el-form-item>
          <el-form-item label="目标平台">
            <el-select v-model="sessionForm.platform" placeholder="选择平台" clearable style="width: 100%">
              <el-option v-for="p in platformOptions" :key="p" :label="p" :value="p" />
            </el-select>
          </el-form-item>
          <el-form-item label="目标字数">
            <el-select v-model="sessionForm.target_words" placeholder="选择字数" clearable style="width: 100%">
              <el-option v-for="w in wordsOptions" :key="w" :label="w" :value="w" />
            </el-select>
          </el-form-item>
        </div>
        <div class="form-tip">
          可直接在下方对话输入你的创意，首个消息将自动创建会话。
        </div>
      </el-form>

      <!-- 已创建会话：显示会话信息 -->
      <el-descriptions v-else :column="4" size="small" border>
        <el-descriptions-item label="项目名称">{{ sessionInfo?.project_name || '（提取中）' }}</el-descriptions-item>
        <el-descriptions-item label="题材">{{ sessionInfo?.genre || '-' }}</el-descriptions-item>
        <el-descriptions-item label="平台">{{ sessionInfo?.platform || '-' }}</el-descriptions-item>
        <el-descriptions-item label="目标字数">{{ sessionInfo?.target_words || '-' }}</el-descriptions-item>
        <el-descriptions-item label="消息数">{{ sessionInfo?.message_count ?? 0 }}</el-descriptions-item>
        <el-descriptions-item label="创建时间">{{ sessionInfo?.created_at }}</el-descriptions-item>
        <el-descriptions-item label="文档状态">
          <el-tag :type="sessionInfo?.vision_doc_exists ? 'success' : 'info'" size="small" effect="plain">
            {{ sessionInfo?.vision_doc_exists ? '已生成' : '未生成' }}
          </el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="会话状态">
          <el-tag :type="sessionInfo?.done ? 'success' : 'primary'" size="small" effect="plain">
            {{ sessionInfo?.done ? '已完成' : '进行中' }}
          </el-tag>
        </el-descriptions-item>
      </el-descriptions>
    </el-card>

    <!-- 区域二：多轮对话区 -->
    <el-card class="chat-card" shadow="never">
      <template #header>
        <div class="card-header-title">
          <el-icon class="header-icon"><Message /></el-icon>
          <span>对话</span>
          <el-tag size="small" type="info" effect="plain" round>
            {{ sessionId ? `会话 ${shortId(sessionId)}` : '未创建' }}
          </el-tag>
          <el-tag v-if="running" size="small" type="warning" effect="dark" round>
            Agent 处理中...
          </el-tag>
        </div>
      </template>

      <div ref="chatContainer" class="chat-container">
        <el-empty v-if="messages.length === 0" description="输入你的创意灵感，与 Agent 多轮共创吧" :image-size="80" />
        <div v-for="msg in messages" :key="msg._key" class="chat-message" :class="msg.role">
          <div class="msg-avatar" :class="msg.role">
            <el-icon><User v-if="msg.role === 'user'" /><Monitor v-else /></el-icon>
          </div>
          <div class="msg-body">
            <div class="msg-bubble">
              <!-- 仅 assistant 显示"Agent 回答"标签 -->
              <div v-if="msg.role === 'assistant' && msg.content" class="msg-answer-label">
                <el-icon><ChatLineSquare /></el-icon>
                <span>Agent 回答</span>
              </div>
              <!-- 用户消息：纯文本 -->
              <div v-if="msg.role === 'user' && msg.content" class="msg-content user-text">{{ msg.content }}</div>
              <!-- assistant 最终回答：Markdown 渲染 -->
              <div
                v-else-if="msg.role === 'assistant' && msg.content"
                class="msg-content markdown-body"
                v-html="renderMarkdown(msg.content)"
              ></div>
              <!-- 流式输出中的实时文本 -->
              <div v-if="msg.loading && msg.streamText" class="msg-streaming">
                <span class="stream-text">{{ msg.streamText }}</span>
                <span class="stream-caret">▍</span>
              </div>
              <!-- 思考过程实时流式 -->
              <div v-if="msg.thinkingText" class="msg-thinking">
                <span class="thinking-label">💭 正在思考</span>
                <span class="thinking-text">{{ msg.thinkingText }}</span>
                <span class="stream-caret">▍</span>
              </div>
              <div v-if="msg.error" class="msg-error">{{ msg.error }}</div>
              <div v-if="msg.awaitingAnswer" class="msg-awaiting">
                <el-icon><QuestionFilled /></el-icon>
                <span>等待你回答上方的选择...</span>
              </div>
              <div v-if="msg.loading && !msg.content && !msg.streamText && !msg.awaitingAnswer" class="msg-loading">
                <el-icon class="is-loading"><Loading /></el-icon>
                <span>Agent 正在思考...</span>
              </div>
              <!-- 思考过程：ReAct 步骤，实时流式展示 -->
              <div v-if="msg.steps.length > 0" class="msg-steps">
                <div class="section-label">💭 思考过程</div>
                <div
                  v-for="step in msg.steps"
                  :key="step.step_index"
                  class="msg-step-item"
                  :class="{ 'step-final': step.is_final }"
                >
                  <div class="msg-step-head">
                    <el-tag size="small" :type="step.is_final ? 'success' : 'primary'" effect="plain" round>
                      {{ step.is_final ? '最终回答' : `步骤 ${step.step_index}` }}
                    </el-tag>
                    <el-tag v-if="step.tool_name" size="small" type="warning" effect="plain">
                      🔧 {{ step.tool_name }}
                    </el-tag>
                  </div>
                  <div v-if="step.thought" class="msg-step-thought">
                    {{ stepThoughtText(step) }}
                    <el-button
                      v-if="step.thought.length > 120"
                      link type="primary" size="small"
                      @click="step.expanded = !step.expanded"
                    >
                      {{ step.expanded ? '收起' : '展开' }}
                    </el-button>
                  </div>
                  <div v-if="step.observation" class="msg-step-obs">
                    <span class="obs-label">👁️ 观察</span>
                    <span class="obs-text" :class="{ collapsed: !step.obsExpanded }">{{ step.observation }}</span>
                    <el-button
                      v-if="step.observation.length > 80"
                      link type="primary" size="small"
                      @click="step.obsExpanded = !step.obsExpanded"
                    >
                      {{ step.obsExpanded ? '收起' : '展开全部' }}
                    </el-button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="chat-input">
        <el-input
          v-model="input"
          type="textarea"
          :autosize="{ minRows: 1, maxRows: 4 }"
          :placeholder="sessionId ? '继续补充你的想法...' : '输入你的创意灵感，回车发送'"
          resize="none"
          :disabled="running"
          @keydown.enter.exact.prevent="handleSend"
        />
        <el-button
          type="primary"
          :disabled="running || !input.trim() || sessionInfo?.done"
          class="send-btn"
          @click="handleSend"
        >
          <el-icon v-if="!running"><Promotion /></el-icon>
          <span>{{ running ? '处理中...' : '发送' }}</span>
        </el-button>
      </div>
      <div v-if="sessionInfo?.done" class="done-tip">
        会话已完成。点击"新建会话"开启新一轮创作。
      </div>
    </el-card>

    <!-- Agent 向作者提问（ask_user） -->
    <el-card v-if="pendingAsk" class="ask-card" shadow="never">
      <template #header>
        <div class="card-header-title">
          <el-icon class="header-icon"><QuestionFilled /></el-icon>
          <span>Agent 需要你的选择</span>
          <el-tag size="small" type="warning" effect="dark" round>等待回答</el-tag>
        </div>
      </template>

      <div class="ask-body">
        <div class="ask-question">{{ pendingAsk.question }}</div>

        <el-checkbox-group
          v-if="pendingAsk.options && pendingAsk.options.length > 0"
          v-model="askSelection"
          class="ask-options"
        >
          <el-checkbox
            v-for="opt in pendingAsk.options"
            :key="opt"
            :value="opt"
            :label="opt"
            border
            class="ask-option"
          />
        </el-checkbox-group>
        <div v-else class="ask-no-options">无预设选项，可直接输入你的想法：</div>

        <el-input
          v-if="pendingAsk.allow_custom"
          v-model="askCustom"
          type="textarea"
          :autosize="{ minRows: 2, maxRows: 4 }"
          :placeholder="pendingAsk.multiple ? '可补充自定义内容（与所选选项一起提交）' : '或输入自定义回答...'"
          resize="none"
          class="ask-custom-input"
        />

        <div class="ask-actions">
          <el-button type="primary" :loading="askSubmitting" @click="handleSubmitAsk">
            <el-icon><Promotion /></el-icon>
            <span>提交</span>
          </el-button>
          <span v-if="pendingAsk.multiple" class="ask-hint">支持多选</span>
        </div>
      </div>
    </el-card>

    <!-- 区域三：最近一轮结果 -->
    <el-card
      v-if="lastTurn && lastTurn.vision_doc_path"
      class="result-card"
      :class="lastTurn.success ? 'result-success' : 'result-fail'"
      shadow="never"
    >
      <template #header>
        <div class="card-header-title">
          <el-icon class="header-icon">
            <CircleCheckFilled v-if="lastTurn.success" />
            <CircleCloseFilled v-else />
          </el-icon>
          <span>最近结果</span>
          <el-tag size="small" :type="lastTurn.success ? 'success' : 'danger'" effect="dark" round>
            {{ lastTurn.success ? '文档已生成' : '进行中' }}
          </el-tag>
        </div>
      </template>

      <div class="result-body">
        <div class="result-info">
          <div class="info-row">
            <span class="info-label">项目路径：</span>
            <el-tag type="success" effect="plain" round>{{ lastTurn.project_path || '未生成' }}</el-tag>
          </div>
          <div class="info-row">
            <span class="info-label">愿景文档：</span>
            <span class="info-value">{{ lastTurn.vision_doc_path || '未生成' }}</span>
          </div>
        </div>
        <div class="result-actions">
          <el-button
            type="primary"
            :loading="docLoading"
            :disabled="!lastTurn.vision_doc_path"
            @click="handleViewDoc"
          >
            <el-icon><Document /></el-icon>
            <span>查看文档</span>
          </el-button>
        </div>
      </div>
    </el-card>

    <!-- 区域四：最近一轮 LLM 交互记录 -->
    <el-card
      v-if="lastTurn && lastTurn.interactions && lastTurn.interactions.length > 0"
      class="interactions-card"
      shadow="never"
    >
      <template #header>
        <div class="card-header-title">
          <el-icon class="header-icon"><Monitor /></el-icon>
          <span>最近一轮 LLM 底层交互</span>
          <el-tag size="small" type="info" effect="plain" round>
            {{ lastTurn.interactions.length }} 次调用
          </el-tag>
          <el-tag size="small" type="warning" effect="plain" round>
            总 Token: {{ totalTokens }}
          </el-tag>
          <div class="interactions-actions">
            <el-button link type="primary" size="small" @click="expandAllInteractions">
              <el-icon><Expand /></el-icon>
              展开全部
            </el-button>
            <el-button link type="info" size="small" @click="collapseAllInteractions">
              <el-icon><Fold /></el-icon>
              收起全部
            </el-button>
          </div>
        </div>
      </template>

      <el-collapse v-model="activeInteractions" class="interactions-collapse">
        <el-collapse-item
          v-for="(interaction, index) in lastTurn.interactions"
          :key="index"
          :name="index"
        >
          <template #title>
            <div class="interaction-title">
              <span class="interaction-index">调用 #{{ index + 1 }}</span>
              <el-tag size="small" type="primary" effect="plain">{{ interaction.model }}</el-tag>
              <el-tag size="small" type="info" effect="plain">{{ interaction.elapsed_ms }} ms</el-tag>
              <el-tag size="small" type="warning" effect="plain">{{ interaction.total_tokens }} tokens</el-tag>
              <el-tag v-if="interaction.error" size="small" type="danger" effect="dark">错误</el-tag>
            </div>
          </template>

          <el-alert
            v-if="interaction.error"
            type="error"
            :title="interaction.error"
            show-icon
            :closable="false"
            class="interaction-error"
          />

          <!-- 简要 LLM 输出 -->
          <div class="brief-output-block">
            <div class="section-label">📝 简要输出</div>
            <pre class="brief-output">{{ briefInteractionOutput(interaction) }}</pre>
          </div>

          <div class="interaction-section">
            <div class="section-label">📤 请求</div>
            <div class="params-row">
              <el-tag size="small" type="info" effect="plain">
                temperature: {{ interaction.temperature }}
              </el-tag>
              <el-tag v-if="interaction.max_tokens !== null" size="small" type="info" effect="plain">
                max_tokens: {{ interaction.max_tokens }}
              </el-tag>
              <el-tag size="small" type="info" effect="plain">
                function_call: {{ formatFunctionCall(interaction.function_call) }}
              </el-tag>
            </div>

            <div class="messages-list">
              <div
                v-for="(msg, mIdx) in interaction.messages"
                :key="mIdx"
                class="message-item"
              >
                <el-tag
                  :type="roleTagType(msg.role)"
                  size="small"
                  effect="dark"
                  class="message-role"
                  :class="{ 'role-assistant-tag': msg.role === 'assistant' }"
                >
                  {{ msg.role }}
                </el-tag>
                <div class="message-body">
                  <pre v-if="msg.content" class="message-content">{{
                    getMessageDisplay(msg.content, index, mIdx)
                  }}</pre>
                  <div v-if="msg.function_call" class="function-call-block">
                    <el-tag size="small" type="warning" effect="plain">
                      🔧 {{ msg.function_call.name }}
                    </el-tag>
                    <pre class="message-content">{{ formatJson(msg.function_call.arguments) }}</pre>
                  </div>
                  <div v-if="msg.name" class="function-name-tag">
                    <el-tag size="small" type="warning" effect="plain" round>name: {{ msg.name }}</el-tag>
                  </div>
                  <el-button
                    v-if="msg.content && msg.content.length > 500"
                    link
                    type="primary"
                    size="small"
                    @click="toggleMessage(index, mIdx)"
                  >
                    {{ isMessageExpanded(index, mIdx) ? '收起' : '展开全部' }}
                  </el-button>
                </div>
              </div>
            </div>

            <div v-if="getFunctionNames(interaction).length > 0" class="functions-block">
              <div class="section-label">可用函数</div>
              <div class="functions-list">
                <el-tag
                  v-for="fnName in getFunctionNames(interaction)"
                  :key="fnName"
                  size="small"
                  type="warning"
                  effect="plain"
                >
                  {{ fnName }}
                </el-tag>
              </div>
            </div>
          </div>

          <div class="interaction-section">
            <div class="section-label">📥 响应</div>
            <el-descriptions :column="2" border size="small" class="response-desc">
              <el-descriptions-item label="finish_reason">
                {{ interaction.finish_reason }}
              </el-descriptions-item>
              <el-descriptions-item label="耗时">
                {{ interaction.elapsed_ms }} ms
              </el-descriptions-item>
              <el-descriptions-item label="prompt_tokens">
                {{ interaction.prompt_tokens }}
              </el-descriptions-item>
              <el-descriptions-item label="completion_tokens">
                {{ interaction.completion_tokens }}
              </el-descriptions-item>
              <el-descriptions-item label="total_tokens">
                {{ interaction.total_tokens }}
              </el-descriptions-item>
              <el-descriptions-item label="时间戳">
                {{ interaction.timestamp }}
              </el-descriptions-item>
            </el-descriptions>

            <div v-if="interaction.response_content" class="response-content-block">
              <div class="section-label">响应内容</div>
              <pre class="message-content">{{ interaction.response_content }}</pre>
            </div>

            <div v-if="interaction.response_function_call" class="response-fc-block">
              <div class="section-label">响应函数调用</div>
              <el-tag size="small" type="warning" effect="plain">
                🔧 {{ interaction.response_function_call.name }}
              </el-tag>
              <pre class="message-content">{{ formatJson(interaction.response_function_call.arguments) }}</pre>
            </div>

            <div v-if="interaction.tool_name" class="tool-result-block">
              <div class="section-label">
                工具执行结果
                <el-tag
                  :type="interaction.tool_success ? 'success' : 'danger'"
                  size="small"
                  effect="dark"
                  round
                  class="tool-status-tag"
                >
                  {{ interaction.tool_success ? '成功' : '失败' }}
                </el-tag>
              </div>
              <div class="tool-info-row">
                <span class="tool-info-label">工具名称</span>
                <el-tag size="small" type="primary" effect="plain">
                  🔧 {{ interaction.tool_name }}
                </el-tag>
              </div>
              <div class="tool-info-row">
                <span class="tool-info-label">调用参数</span>
                <pre class="message-content tool-args-content">{{ formatJson(interaction.tool_args) }}</pre>
              </div>
              <div class="tool-info-row">
                <span class="tool-info-label">执行结果</span>
                <pre
                  class="message-content"
                  :class="interaction.tool_success ? 'tool-result-ok' : 'tool-result-err'"
                >{{ interaction.tool_result }}</pre>
              </div>
            </div>
          </div>
        </el-collapse-item>
      </el-collapse>
    </el-card>

    <!-- 文档预览弹窗 -->
    <el-dialog
      v-model="docDialogVisible"
      title="故事愿景文档"
      width="70%"
      top="6vh"
      destroy-on-close
    >
      <div v-loading="docLoading" class="doc-dialog-body">
        <pre v-if="docContent" class="doc-content">{{ docContent }}</pre>
        <el-empty v-else-if="!docLoading" description="文档内容为空" />
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, nextTick, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import {
  createSession,
  getSession,
  listSessions,
  getSessionMessages,
  deleteSession,
  sessionMessageStream,
  submitSessionAnswer,
  fileRead,
  getProject,
  updateProject,
  generateSettings,
  type SessionCreateRequest,
  type SessionInfo,
  type Stage1TurnResult,
  type Stage1Step,
  type LLMInteraction,
  type AskQuestion,
} from '@/api'
import { setCurrentProject } from '@/stores/currentProject'

const route = useRoute()
const router = useRouter()

const projectId = ref((route.params.id as string) || '')
const projectInfo = ref<any>(null)
const editingProject = ref(false)
const savingProject = ref(false)
const projectEditForm = reactive({ name: '', genre: '', idea: '', target_words: 0, platform: '' })

const PLATFORM_LABELS: Record<string, string> = {
  fanqie: '番茄',
  qidian: '起点',
  jinjiang: '晋江',
  zongheng: '纵横',
}

function platformLabel(p: string): string {
  return PLATFORM_LABELS[p] || p
}

function formatWords(w: number): string {
  if (w >= 10000) return `${(w / 10000).toFixed(0)} 万字`
  return `${w} 字`
}

/** 数字转会话表单的字数选项（如 2000000 → "200万字"） */
function wordsOptionFor(w: number): string {
  if (!w) return ''
  const wan = Math.round(w / 10000)
  return `${wan}万字`
}

const STATUS_LABELS: Record<string, string> = {
  ideation: '创意中',
  setting: '设定中',
  writing: '写作中',
  reviewing: '审阅中',
}

function statusLabel(s: string): string {
  return STATUS_LABELS[s] || s
}

/** 把项目数据同步到表单（编辑 + 会话） */
function syncProjectToForms(p: any) {
  projectEditForm.name = p?.name || ''
  projectEditForm.genre = p?.genre || ''
  projectEditForm.idea = p?.idea || ''
  projectEditForm.target_words = p?.target_words || 0
  projectEditForm.platform = p?.platform || ''
  // 会话表单回填，避免重复输入
  sessionForm.project_name = p?.name || sessionForm.project_name
  if (p?.genre) {
    sessionForm.genre = p.genre
  }
  if (p?.platform) {
    sessionForm.platform = platformLabel(p.platform)
  }
  if (p?.target_words) {
    sessionForm.target_words = wordsOptionFor(p.target_words)
  }
}

function toggleEditProject() {
  if (editingProject.value) {
    // 取消编辑，恢复原值
    syncProjectToForms(projectInfo.value)
    editingProject.value = false
  } else {
    editingProject.value = true
  }
}

async function saveProjectInfo() {
  if (!projectId.value) return
  savingProject.value = true
  try {
    const { data } = await updateProject(projectId.value, {
      name: projectEditForm.name.trim() || undefined,
      genre: projectEditForm.genre,
      idea: projectEditForm.idea,
      target_words: projectEditForm.target_words,
      platform: projectEditForm.platform,
    })
    projectInfo.value = data
    syncProjectToForms(data)
    editingProject.value = false
    ElMessage.success('项目信息已保存')
  } catch (e: any) {
    ElMessage.error(`保存失败: ${e?.response?.data?.detail || e?.message || e}`)
  } finally {
    savingProject.value = false
  }
}

async function resetState() {
  sessionId.value = ''
  sessionInfo.value = null
  messages.value = []
  input.value = ''
  lastTurn.value = null
  pendingAsk.value = null
  projectInfo.value = null
  activeAssistant.value = null
  activeInteractions.value = []
}

/** 初始化当前项目（进入页面 / 切换项目时调用） */
async function initProject() {
  await resetState()
  if (projectId.value) {
    try {
      const { data } = await getProject(projectId.value)
      projectInfo.value = data
      setCurrentProject(data.id, data.name)
      syncProjectToForms(data)
    } catch {
      /* 忽略 */
    }
    // 恢复上次会话
    await tryRestoreSession()
  }
}

onMounted(initProject)

// keep-alive 缓存下切换不同项目时重新初始化
watch(
  () => route.params.id,
  async (id) => {
    if (id && id !== projectId.value) {
      projectId.value = id as string
      await initProject()
    }
  }
)

/** 尝试恢复该项目的最近会话 */
async function tryRestoreSession() {
  try {
    const name = sessionForm.project_name || projectInfo.value?.name || ''
    const { data: sessions } = await listSessions(projectId.value, name)
    if (!sessions || sessions.length === 0) return
    // 优先最近的会话（列表已按 updated_at 倒序）
    const latest = sessions[0]
    const { data: info } = await getSession(latest.session_id)
    sessionId.value = latest.session_id
    sessionInfo.value = info
    // 恢复消息历史（过滤 system）
    const { data: msgData } = await getSessionMessages(latest.session_id)
    const restored: ChatItem[] = []
    let pendingToolResult = ''  // 待关联的工具结果（来自【工具 X 执行结果】user 消息）

    for (const m of msgData.messages || []) {
      if (m.role === 'system') continue

      // 工具结果回填消息：暂存，关联到下一个 assistant 步骤
      if (m.role === 'user' && isToolResultMessage(m.content || '')) {
        pendingToolResult = m.content || ''
        continue
      }

      if (m.role === 'user') {
        restored.push(makeChatItem({ role: 'user', content: m.content || '', loading: false, steps: [] }))
        continue
      }

      // assistant：尝试解析 jsonfc 协议消息
      if (m.role === 'assistant') {
        const proto = parseJsonfcProtocol(m.content || '')
        if (proto) {
          const { thought, toolName, done } = proto
          if (done) {
            // 最终回答
            restored.push(makeChatItem({ role: 'assistant', content: thought, loading: false, steps: [] }))
          } else {
            // 中间轮：组装为一条带步骤的 assistant 消息
            const steps: DisplayStep[] = [{
              step_index: 1,
              thought,
              tool_name: toolName || '',
              tool_args: '',
              observation: pendingToolResult,
              is_final: false,
              expanded: false,
              obsExpanded: false,
            }]
            restored.push(makeChatItem({
              role: 'assistant',
              content: '',
              loading: false,
              steps,
              result: null,
            }))
          }
        } else {
          // 普通文本回答
          restored.push(makeChatItem({ role: 'assistant', content: m.content || '', loading: false, steps: [] }))
        }
        pendingToolResult = ''
      }
    }
    if (restored.length > 0) {
      messages.value = restored
      ElMessage.info(`已恢复上次会话（${restored.length} 条消息）`)
      scrollToBottom()
    }
  } catch {
    /* 恢复失败不影响使用 */
  }
}

/** 解析 jsonfc 协议消息：{"thought","tool_call","done"} */
interface JsonfcProto {
  thought: string
  toolName: string
  done: boolean
}
function parseJsonfcProtocol(content: string): JsonfcProto | null {
  const s = content.indexOf('{')
  const e = content.lastIndexOf('}')
  if (s < 0 || e <= s) return null
  const body = content.slice(s, e + 1)

  // 标准解析 + 容错修复（模型偶尔输出坏 JSON：未转义引号/尾逗号）
  let data: any = null
  const candidates = [body, repairJson(body)]
  for (const cand of candidates) {
    if (cand == null) continue
    try {
      data = JSON.parse(cand)
      break
    } catch {
      continue
    }
  }
  if (data === null) {
    // 整体 JSON 无法解析（可能是被截断）：尽力提取 thought 和工具名
    const thought = extractThought(body)
    const tcObj = extractToolCallObj(body)
    if (thought || tcObj) {
      return { thought, toolName: tcObj ? String(tcObj.name || '') : '', done: false }
    }
    return null
  }
  if (typeof data !== 'object') return null
  // 必须看起来像协议消息（含 thought 字段）才解析
  if (!('thought' in data)) return null

  // done：优先顶层，其次从 tool_call 内部（模型偶尔写错位置）
  let done = false
  if ('done' in data) {
    done = Boolean(data.done)
  }
  const tc = data.tool_call
  if (tc && typeof tc === 'object' && 'done' in tc && !('done' in data)) {
    done = Boolean(tc.done)
  }
  // tool_call：可能是 {"name","arguments"} 或 {"name","arguments","done"}（done 误入）
  let toolName = ''
  if (tc && typeof tc === 'object' && tc.name) {
    toolName = String(tc.name)
  }
  return { thought: String(data.thought || ''), toolName, done }
}

/** 修复模型输出的坏 JSON（未转义引号 / 尾逗号） */
function repairJson(body: string): string | null {
  if (!body) return null
  // 先清理多余逗号
  const noTrailing = body.replace(/,\s*([}\]])/g, '$1')
  if (noTrailing !== body) {
    try { JSON.parse(noTrailing); return noTrailing } catch { /* fallthrough */ }
  }
  // 修复字符串内部的未转义双引号
  const out: string[] = []
  let inStr = false
  let escaped = false
  let i = 0
  while (i < noTrailing.length) {
    const ch = noTrailing[i]
    if (escaped) { out.push(ch); escaped = false; i++; continue }
    if (ch === '\\') { out.push(ch); escaped = true; i++; continue }
    if (ch === '"') {
      if (inStr) {
        const prev = out.length ? out[out.length - 1] : ''
        const nxt = i + 1 < noTrailing.length ? noTrailing[i + 1] : ''
        // 结构引号：紧邻 , ] } : 或字符串边界（空）
        const isStructPrev = prev === ',' || prev === ':' || prev === '[' || prev === '{' || prev === ''
        const isStructNext = nxt === ',' || nxt === ']' || nxt === '}' || nxt === ':' || nxt === ''
        if (isStructPrev || isStructNext) {
          inStr = false
          out.push(ch)
        } else {
          out.push('\\"')
        }
      } else {
        inStr = true
        out.push(ch)
      }
    } else {
      out.push(ch)
    }
    i++
  }
  const repaired = out.join('')
  try { JSON.parse(repaired); return repaired } catch { return null }
}

/** 从（可能截断的）JSON 中提取 thought 字段值 */
function extractThought(body: string): string {
  const m = body.match(/"thought"\s*:\s*"((?:[^"\\]|\\.)*)/)
  if (!m) return ''
  // 反转义
  return m[1].replace(/\\(.)/g, '$1')
}

/** 整体 JSON 坏到无法修复时，尽力提取 tool_call 子对象 */
function extractToolCallObj(body: string): { name?: string } | null {
  const idx = body.indexOf('"tool_call"')
  if (idx < 0) return null
  const valStart = body.indexOf('{', idx)
  if (valStart < 0) return null
  let depth = 0
  let inStr = false
  let escaped = false
  for (let i = valStart; i < body.length; i++) {
    const ch = body[i]
    if (escaped) { escaped = false; continue }
    if (ch === '\\') { escaped = true; continue }
    if (ch === '"') { inStr = !inStr; continue }
    if (inStr) continue
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        const sub = body.slice(valStart, i + 1)
        for (const cand of [sub, repairJson(sub)]) {
          if (!cand) continue
          try {
            const obj = JSON.parse(cand)
            if (obj && typeof obj === 'object' && obj.name) return obj
          } catch { continue }
        }
        return null
      }
    }
  }
  return null
}

// 组件名：供 App.vue 的 <keep-alive :include="['IdeationView']"> 匹配，
// 保证切换到其他页面再回来时会话状态不丢失
defineOptions({ name: 'IdeationView' })

/** 渲染 Markdown 为安全 HTML */
const renderMarkdown = (text: string): string => {
  if (!text) return ''
  try {
    const raw = marked.parse(text) as string
    return DOMPurify.sanitize(raw)
  } catch {
    return text
  }
}

/** 展示用步骤（携带展开状态） */
interface DisplayStep extends Stage1Step {
  expanded: boolean
  obsExpanded: boolean
}

/** 对话消息 */
interface ChatItem {
  _key: number
  role: 'user' | 'assistant'
  content: string
  streamText: string
  thinkingText: string
  loading: boolean
  awaitingAnswer?: boolean
  error?: string
  steps: DisplayStep[]
  result?: Stage1TurnResult | null
}

const genreOptions = ['玄幻', '都市', '科幻', '历史', '系统流', '重生', '穿越', '末世', '游戏', '灵异', '军事', '其他']
const platformOptions = ['番茄', '起点', '纵横', '其他']
const wordsOptions = ['20万字', '50万字', '100万字', '200万字', '500万字']

// 会话创建表单
const sessionForm = reactive<SessionCreateRequest>({
  project_name: '',
  genre: '',
  platform: '',
  target_words: '',
})

// 会话状态
const sessionId = ref<string>('')
const sessionInfo = ref<SessionInfo | null>(null)
const messages = ref<ChatItem[]>([])
const input = ref('')
const running = ref(false)
const lastTurn = ref<Stage1TurnResult | null>(null)

// 消息唯一 key 递增器
let msgKeyCounter = 0
function nextMsgKey(): number {
  msgKeyCounter += 1
  return msgKeyCounter
}
function makeChatItem(partial: Partial<ChatItem> & { role: 'user' | 'assistant' }): ChatItem {
  return {
    _key: nextMsgKey(),
    content: '',
    streamText: '',
    thinkingText: '',
    loading: false,
    steps: [],
    ...partial,
  }
}

/** 判断是否为工具结果回填消息（【工具 X 执行结果】前缀的 user 消息） */
function isToolResultMessage(content: string): boolean {
  return /^【工具\s+\S+\s+执行结果】/.test(content)
}

// 当前接收 SSE 的 assistant 消息（ask 回答后切换为新的消息）
const activeAssistant = ref<ChatItem | null>(null)

// Agent 向作者提问（ask_user）
const pendingAsk = ref<AskQuestion | null>(null)
const askSelection = ref<string[]>([])
const askCustom = ref('')
const askSubmitting = ref(false)
const chatContainer = ref<HTMLElement | null>(null)

// 文档预览
const docDialogVisible = ref(false)
const docLoading = ref(false)
const docContent = ref('')

// ====== 工具函数 ======

const truncate = (text: string, max: number): string => {
  return text.length > max ? text.slice(0, max) + '...' : text
}

/** 步骤思考文本展示（过长可展开） */
const stepThoughtText = (step: DisplayStep): string => {
  if (!step.thought) return ''
  return step.expanded || step.thought.length <= 120 ? step.thought : truncate(step.thought, 120)
}

const shortId = (id: string): string => {
  return id ? id.slice(0, 8) : ''
}

const scrollToBottom = () => {
  nextTick(() => {
    if (chatContainer.value) {
      chatContainer.value.scrollTop = chatContainer.value.scrollHeight
    }
  })
}

const refreshSession = async (id: string) => {
  try {
    const { data } = await getSession(id)
    sessionInfo.value = data
  } catch {
    /* 忽略刷新失败 */
  }
}

// ====== 会话管理 ======

const handleNewSession = () => {
  if (running.value) return
  sessionId.value = ''
  sessionInfo.value = null
  messages.value = []
  lastTurn.value = null
  input.value = ''
  activeInteractions.value = []
}

const handleDeleteSession = async () => {
  if (!sessionId.value || running.value) return
  try {
    await ElMessageBox.confirm('确定结束并删除当前会话？', '结束会话', { type: 'warning' })
  } catch {
    return
  }
  try {
    await deleteSession(sessionId.value)
  } catch (err) {
    const msg = err instanceof Error ? err.message : '未知错误'
    ElMessage.error('删除会话失败: ' + msg)
  }
  handleNewSession()
}

// ====== 发送消息 ======

const handleSend = async () => {
  const content = input.value.trim()
  if (!content) return
  if (running.value) return
  if (sessionInfo.value?.done) {
    ElMessage.warning('会话已完成，请新建会话继续')
    return
  }

  // 推送用户消息
  messages.value.push(makeChatItem({ role: 'user', content, loading: false, steps: [] }))

  // 没有会话则先创建
  if (!sessionId.value) {
    try {
      const { data } = await createSession({
        project_id: projectId.value || undefined,
        project_name: sessionForm.project_name || undefined,
        genre: sessionForm.genre || undefined,
        platform: sessionForm.platform || undefined,
        target_words: sessionForm.target_words || undefined,
      })
      sessionId.value = data.session_id
      sessionInfo.value = data
    } catch (err) {
      const msg = err instanceof Error ? err.message : '未知错误'
      ElMessage.error('创建会话失败: ' + msg)
      messages.value.pop()
      return
    }
  }

  input.value = ''
  running.value = true

  // 当前接收 SSE 的 assistant 消息（ask 回答后切换为新的消息）
  const msg = makeChatItem({ role: 'assistant', content: '', loading: true, steps: [] })
  activeAssistant.value = msg
  messages.value.push(msg)
  scrollToBottom()

  // 看门狗：防止流式请求异常挂起导致按钮/界面一直处于处理中
  const watchdog = setTimeout(() => {
    running.value = false
    if (activeAssistant.value) activeAssistant.value.loading = false
    if (!activeAssistant.value?.content) {
      if (activeAssistant.value) activeAssistant.value.error = '处理超时（15 分钟），请重试'
      ElMessage.error('处理超时，请重试')
    }
  }, 15 * 60 * 1000)

  try {
    const generator = sessionMessageStream(sessionId.value, content)
    for await (const event of generator) {
      const cur = activeAssistant.value
      if (!cur) continue
      if (event.type === 'chunk') {
        cur.streamText += event.data
        scrollToBottom()
      } else if (event.type === 'thinking') {
        cur.thinkingText += event.data
        scrollToBottom()
      } else if (event.type === 'step') {
        cur.steps.push({ ...event.data, expanded: false, obsExpanded: false })
        // 步骤固化后清空进行中的思考文本
        cur.thinkingText = ''
        scrollToBottom()
      } else if (event.type === 'ask') {
        // 固化 agent 提问前的已输出内容（思考/分析），再弹提问卡片
        const askData = event.data
        const thinkText = cur.thinkingText.trim()
        if (thinkText) {
          cur.steps.push({
            step_index: cur.steps.length + 1,
            thought: cur.thinkingText,
            tool_name: 'ask_user',
            tool_args: '',
            observation: '',
            is_final: false,
            expanded: false,
            obsExpanded: false,
          })
          cur.thinkingText = ''
        } else if (askData.question) {
          // 兜底：无流式思考时，用提问本身作为步骤内容
          cur.steps.push({
            step_index: cur.steps.length + 1,
            thought: askData.question,
            tool_name: 'ask_user',
            tool_args: '',
            observation: '',
            is_final: false,
            expanded: false,
            obsExpanded: false,
          })
        }
        // 停止"思考中"，改为"等待回答"状态（agent 已暂停，非思考）
        cur.loading = false
        cur.awaitingAnswer = true
        pendingAsk.value = askData
        askSelection.value = []
        askCustom.value = ''
        scrollToBottom()
      } else if (event.type === 'done') {
        const data = event.data
        cur.loading = false
        cur.awaitingAnswer = false
        cur.content = data.reply
        cur.result = data
        lastTurn.value = data
        if (data.is_done) {
          ElMessage.success('创意阶段完成！')
        }
        scrollToBottom()
      } else if (event.type === 'error') {
        cur.loading = false
        cur.awaitingAnswer = false
        cur.error = event.message
        ElMessage.error('执行错误: ' + event.message)
      }
    }
    // 刷新会话状态
    await refreshSession(sessionId.value)
  } catch (err) {
    const msg = err instanceof Error ? err.message : '未知错误'
    if (activeAssistant.value) {
      activeAssistant.value.loading = false
      activeAssistant.value.awaitingAnswer = false
      activeAssistant.value.error = msg
    }
    ElMessage.error('请求失败: ' + msg)
  } finally {
    clearTimeout(watchdog)
    pendingAsk.value = null
    running.value = false
    scrollToBottom()
  }
}

// ====== 生成设定 ======

const generatingSettings = ref(false)

const handleGenerateSettings = async () => {
  if (!projectId.value) {
    ElMessage.warning('未绑定项目，无法生成设定')
    return
  }
  try {
    await ElMessageBox.confirm(
      '将基于已确认的核心要素生成世界观、人物卡片、大纲、风格四类设定，生成后可在「设定中心」查看和修改。继续？',
      '生成设定',
      { type: 'info' }
    )
  } catch {
    return
  }
  generatingSettings.value = true
  try {
    const { data } = await generateSettings(projectId.value, 'all')
    const generated = Object.keys(data.settings || {}).length
    ElMessage.success(`已生成 ${generated} 类设定`)
    router.push({ path: `/projects/${projectId.value}/settings`, query: { name: projectInfo.value?.name || '' } })
  } catch (err: any) {
    ElMessage.error(`生成失败: ${err?.response?.data?.detail || err?.message || err}`)
  } finally {
    generatingSettings.value = false
  }
}

// ====== 向 Agent 回答问题 ======

const handleSubmitAsk = async () => {
  if (!pendingAsk.value || askSubmitting.value) return
  const custom = askCustom.value.trim()
  const selected = askSelection.value
  let answer = custom
  if (selected.length > 0) {
    answer = custom ? `${selected.join('、')}（自定义补充：${custom}）` : selected.join('、')
  }
  if (!answer) {
    ElMessage.warning('请选择选项或输入自定义回答')
    return
  }

  askSubmitting.value = true
  try {
    await submitSessionAnswer(sessionId.value, answer)
    // 在对话中回显用户的选择
    messages.value.push(makeChatItem({ role: 'user', content: answer, loading: false, steps: [] }))
    // 用户回答后，后续 agent 输出应进入一条新的 assistant 消息
    // （SSE 流仍在继续，handleSend 会继续往 activeAssistant.value 写入）
    if (activeAssistant.value) {
      activeAssistant.value.awaitingAnswer = false
    }
    const next = makeChatItem({ role: 'assistant', content: '', loading: true, steps: [] })
    activeAssistant.value = next
    messages.value.push(next)
    pendingAsk.value = null
    askSelection.value = []
    askCustom.value = ''
    scrollToBottom()
  } catch (err) {
    const msg = err instanceof Error ? err.message : '未知错误'
    ElMessage.error('提交回答失败: ' + msg)
  } finally {
    askSubmitting.value = false
  }
}

// ====== 文档预览 ======

const handleViewDoc = async () => {
  if (!lastTurn.value?.vision_doc_path) return
  docDialogVisible.value = true
  docLoading.value = true
  docContent.value = ''
  try {
    const { data } = await fileRead(lastTurn.value.vision_doc_path)
    docContent.value = data.content
  } catch (err) {
    const msg = err instanceof Error ? err.message : '未知错误'
    ElMessage.error('读取文档失败: ' + msg)
  } finally {
    docLoading.value = false
  }
}

// ====== LLM 交互记录相关 ======

const activeInteractions = ref<number[]>([])

const expandAllInteractions = () => {
  if (!lastTurn.value?.interactions) return
  activeInteractions.value = lastTurn.value.interactions.map((_, i) => i)
}

const collapseAllInteractions = () => {
  activeInteractions.value = []
}

const expandedMessages = ref<Record<string, boolean>>({})

const totalTokens = computed(() => {
  if (!lastTurn.value?.interactions) return 0
  return lastTurn.value.interactions.reduce((sum, i) => sum + (i.total_tokens || 0), 0)
})

const roleTagType = (role: string): 'primary' | 'success' | 'info' | 'warning' | 'danger' => {
  switch (role) {
    case 'system': return 'primary'
    case 'user': return 'success'
    case 'assistant': return 'info'
    case 'function': return 'warning'
    default: return 'info'
  }
}

const MESSAGE_TRUNCATE_LIMIT = 500

const isMessageExpanded = (interactionIdx: number, msgIdx: number): boolean => {
  return !!expandedMessages.value[`${interactionIdx}-${msgIdx}`]
}

const toggleMessage = (interactionIdx: number, msgIdx: number) => {
  const key = `${interactionIdx}-${msgIdx}`
  expandedMessages.value[key] = !expandedMessages.value[key]
}

const getMessageDisplay = (content: string, interactionIdx: number, msgIdx: number): string => {
  if (content.length <= MESSAGE_TRUNCATE_LIMIT) return content
  return isMessageExpanded(interactionIdx, msgIdx) ? content : content.slice(0, MESSAGE_TRUNCATE_LIMIT) + '\n...'
}

const formatJson = (value: string | Record<string, any> | null | undefined): string => {
  if (value === null || value === undefined || value === '') return ''
  if (typeof value === 'string') {
    try {
      return JSON.stringify(JSON.parse(value), null, 2)
    } catch {
      return value
    }
  }
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

const formatFunctionCall = (fc: string | Record<string, any> | null): string => {
  if (fc === null) return 'auto'
  if (typeof fc === 'string') return fc
  return JSON.stringify(fc)
}

const getFunctionNames = (interaction: LLMInteraction): string[] => {
  if (!interaction.functions) return []
  return interaction.functions.map((fn) => fn.name).filter(Boolean)
}

/** 简要展示单次 LLM 调用输出：工具结果优先，其次为响应文本 */
const briefInteractionOutput = (interaction: LLMInteraction): string => {
  const toolText = (interaction.tool_result || '').trim()
  const respText = (interaction.response_content || '').trim()
  const text = toolText || respText || '（无输出）'
  const compact = text.replace(/\s+/g, ' ')
  return compact.length > 300 ? compact.slice(0, 300) + '...' : compact
}
</script>

<style scoped>
.ideation-view {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 960px;
  margin: 0 auto;
}

.card-header-title {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}

.header-icon {
  color: var(--app-primary);
}

/* ====== 项目信息卡片 ====== */
.project-info-card {
  border-left: 4px solid var(--app-primary) !important;
}

.project-info-card :deep(.el-descriptions__label) {
  width: 90px;
}

.project-edit-form {
  max-width: 640px;
}

.edit-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.session-actions {
  margin-left: auto;
  display: flex;
  gap: 4px;
}

.form-row {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
}

.form-row .el-form-item {
  flex: 1;
  min-width: 180px;
}

.form-tip {
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 4px;
}

/* ====== 对话区 ====== */
.chat-container {
  max-height: 480px;
  overflow-y: auto;
  padding: 8px 4px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.chat-message {
  display: flex;
  gap: 10px;
  align-items: flex-start;
}

.chat-message.user {
  flex-direction: row-reverse;
}

.msg-avatar {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
}

.msg-avatar.user {
  background: var(--app-primary);
}

.msg-avatar.assistant {
  background: #9c27b0;
}

.msg-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.chat-message.user .msg-body {
  align-items: flex-end;
}

.msg-bubble {
  max-width: 86%;
  padding: 10px 14px;
  border-radius: 10px;
  background: #f4f6fa;
  border: 1px solid #ebeef5;
  word-break: break-word;
}

.chat-message.user .msg-bubble {
  background: var(--app-primary);
  border-color: var(--app-primary);
}

.msg-content {
  margin: 0;
  font-size: 13px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: inherit;
}

.chat-message.user .msg-content {
  color: #fff;
}

/* 用户消息纯文本（不走 markdown 样式） */
.msg-content.user-text {
  color: #fff;
  font-size: 14px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: inherit;
  margin: 0;
}

/* Markdown 渲染 */
.markdown-body {
  font-size: 13px;
  line-height: 1.8;
  color: var(--text-primary);
}

.markdown-body h1,
.markdown-body h2,
.markdown-body h3,
.markdown-body h4 {
  margin: 14px 0 8px;
  font-weight: 600;
  line-height: 1.4;
}

.markdown-body h1 { font-size: 18px; }
.markdown-body h2 { font-size: 16px; border-bottom: 1px solid #ebeef5; padding-bottom: 4px; }
.markdown-body h3 { font-size: 14px; }
.markdown-body h4 { font-size: 13px; }

.markdown-body ul,
.markdown-body ol {
  padding-left: 22px;
  margin: 6px 0;
}

.markdown-body li {
  margin: 3px 0;
}

.markdown-body p {
  margin: 6px 0;
}

.markdown-body blockquote {
  margin: 8px 0;
  padding: 6px 12px;
  border-left: 3px solid var(--app-primary);
  background: #f6f8fc;
  color: var(--text-regular);
  border-radius: 4px;
}

.markdown-body code {
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  font-size: 12px;
  background: #f0f2f5;
  padding: 2px 5px;
  border-radius: 4px;
}

.markdown-body pre {
  background: #1e1e1e;
  color: #d4d4d4;
  padding: 12px;
  border-radius: 8px;
  overflow-x: auto;
  font-size: 12px;
  line-height: 1.6;
}

.markdown-body pre code {
  background: transparent;
  color: inherit;
  padding: 0;
}

.markdown-body table {
  border-collapse: collapse;
  margin: 8px 0;
  width: 100%;
  font-size: 12px;
}

.markdown-body th,
.markdown-body td {
  border: 1px solid #e0e4ea;
  padding: 6px 10px;
  text-align: left;
}

.markdown-body th {
  background: #f5f7fa;
  font-weight: 600;
}

.markdown-body a {
  color: var(--app-primary);
  text-decoration: none;
}

/* 流式输出实时文本 */
.msg-streaming {
  font-size: 13px;
  line-height: 1.7;
  color: var(--text-regular);
  white-space: pre-wrap;
  word-break: break-word;
}

.stream-caret {
  color: var(--app-primary);
  animation: caret-blink 0.8s steps(1) infinite;
}

/* 思考过程实时流式 */
.msg-thinking {
  margin-top: 6px;
  padding: 8px 12px;
  background: #f0f4ff;
  border-left: 3px solid var(--app-primary);
  border-radius: 6px;
  font-size: 12px;
  color: var(--text-regular);
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.thinking-label {
  font-weight: 600;
  color: var(--app-primary);
  margin-right: 6px;
}

.thinking-text {
  color: var(--text-secondary);
}

@keyframes caret-blink {
  50% { opacity: 0; }
}

/* Agent 提问卡片 */
.ask-card {
  border-left: 4px solid var(--app-warning) !important;
}

.ask-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.ask-question {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  line-height: 1.6;
}

.ask-options {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: stretch;
}

.ask-option {
  margin-right: 0;
  height: auto;
  padding: 10px 12px;
  white-space: normal;
  word-break: break-word;
}

.ask-no-options {
  font-size: 12px;
  color: var(--text-secondary);
}

.ask-custom-input {
  margin-top: 4px;
}

.ask-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.ask-hint {
  font-size: 12px;
  color: var(--text-secondary);
}

.msg-answer-label {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  font-weight: 600;
  color: var(--app-primary);
  margin-bottom: 6px;
}

.msg-error {
  margin-top: 6px;
  font-size: 12px;
  color: var(--app-danger);
}

.msg-loading {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-secondary);
  font-size: 13px;
}

/* 等待用户回答（ask_user） */
.msg-awaiting {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--app-warning);
  font-size: 13px;
  padding: 6px 10px;
  background: #fdf6ec;
  border-radius: 6px;
  margin-top: 6px;
}

.msg-steps {
  margin-top: 8px;
  border-top: 1px dashed #e0e4ea;
  padding-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.msg-step-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: flex-start;
  background: #f7f9fc;
  border-left: 3px solid #c0c8d8;
  border-radius: 6px;
  padding: 8px 10px;
  width: 100%;
  box-sizing: border-box;
}

.msg-step-item.step-final {
  border-left-color: var(--app-success);
  background: #f0f9eb;
}

.msg-step-head {
  display: flex;
  align-items: center;
  gap: 6px;
}

.msg-step-thought {
  font-size: 12px;
  color: var(--text-regular);
  white-space: pre-wrap;
  word-break: break-word;
  display: inline;
}

.msg-step-thought :deep(.el-button) {
  margin-left: 4px;
}

.msg-step-obs {
  font-size: 12px;
  color: var(--text-secondary);
  white-space: pre-wrap;
  word-break: break-word;
  background: #fdf6ec;
  border-radius: 4px;
  padding: 6px 8px;
  width: 100%;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 2px;
  align-items: flex-start;
}

.obs-label {
  font-weight: 500;
  color: #b88230;
}

.obs-text {
  display: block;
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.5;
}

/* 默认折叠为 3 行，点击展开全部 */
.obs-text.collapsed {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.msg-step-obs :deep(.el-button) {
  margin-left: 0;
}

.chat-input {
  display: flex;
  gap: 10px;
  align-items: flex-end;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid #ebeef5;
}

.chat-input .el-textarea {
  flex: 1;
}

.send-btn {
  height: 38px;
  flex-shrink: 0;
}

.done-tip {
  margin-top: 8px;
  font-size: 12px;
  color: var(--app-success);
}

/* ====== 结果区 ====== */
.result-card.result-success {
  border-left: 4px solid var(--app-success) !important;
}

.result-card.result-fail {
  border-left: 4px solid var(--app-danger) !important;
}

.result-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.result-info {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.info-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.info-label {
  font-size: 13px;
  color: var(--text-secondary);
  white-space: nowrap;
}

.info-value {
  font-size: 13px;
  color: var(--text-primary);
  font-family: monospace;
  word-break: break-all;
}

.result-actions {
  display: flex;
  gap: 10px;
}

/* ====== 文档预览 ====== */
.doc-dialog-body {
  min-height: 300px;
  max-height: 70vh;
}

.doc-content {
  margin: 0;
  padding: 16px;
  background: #f5f7fa;
  border-radius: 8px;
  font-size: 13px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 70vh;
  overflow-y: auto;
  font-family: inherit;
}

/* ====== LLM 交互记录区 ====== */
.interactions-card {
  border-left: 4px solid var(--app-primary) !important;
}

.interactions-actions {
  margin-left: auto;
  display: flex;
  gap: 4px;
}

.interactions-collapse {
  border: none;
}

.interactions-collapse :deep(.el-collapse-item__header) {
  padding-left: 4px;
}

.interactions-collapse :deep(.el-collapse-item__content) {
  padding-bottom: 16px;
}

.interaction-title {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.interaction-index {
  font-weight: 600;
  font-size: 13px;
  color: var(--text-regular);
  white-space: nowrap;
}

.interaction-error {
  margin-bottom: 12px;
}

/* 简要 LLM 输出 */
.brief-output-block {
  margin-bottom: 16px;
}

.brief-output {
  margin: 0;
  padding: 10px 12px;
  background: #f0f9eb;
  border: 1px solid #e1f3d8;
  border-radius: 6px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-regular);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 140px;
  overflow-y: auto;
  font-family: inherit;
}

.interaction-section {
  margin-bottom: 16px;
}

.interaction-section:last-child {
  margin-bottom: 0;
}

.interaction-section .section-label {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 8px;
  color: var(--text-regular);
}

.params-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}

.messages-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.message-item {
  display: flex;
  gap: 10px;
  align-items: flex-start;
}

.message-role {
  flex-shrink: 0;
  min-width: 64px;
  text-align: center;
}

.message-role.role-assistant-tag {
  background-color: #9c27b0 !important;
  border-color: #9c27b0 !important;
  color: #fff !important;
}

.message-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.message-content {
  margin: 0;
  padding: 10px 12px;
  background: #ffffff;
  border: 1px solid #ebeef5;
  border-radius: 6px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-regular);
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 400px;
  overflow-y: auto;
}

.function-call-block {
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: flex-start;
}

.function-name-tag {
  display: flex;
}

.functions-block {
  margin-top: 12px;
}

.functions-list {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.response-desc {
  margin-top: 8px;
}

.response-content-block,
.response-fc-block {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.tool-result-block {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.tool-status-tag {
  margin-left: 4px;
}

.tool-info-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.tool-info-label {
  font-size: 12px;
  color: var(--text-secondary);
  font-weight: 500;
}

.tool-args-content {
  background: #fdf6ec;
  border-color: #faecd8;
}

.tool-result-ok {
  background: #f0f9eb;
  border-color: #e1f3d8;
}

.tool-result-err {
  background: #fef0f0;
  border-color: #fde2e2;
}

.section-label {
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 4px;
}

.is-loading {
  animation: rotating 1.5s linear infinite;
}

@keyframes rotating {
  to {
    transform: rotate(360deg);
  }
}
</style>
