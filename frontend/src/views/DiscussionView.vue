<template>
  <div class="discussion-view">
    <PageHeader title="多 Agent 剧情讨论" subtitle="让多个 Agent 角色从不同角度生成剧情提案，然后合成统一方案" icon="ChatLineSquare">
      <template #actions>
        <el-tag type="primary" effect="plain" round>标准模式</el-tag>
      </template>
    </PageHeader>

    <!-- 阶段 0：配置阶段 -->
    <div v-if="phase === 'config'" class="config-panel">
      <el-card shadow="never">
        <template #header>
          <div class="card-header">
            <span>讨论配置</span>
          </div>
        </template>
        
        <el-form :model="form" label-width="100px">
          <el-form-item label="讨论主题" required>
            <el-input
              v-model="form.topic"
              type="textarea"
              :rows="3"
              placeholder="例如：主角在第 10 章应该遇到什么危机？如何推动剧情发展？"
            />
          </el-form-item>
          
          <el-form-item label="上下文">
            <el-checkbox-group v-model="form.contextKeys">
              <el-checkbox label="core_elements">核心要素</el-checkbox>
              <el-checkbox label="worldview">世界观</el-checkbox>
              <el-checkbox label="characters">人物设定</el-checkbox>
              <el-checkbox label="outline">大纲</el-checkbox>
              <el-checkbox label="memory">记忆（事实/伏笔）</el-checkbox>
            </el-checkbox-group>
          </el-form-item>
          
          <el-form-item label="参与角色">
            <div class="role-list">
              <div v-for="role in proposerRoles" :key="role.id" class="role-item">
                <el-tag :type="getCategoryTagType(role.category as any)" size="small" effect="plain">
                  {{ getCategoryLabel(role.category as any) }}
                </el-tag>
                <span class="role-name">{{ role.name }}</span>
                <span class="role-temp">温度 {{ getTemperature(role) }}</span>
              </div>
              <div v-for="role in synthesizerRoles" :key="role.id" class="role-item">
                <el-tag :type="getCategoryTagType(role.category as any)" size="small" effect="plain">
                  {{ getCategoryLabel(role.category as any) }}
                </el-tag>
                <span class="role-name">{{ role.name }}</span>
                <span class="role-temp">温度 {{ getTemperature(role) }}</span>
              </div>
            </div>
          </el-form-item>
        </el-form>
        
        <div class="config-actions">
          <el-button type="primary" :disabled="!form.topic.trim()" :loading="loading" @click="startDiscussion">
            <el-icon style="margin-right: 4px"><VideoPlay /></el-icon>
            开始讨论
          </el-button>
        </div>
      </el-card>
    </div>

    <!-- 阶段 1：独立提案（自动执行） -->
    <div v-else-if="phase === 'proposing'" class="progress-panel">
      <el-card shadow="never">
        <template #header>
          <div class="card-header">
            <span>第 1 轮：独立提案</span>
            <el-tag :type="isRunning ? 'warning' : 'success'" size="small">
              {{ isRunning ? '⏳ 执行中' : '✓ 已完成' }}
            </el-tag>
          </div>
        </template>
        
        <!-- 当前状态提示 -->
        <div v-if="isRunning" class="current-status">
          <el-icon class="is-loading" :size="16"><Loading /></el-icon>
          <span class="status-text">{{ currentStatusText }}</span>
        </div>
        
        <!-- 进度条 -->
        <el-progress 
          :percentage="progressPercentage" 
          :status="isRunning ? undefined : 'success'"
          :stroke-width="20"
          :format="() => `${progressPercentage}% (${proposals.length}/${totalProposers})`"
          style="margin-bottom: 20px;"
        />
        
        <!-- 实时日志 -->
        <div class="log-container" ref="logContainer">
          <div v-for="(log, index) in currentLogs" :key="index" class="log-line" :class="{ 'log-highlight': isHighlightLog(log) }">
            <span class="log-text">{{ log }}</span>
          </div>
          <div v-if="isRunning" class="log-line log-waiting">
            <el-icon class="is-loading"><Loading /></el-icon>
            <span class="log-text">正在等待 LLM 响应，请稍候...</span>
          </div>
        </div>
        
        <div class="progress-info">
          <div class="progress-stats">
            <span>已完成: <strong>{{ proposals.length }}</strong> / {{ totalProposers }} 个提案</span>
            <span v-if="isRunning">预计剩余: {{ estimatedTimeRemaining }}</span>
          </div>
        </div>
        
        <div class="progress-actions">
          <el-button type="danger" @click="terminateDiscussion" :disabled="!isRunning">
            <el-icon><Close /></el-icon>
            终止讨论
          </el-button>
        </div>
      </el-card>
    </div>

    <!-- 阶段 2：审查点 #1 -->
    <div v-else-if="phase === 'review1'" class="review-panel">
      <el-card shadow="never">
        <template #header>
          <div class="card-header">
            <span>第 1 轮完成：独立提案</span>
            <el-tag type="success" size="small">{{ proposals.length }} 个提案</el-tag>
          </div>
        </template>
        
        <div class="proposals-list">
          <div v-for="proposal in proposals" :key="proposal.roleId" class="proposal-card" :class="{ deleted: proposal.deleted }">
            <div class="proposal-header">
              <div class="proposal-title">
                <el-tag :type="getCategoryTagType(proposal.category as any)" size="small" effect="plain">
                  {{ getCategoryLabel(proposal.category as any) }}
                </el-tag>
                <span class="proposal-name">{{ proposal.roleName }}</span>
                <el-tag type="info" size="small">{{ (proposal.elapsedMs / 1000).toFixed(1) }}s</el-tag>
                <el-tag v-if="proposal.edited" type="warning" size="small">已编辑</el-tag>
                <el-tag v-if="proposal.deleted" type="danger" size="small">已删除</el-tag>
              </div>
              <div class="proposal-actions">
                <el-button link type="primary" size="small" @click="editProposal(proposal)" :disabled="proposal.deleted">
                  <el-icon><Edit /></el-icon>
                  编辑
                </el-button>
                <el-button link :type="proposal.deleted ? 'success' : 'danger'" size="small" @click="toggleDeleteProposal(proposal)">
                  <el-icon><component :is="proposal.deleted ? 'RefreshLeft' : 'Delete'" /></el-icon>
                  {{ proposal.deleted ? '恢复' : '删除' }}
                </el-button>
              </div>
            </div>
            
            <div class="proposal-content" v-html="renderMarkdown(proposal.proposal)"></div>
          </div>
        </div>
        
        <el-divider />
        
        <div class="instruction-section">
          <div class="instruction-label">追加指令（可选）</div>
          <el-input
            v-model="newInstruction"
            type="textarea"
            :rows="2"
            placeholder="例如：请重点考虑室友这个角色、避免使用军训场景..."
          />
          <div v-if="userInstructions.length > 0" class="instruction-list">
            <div v-for="(inst, i) in userInstructions" :key="i" class="instruction-item">
              <span>{{ i + 1 }}. {{ inst }}</span>
              <el-button link type="danger" size="small" @click="removeInstruction(i)">
                <el-icon><Close /></el-icon>
              </el-button>
            </div>
          </div>
          <el-button v-if="newInstruction.trim()" size="small" @click="addInstruction">添加指令</el-button>
        </div>
        
        <div class="review-actions">
          <el-button type="primary" :loading="loading" @click="synthesizeProposals">
            <el-icon style="margin-right: 4px"><Check /></el-icon>
            继续合成
          </el-button>
          <el-button @click="restartProposals">重新生成提案</el-button>
          <el-button @click="terminateDiscussion">终止讨论</el-button>
        </div>
      </el-card>
      
      <!-- 编辑提案对话框 -->
      <el-dialog v-model="editDialogVisible" title="编辑提案" width="700px">
        <el-input
          v-model="editingProposalContent"
          type="textarea"
          :rows="15"
        />
        <template #footer>
          <el-button @click="editDialogVisible = false">取消</el-button>
          <el-button type="primary" @click="saveProposalEdit">保存修改</el-button>
        </template>
      </el-dialog>
    </div>

    <!-- 阶段 3：合成阶段（自动执行） -->
    <div v-else-if="phase === 'synthesizing'" class="progress-panel">
      <el-card shadow="never">
        <template #header>
          <div class="card-header">
            <span>第 2 轮：合成</span>
            <el-tag :type="isRunning ? 'warning' : 'success'" size="small">
              {{ isRunning ? '⏳ 执行中' : '✓ 已完成' }}
            </el-tag>
          </div>
        </template>
        
        <!-- 当前状态提示 -->
        <div v-if="isRunning" class="current-status">
          <el-icon class="is-loading" :size="16"><Loading /></el-icon>
          <span class="status-text">合成者正在整合 {{ proposals.length }} 个提案，生成统一方案...</span>
        </div>
        
        <!-- 实时日志 -->
        <div class="log-container" ref="logContainer">
          <div v-for="(log, index) in currentLogs" :key="index" class="log-line" :class="{ 'log-highlight': isHighlightLog(log) }">
            <span class="log-text">{{ log }}</span>
          </div>
          <div v-if="isRunning" class="log-line log-waiting">
            <el-icon class="is-loading"><Loading /></el-icon>
            <span class="log-text">正在等待合成者完成，这可能需要 30-60 秒...</span>
          </div>
        </div>
        
        <div class="progress-info">
          <div class="progress-stats">
            <span>输入: {{ proposals.length }} 个提案</span>
            <span v-if="isRunning">预计耗时: 30-60 秒</span>
          </div>
        </div>
        
        <div class="progress-actions">
          <el-button type="danger" @click="terminateDiscussion" :disabled="!isRunning">
            <el-icon><Close /></el-icon>
            终止讨论
          </el-button>
        </div>
      </el-card>
    </div>

    <!-- 阶段 4：审查点 #2 -->
    <div v-else-if="phase === 'review2'" class="review-panel">
      <el-card shadow="never">
        <template #header>
          <div class="card-header">
            <span>第 2 轮完成：统一方案</span>
            <el-tag type="warning" size="small">合成耗时 {{ (synthesisMeta?.elapsedMs || 0) / 1000 }}s</el-tag>
          </div>
        </template>
        
        <div class="synthesis-content" v-html="renderMarkdown(synthesis || '')"></div>
        
        <el-divider />
        
        <div class="review2-actions">
          <div class="action-label">对合成结果满意吗？</div>
          <el-radio-group v-model="review2Choice" class="review2-choices">
            <el-radio label="satisfied">满意，进入应用阶段</el-radio>
            <el-radio label="resynthesize">需要调整，请合成者重新合成</el-radio>
            <el-radio label="back">不满意，回到提案阶段重新讨论</el-radio>
            <el-radio label="terminate">终止讨论，不应用结果</el-radio>
          </el-radio-group>
          
          <div v-if="review2Choice === 'resynthesize' || review2Choice === 'back'" class="instruction-section">
            <div class="instruction-label">追加指令（可选）</div>
            <el-input
              v-model="newInstruction"
              type="textarea"
              :rows="2"
              placeholder="请说明需要调整的方向..."
            />
            <el-button v-if="newInstruction.trim()" size="small" @click="addInstruction">添加指令</el-button>
          </div>
          
          <div class="review-actions">
            <el-button type="primary" @click="confirmReview2">确认</el-button>
          </div>
        </div>
      </el-card>
    </div>

    <!-- 阶段 5：应用阶段 -->
    <div v-else-if="phase === 'apply'" class="apply-panel">
      <el-card shadow="never">
        <template #header>
          <div class="card-header">
            <span>讨论完成</span>
            <el-tag type="success" size="small">已完成</el-tag>
          </div>
        </template>
        
        <div class="apply-options">
          <div class="apply-option">
            <div class="apply-option-icon">
              <el-icon :size="32"><Document /></el-icon>
            </div>
            <div class="apply-option-content">
              <div class="apply-option-title">保存为参考文档</div>
              <div class="apply-option-desc">将讨论结果保存为 Markdown 文档，供后续参考</div>
            </div>
            <el-button type="primary" @click="saveAsDocument">保存文档</el-button>
          </div>
          
          <div class="apply-option">
            <div class="apply-option-icon">
              <el-icon :size="32"><List /></el-icon>
            </div>
            <div class="apply-option-content">
              <div class="apply-option-title">应用到大纲</div>
              <div class="apply-option-desc">将统一方案写入大纲设定</div>
            </div>
            <el-button @click="applyToOutline">应用到大纲</el-button>
          </div>
          
          <div class="apply-option">
            <div class="apply-option-icon">
              <el-icon :size="32"><User /></el-icon>
            </div>
            <div class="apply-option-content">
              <div class="apply-option-title">应用到人物设定</div>
              <div class="apply-option-desc">将讨论中涉及的人物变化写入人物设定</div>
            </div>
            <el-button @click="applyToCharacters">应用到人设</el-button>
          </div>
        </div>
        
        <el-divider />
        
        <div class="apply-footer">
          <el-button @click="copyResult">复制结果到剪贴板</el-button>
          <el-button @click="restartDiscussion">重新开始讨论</el-button>
        </div>
      </el-card>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, nextTick } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { marked } from 'marked'
import {
  getAgentRoles,
  getDiscussionSession,
  getProjectDocumentsByKind,
  readProjectDocument,
  getProjectMemory,
  startDiscussion as apiStartDiscussion,
  updateProposals,
  addInstruction as apiAddInstruction,
  synthesize as apiSynthesize,
  resynthesize,
  completeDiscussion,
  terminateDiscussion as apiTerminateDiscussion,
  getDiscussionProgress,
  type AgentRoleAsset,
  type AgentRoleCategory,
  type AgentMessage,
  type SynthesisMeta,
} from '@/api'
import { useCurrentProject } from '@/stores/currentProject'
import PageHeader from '@/components/PageHeader.vue'

const currentProject = useCurrentProject()

// 阶段状态
type Phase = 'config' | 'proposing' | 'review1' | 'synthesizing' | 'review2' | 'apply' | 'terminated'
const phase = ref<Phase>('config')

// 加载状态
const loading = ref(false)
const isRunning = ref(false)

// 配置表单
const form = ref({
  topic: '',
  contextKeys: ['core_elements', 'worldview', 'characters'] as string[],
})

// 角色数据
const allRoles = ref<AgentRoleAsset[]>([])
const proposerRoles = computed(() => allRoles.value.filter(r => r.category === 'proposer'))
const synthesizerRoles = computed(() => allRoles.value.filter(r => r.category === 'synthesizer'))
const totalProposers = computed(() => proposerRoles.value.length)

// 讨论会话
const sessionId = ref<string>('')
const messages = ref<AgentMessage[]>([])
const currentRound = ref(0)
const maxRounds = ref(2)
const synthesis = ref<string>('')
const synthesisMeta = ref<SynthesisMeta>()
const userInstructions = ref<string[]>([])
const currentLogs = ref<string[]>([])

// 轮询控制
let pollTimer: number | null = null
const POLL_INTERVAL = 2000  // 2秒轮询一次

// 审查点 #1
const editDialogVisible = ref(false)
const editingProposal = ref<AgentProposal | null>(null)
const editingProposalContent = ref('')
const newInstruction = ref('')

// 审查点 #2
const review2Choice = ref<'satisfied' | 'resynthesize' | 'back' | 'terminate'>('satisfied')

// 计算属性
const progressPercentage = computed(() => {
  if (maxRounds.value === 0) return 0
  // 初始提案占 20%，每轮讨论占 (80% / maxRounds)
  const baseProgress = messages.value.length > 0 ? 20 : 0
  const roundProgress = (currentRound.value / maxRounds.value) * 80
  return Math.min(100, baseProgress + roundProgress)
})

// 当前状态文本
const currentStatusText = computed(() => {
  if (!isRunning.value) return ''
  if (currentRound.value === 0) return '正在生成初始提案...'
  if (currentRound.value <= maxRounds.value) return `正在进行第 ${currentRound.value}/${maxRounds.value} 轮讨论...`
  return '正在合成最终方案...'
})

// 预计剩余时间
const estimatedTimeRemaining = computed(() => {
  if (!isRunning.value || proposals.value.length === 0) return '计算中...'
  const completed = proposals.value.length
  const remaining = totalProposers.value - completed
  // 假设每个提案平均需要 30 秒
  const avgTimePerProposal = 30
  const seconds = remaining * avgTimePerProposal
  if (seconds < 60) return `${seconds} 秒`
  return `${Math.round(seconds / 60)} 分钟`
})

// 判断是否需要高亮的日志
function isHighlightLog(log: string): boolean {
  return log.includes('━━━') || log.includes('✓') || log.includes('✗') || log.includes('===')
}

// 自动滚动日志到底部
function scrollToBottom() {
  nextTick(() => {
    const container = document.querySelector('.log-container')
    if (container) {
      container.scrollTop = container.scrollHeight
    }
  })
}

// 辅助函数
function getCategoryLabel(category: string): string {
  const labels: Record<string, string> = {
    proposer: '提案者',
    synthesizer: '合成者',
    reviewer: '评审者',
  }
  return labels[category] || category
}

function getCategoryTagType(category: string): string {
  const types: Record<string, string> = {
    proposer: 'success',
    synthesizer: 'warning',
    reviewer: 'info',
  }
  return types[category] || 'info'
}

function getTemperature(role: AgentRoleAsset): number {
  if (role.modelConfig.mode === 'custom' && role.modelConfig.custom) {
    return role.modelConfig.custom.temperature
  }
  return 0.7
}

function renderMarkdown(text: string): string {
  return marked.parse(text, { breaks: true }) as string
}

// 轮询进度
function startPolling() {
  stopPolling()
  isRunning.value = true
  
  pollTimer = window.setInterval(async () => {
    if (!sessionId.value) {
      stopPolling()
      return
    }
    
    try {
      const res = await getDiscussionProgress(sessionId.value)
      const data = res.data
      
      // 更新状态
      messages.value = data.messages
      currentRound.value = data.currentRound
      maxRounds.value = data.maxRounds
      currentLogs.value = data.logs
      isRunning.value = data.isRunning
      
      // 检查是否完成
      if (data.status === 'review1' && !data.isRunning) {
        stopPolling()
        phase.value = 'review1'
        ElMessage.success('提案生成完成')
      } else if (data.status === 'review2' && !data.isRunning) {
          stopPolling()
          // 获取完整会话数据
          const sessionRes = await getDiscussionSession(sessionId.value)
          synthesis.value = sessionRes.data.synthesis || ''
          synthesisMeta.value = sessionRes.data.synthesisMeta
          phase.value = 'review2'
          ElMessage.success('合成完成')
      } else if (data.status === 'terminated') {
        stopPolling()
        phase.value = 'terminated'
        ElMessage.warning('讨论已终止')
      }
    } catch (err) {
      console.error('轮询失败:', err)
    }
  }, POLL_INTERVAL)
}

function stopPolling() {
  if (pollTimer !== null) {
    clearInterval(pollTimer)
    pollTimer = null
  }
  isRunning.value = false
}

// 加载角色
async function loadRoles() {
  try {
    const res = await getAgentRoles()
    allRoles.value = res.data || []
  } catch (err) {
    ElMessage.error('加载 Agent 角色失败')
  }
}

// 加载上下文
async function loadContext() {
  if (!currentProject.id) return {}
  
  const context: Record<string, string> = {}
  
  try {
    if (form.value.contextKeys.includes('core_elements')) {
      const res = await getProjectDocumentsByKind(currentProject.id, 'core-elements')
      const docs = res.data.documents
      if (docs && docs.length > 0) {
        const rd = await readProjectDocument(currentProject.id, docs[0].path)
        if (rd.data.success && rd.data.content) {
          context.core_elements = rd.data.content
        }
      }
    }
    
    if (form.value.contextKeys.includes('worldview')) {
      const res = await getProjectDocumentsByKind(currentProject.id, 'worldview')
      const docs = res.data.documents
      if (docs && docs.length > 0) {
        const rd = await readProjectDocument(currentProject.id, docs[0].path)
        if (rd.data.success && rd.data.content) {
          context.worldview = rd.data.content
        }
      }
    }
    
    if (form.value.contextKeys.includes('characters')) {
      const res = await getProjectDocumentsByKind(currentProject.id, 'characters')
      const docs = res.data.documents
      if (docs && docs.length > 0) {
        const rd = await readProjectDocument(currentProject.id, docs[0].path)
        if (rd.data.success && rd.data.content) {
          context.characters = rd.data.content
        }
      }
    }
    
    if (form.value.contextKeys.includes('outline')) {
      const res = await getProjectDocumentsByKind(currentProject.id, 'outline')
      const docs = res.data.documents
      if (docs && docs.length > 0) {
        const rd = await readProjectDocument(currentProject.id, docs[0].path)
        if (rd.data.success && rd.data.content) {
          context.outline = rd.data.content
        }
      }
    }
    
    if (form.value.contextKeys.includes('memory')) {
      const res = await getProjectMemory(currentProject.id)
      const memory = res.data
      const facts = memory?.facts || []
      const foreshadow = memory?.foreshadow || []
      if (facts.length > 0 || foreshadow.length > 0) {
        context.memory = JSON.stringify({ facts, foreshadow }, null, 2)
      }
    }
  } catch (err) {
    console.warn('加载上下文失败:', err)
    ElMessage.warning('部分上下文加载失败，继续执行')
  }
  
  return context
}

// 开始讨论
async function startDiscussion() {
  if (!currentProject.id) {
    ElMessage.warning('请先选择项目')
    return
  }
  
  loading.value = true
  phase.value = 'proposing'
  currentLogs.value = ['正在加载上下文...']
  
  try {
    const context = await loadContext()
    
    currentLogs.value.push('开始执行多 Agent 讨论...')
    
    // 调用异步 API
    const res = await apiStartDiscussion({
      projectId: currentProject.id,
      projectName: currentProject.name || '未命名作品',
      topic: form.value.topic,
      context,
    })
    
    sessionId.value = res.data.sessionId
    currentLogs.value = res.data.logs
    
    // 开始轮询进度
    startPolling()
    
    ElMessage.success('讨论已启动，正在生成提案...')
  } catch (err: any) {
    console.error('讨论失败:', err)
    const errorMsg = err.response?.data?.error || err.message || '未知错误'
    ElMessage.error('讨论失败: ' + errorMsg)
    phase.value = 'config'
  } finally {
    loading.value = false
  }
}

// 编辑提案
function editProposal(proposal: AgentProposal) {
  editingProposal.value = proposal
  editingProposalContent.value = proposal.proposal
  editDialogVisible.value = true
}

// 保存提案编辑
async function saveProposalEdit() {
  if (!editingProposal.value || !sessionId.value) return
  
  try {
    await updateProposals(sessionId.value, [
      { roleId: editingProposal.value.roleId, proposal: editingProposalContent.value }
    ])
    
    const idx = proposals.value.findIndex(p => p.roleId === editingProposal.value!.roleId)
    if (idx >= 0) {
      proposals.value[idx].proposal = editingProposalContent.value
      proposals.value[idx].edited = true
    }
    
    editDialogVisible.value = false
    ElMessage.success('提案已更新')
  } catch (err) {
    ElMessage.error('更新失败')
  }
}

// 切换删除状态
async function toggleDeleteProposal(proposal: AgentProposal) {
  if (!sessionId.value) return
  
  const newDeleted = !proposal.deleted
  
  try {
    await updateProposals(sessionId.value, [
      { roleId: proposal.roleId, deleted: newDeleted }
    ])
    
    const idx = proposals.value.findIndex(p => p.roleId === proposal.roleId)
    if (idx >= 0) {
      proposals.value[idx].deleted = newDeleted
    }
  } catch (err) {
    ElMessage.error('操作失败')
  }
}

// 添加指令
async function addInstruction() {
  if (!sessionId.value || !newInstruction.value.trim()) return
  
  try {
    await apiAddInstruction(sessionId.value, newInstruction.value.trim())
    userInstructions.value.push(newInstruction.value.trim())
    newInstruction.value = ''
    ElMessage.success('指令已添加')
  } catch (err) {
    ElMessage.error('添加失败')
  }
}

// 移除指令
function removeInstruction(index: number) {
  userInstructions.value.splice(index, 1)
}

// 合成提案
async function synthesizeProposals() {
  if (!sessionId.value) return
  
  loading.value = true
  phase.value = 'synthesizing'
  currentLogs.value = ['开始合成...']
  
  try {
    // 调用异步合成 API
    const res = await apiSynthesize(sessionId.value)
    currentLogs.value = res.data.logs
    
    // 开始轮询进度
    startPolling()
    
    ElMessage.success('合成已启动...')
  } catch (err: any) {
    console.error('合成失败:', err)
    const errorMsg = err.response?.data?.error || err.message || '未知错误'
    ElMessage.error('合成失败: ' + errorMsg)
    phase.value = 'review1'
  } finally {
    loading.value = false
  }
}

// 重新生成提案
function restartProposals() {
  ElMessageBox.confirm('确定要重新生成提案吗？当前提案将被清空。', '确认', {
    type: 'warning',
  }).then(() => {
    sessionId.value = ''
    proposals.value = []
    synthesis.value = ''
    synthesisMeta.value = undefined
    userInstructions.value = []
    currentLogs.value = []
    phase.value = 'config'
  }).catch(() => {})
}

// 确认审查点 #2
async function confirmReview2() {
  if (!sessionId.value) return
  
  if (review2Choice.value === 'satisfied') {
    try {
      await completeDiscussion(sessionId.value)
      phase.value = 'apply'
      ElMessage.success('讨论已完成')
    } catch (err) {
      ElMessage.error('操作失败')
    }
  } else if (review2Choice.value === 'resynthesize') {
    if (newInstruction.value.trim()) {
      await addInstruction()
    }
    try {
      await resynthesize(sessionId.value)
      phase.value = 'review1'
      ElMessage.info('已回到提案审查')
    } catch (err) {
      ElMessage.error('操作失败')
    }
  } else if (review2Choice.value === 'back') {
    if (newInstruction.value.trim()) {
      await addInstruction()
    }
    try {
      await resynthesize(sessionId.value)
      phase.value = 'review1'
      ElMessage.info('已回到提案审查')
    } catch (err) {
      ElMessage.error('操作失败')
    }
  } else if (review2Choice.value === 'terminate') {
    await terminateDiscussion()
  }
}

// 终止讨论
async function terminateDiscussion() {
  if (!sessionId.value) {
    phase.value = 'config'
    return
  }
  
  try {
    await apiTerminateDiscussion(sessionId.value)
    stopPolling()
    phase.value = 'terminated'
    ElMessage.info('讨论已终止')
  } catch (err) {
    ElMessage.error('操作失败')
  }
}

// 保存为文档
function saveAsDocument() {
  ElMessage.info('保存文档功能待实现')
}

// 应用到大纲
function applyToOutline() {
  ElMessage.info('应用到大纲功能待实现')
}

// 应用到人物设定
function applyToCharacters() {
  ElMessage.info('应用到人物设定功能待实现')
}

// 复制结果
function copyResult() {
  if (!synthesis.value) return
  
  navigator.clipboard.writeText(synthesis.value).then(() => {
    ElMessage.success('已复制到剪贴板')
  }).catch(() => {
    ElMessage.error('复制失败')
  })
}

// 重新开始讨论
function restartDiscussion() {
  stopPolling()
  sessionId.value = ''
  proposals.value = []
  synthesis.value = ''
  synthesisMeta.value = undefined
  userInstructions.value = []
  currentLogs.value = []
  form.value.topic = ''
  phase.value = 'config'
}

onMounted(loadRoles)

onUnmounted(() => {
  stopPolling()
})
</script>

<style scoped>
.discussion-view {
  max-width: 1200px;
  margin: 0 auto;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-weight: 600;
}

/* 配置面板 */
.config-panel {
  margin-top: 20px;
}

.role-list {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.role-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--surface-hover);
  border-radius: 6px;
}

.role-name {
  font-weight: 500;
}

.role-temp {
  font-size: 12px;
  color: var(--text-secondary);
}

.config-actions {
  margin-top: 20px;
  text-align: right;
}

/* 进度面板 */
.progress-panel {
  margin-top: 20px;
}

.log-container {
  background: #1e1e1e;
  border-radius: 8px;
  padding: 16px;
  font-family: 'Consolas', 'Monaco', monospace;
  font-size: 12px;
  line-height: 1.6;
  max-height: 400px;
  overflow-y: auto;
  margin-bottom: 16px;
}

.log-line {
  color: #d4d4d4;
  margin-bottom: 4px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.log-text {
  white-space: pre-wrap;
  word-break: break-all;
}

.current-status {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  background: linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%);
  border-left: 4px solid #0ea5e9;
  border-radius: 6px;
  margin-bottom: 16px;
}

.status-text {
  font-size: 14px;
  font-weight: 500;
  color: #0369a1;
}

.progress-stats {
  display: flex;
  justify-content: space-between;
  width: 100%;
  font-size: 13px;
}

.log-highlight {
  background: rgba(14, 165, 233, 0.1);
  padding: 4px 8px;
  border-radius: 4px;
  margin: 4px 0;
  font-weight: 600;
}

.log-waiting {
  color: #0ea5e9;
  font-style: italic;
}

.progress-info {
  display: flex;
  justify-content: space-between;
  margin-bottom: 16px;
  color: var(--text-secondary);
}

.progress-actions {
  text-align: right;
}

/* 审查面板 */
.review-panel {
  margin-top: 20px;
}

.proposals-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.proposal-card {
  border: 1px solid var(--border-color-light);
  border-radius: 8px;
  padding: 16px;
  background: #fff;
}

.proposal-card.deleted {
  opacity: 0.5;
  background: #f5f5f5;
}

.proposal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.proposal-title {
  display: flex;
  align-items: center;
  gap: 8px;
}

.proposal-name {
  font-weight: 600;
}

.proposal-actions {
  display: flex;
  gap: 8px;
}

.proposal-content {
  padding: 12px;
  background: var(--surface-hover);
  border-radius: 6px;
  font-size: 13px;
  line-height: 1.7;
  max-height: 300px;
  overflow-y: auto;
}

.instruction-section {
  margin-top: 16px;
}

.instruction-label {
  font-weight: 500;
  margin-bottom: 8px;
}

.instruction-list {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.instruction-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: var(--accent-soft);
  border-radius: 6px;
  font-size: 13px;
}

.review-actions {
  margin-top: 20px;
  display: flex;
  gap: 12px;
  justify-content: flex-end;
}

/* 审查点 #2 */
.synthesis-content {
  padding: 16px;
  background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
  border: 1px solid var(--accent-border);
  border-radius: 8px;
  font-size: 14px;
  line-height: 1.8;
  max-height: 500px;
  overflow-y: auto;
}

.review2-actions {
  margin-top: 20px;
}

.action-label {
  font-weight: 500;
  margin-bottom: 12px;
}

.review2-choices {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 16px;
}

/* 应用面板 */
.apply-panel {
  margin-top: 20px;
}

.apply-options {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.apply-option {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px;
  border: 1px solid var(--border-color-light);
  border-radius: 8px;
  background: #fff;
}

.apply-option-icon {
  color: var(--accent);
}

.apply-option-content {
  flex: 1;
}

.apply-option-title {
  font-weight: 600;
  margin-bottom: 4px;
}

.apply-option-desc {
  font-size: 13px;
  color: var(--text-secondary);
}

.apply-footer {
  display: flex;
  gap: 12px;
  justify-content: center;
}
</style>















