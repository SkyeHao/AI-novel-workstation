<template>
  <div class="workbench-view">
    <PageHeader title="工作台" subtitle="创作引擎运行状态与项目总览" icon="Monitor">
      <template #actions>
        <el-button type="primary" @click="goTo('agent')">
          <el-icon style="margin-right: 6px"><MagicStick /></el-icon>
          进入创作引擎
        </el-button>
      </template>
    </PageHeader>

    <div class="stat-grid cols-4">
      <div class="stat-card">
        <div class="stat-card-icon"><el-icon><Switch /></el-icon></div>
        <div class="stat-card-info">
          <div class="stat-card-value">{{ currentStateLabel || '—' }}</div>
          <div class="stat-card-label">当前流程节点</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-card-icon"><el-icon><Operation /></el-icon></div>
        <div class="stat-card-info">
          <div class="stat-card-value">{{ enabledStateCount }}</div>
          <div class="stat-card-label">已启用节点</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-card-icon"><el-icon><Briefcase /></el-icon></div>
        <div class="stat-card-info">
          <div class="stat-card-value stat-value-ellipsis" :title="workUnit">{{ workUnit || '—' }}</div>
          <div class="stat-card-label">当前工作单元</div>
        </div>
      </div>
      <div class="stat-card">
        <div class="stat-card-icon"><el-icon><Cpu /></el-icon></div>
        <div class="stat-card-info">
          <div class="stat-card-value">{{ runtimeLogs.length }}</div>
          <div class="stat-card-label">引擎运行记录</div>
        </div>
      </div>
    </div>

    <div class="workbench-grid">
      <!-- 当前节点状态 -->
      <div class="panel">
        <div class="panel-head">
          <div class="panel-title-group">
            <el-icon class="panel-title-icon"><Switch /></el-icon>
            <span class="panel-title">当前节点状态</span>
          </div>
          <el-tag size="small" type="primary" effect="light" round>{{ currentState || '未定义' }}</el-tag>
        </div>
        <div class="panel-body">
          <div class="state-hero" :style="{ borderColor: stateColor(currentState) }">
            <div class="state-dot" :style="{ background: stateColor(currentState) }"></div>
            <div class="state-hero-info">
              <div class="state-hero-label">{{ currentStateLabel || '未知节点' }}</div>
              <div class="state-hero-key mono">{{ currentState || '—' }}</div>
            </div>
          </div>
          <div class="state-switch">
            <span class="state-switch-label">流程节点</span>
            <FlowStepper
              :nodes="stateFlow.map(s => ({ key: s.key, label: s.label }))"
              :current-key="currentState"
              :completed-keys="stateFlow.filter(s => s.index < stateProgressIndex).map(s => s.key)"
              clickable
              @select="handleNodeSelect"
            />
          </div>
        </div>
      </div>

      <!-- 引擎运行记录 -->
      <div class="panel">
        <div class="panel-head">
          <div class="panel-title-group">
            <el-icon class="panel-title-icon"><List /></el-icon>
            <span class="panel-title">引擎运行记录</span>
          </div>
          <div class="panel-actions">
            <el-button link type="primary" size="small" @click="goTo('agent')">查看详情</el-button>
          </div>
        </div>
        <div class="panel-body">
          <div v-if="runtimeLogs.length === 0" class="app-empty panel-empty">
            <el-icon :size="22"><List /></el-icon>
            <span>暂无运行记录</span>
          </div>
          <div v-else class="logs-list">
            <div v-for="log in runtimeLogs.slice(0, 5)" :key="log.id" class="log-item">
              <span class="log-time mono">{{ formatTime(log.timestamp) }}</span>
              <span class="log-node">{{ log.node }}</span>
              <span class="log-action">{{ log.action }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 设定完成度 -->
      <div class="panel">
        <div class="panel-head">
          <div class="panel-title-group">
            <el-icon class="panel-title-icon"><DataAnalysis /></el-icon>
            <span class="panel-title">设定完成度</span>
          </div>
          <el-tag size="small" type="info" effect="plain">参考值</el-tag>
        </div>
        <div class="panel-body">
          <div class="completion-stats">
            <div v-for="stat in completionStats" :key="stat.key" class="completion-item">
              <div class="completion-row">
                <span class="completion-label">{{ stat.label }}</span>
                <span class="completion-pct mono">{{ stat.percentage }}%</span>
              </div>
              <el-progress :percentage="stat.percentage" :show-text="false" :status="stat.percentage === 100 ? 'success' : ''" :stroke-width="8" />
            </div>
          </div>
        </div>
      </div>

      <!-- 题材与人物状态维度 -->
      <div class="panel">
        <div class="panel-head">
          <div class="panel-title-group">
            <el-icon class="panel-title-icon"><User /></el-icon>
            <span class="panel-title">题材与人物状态维度</span>
          </div>
          <el-tag size="small" type="primary" effect="plain" round>{{ projectGenre || '未设定题材' }}</el-tag>
        </div>
        <div class="panel-body">
          <div v-if="templateInfo" class="genre-desc">{{ templateInfo.description }}</div>
          <div class="dims-hint">人物动态状态随题材变化：自定义维度优先，留空则使用题材模板；Agent 仍可自由写入额外字段。</div>
          <div v-if="customDims.length === 0 && templateInfo" class="block-label">题材模板维度</div>
          <div v-if="customDims.length === 0 && templateInfo" class="template-dims">
            <span v-for="d in templateInfo.dimensions" :key="d.key" class="dim-chip" :class="{ 'dim-core': d.core }">{{ d.label }}<template v-if="d.core">*</template></span>
          </div>
          <div v-if="customDims.length > 0" class="block-label">自定义维度</div>
          <div v-if="customDims.length > 0" class="custom-dims">
            <div v-for="(dim, i) in customDims" :key="i" class="dim-row">
              <el-input v-model="dim.key" placeholder="字段名" size="small" class="dim-key" />
              <el-input v-model="dim.label" placeholder="中文名" size="small" class="dim-label" />
              <el-input v-model="dim.hint" placeholder="说明" size="small" class="dim-hint" />
              <el-button link type="danger" @click="removeDim(i)"><el-icon><Delete /></el-icon></el-button>
            </div>
          </div>
          <div class="dim-actions">
            <el-button size="small" @click="addDim"><el-icon><Plus /></el-icon>{{ customDims.length ? '新增维度' : '自定义维度' }}</el-button>
            <el-button v-if="customDims.length > 0" size="small" @click="resetToTemplate">恢复题材模板</el-button>
            <el-button v-if="customDims.length > 0" size="small" type="primary" :loading="savingDims" @click="saveDims">保存</el-button>
          </div>
        </div>
      </div>
      <!-- 快速入口 -->
      <div class="panel">
        <div class="panel-head">
          <div class="panel-title-group">
            <el-icon class="panel-title-icon"><Connection /></el-icon>
            <span class="panel-title">快速入口</span>
          </div>
        </div>
        <div class="panel-body">
          <div class="quick-links">
            <div class="quick-link" v-for="link in quickLinks" :key="link.name" @click="goTo(link.name)">
              <div class="quick-link-icon"><el-icon><component :is="link.icon" /></el-icon></div>
              <div class="quick-link-info">
                <span class="quick-link-title">{{ link.title }}</span>
                <span class="quick-link-desc">{{ link.desc }}</span>
              </div>
              <el-icon class="quick-link-arrow"><ArrowRight /></el-icon>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import {
  getProject,
  getProjectStates,
  getCharacterStateTemplates,
  updateProject,
  type CharacterStateTemplate,
  type CharacterDimension,
} from '@/api'
import PageHeader from '@/components/PageHeader.vue'

const route = useRoute()
const router = useRouter()
const projectId = route.params.id as string

const currentState = ref('')
const currentStateLabel = ref('')
const workUnit = ref('')
const stateFlow = ref<{ key: string; label: string; index: number; enabled?: boolean }[]>([])
const runtimeLogs = ref<any[]>([])
const completionStats = ref<any[]>([])
const projectGenre = ref('')
const templateInfo = ref<CharacterStateTemplate | null>(null)
const customDims = ref<CharacterDimension[]>([])
const savingDims = ref(false)

const STATE_FLOW_BASE = [
  { key: 'ideation', label: '灵感捕捉' },
  { key: 'worldview', label: '世界观构建' },
  { key: 'characters', label: '人物塑造' },
  { key: 'outline', label: '大纲生成' },
  { key: 'writing', label: '正文生成' },
  { key: 'review', label: '质量审查' },
  { key: 'style', label: '文风优化' },
]

const quickLinks = [
  { name: 'static-settings', title: '静态设定', desc: '愿景 · 世界观 · 人物 · 大纲 · 风格', icon: 'Notebook' },
  { name: 'dynamic-settings', title: '动态设定', desc: '人物状态 · 地点 · 物品 · 事件 · 伏笔', icon: 'DataBoard' },
  { name: 'agent', title: '创作引擎', desc: '与 Agent 对话推进创作', icon: 'MagicStick' },
  { name: 'reading', title: '正文阅读', desc: '章节内容与章尾钩子', icon: 'Reading' },
]

const enabledStateCount = computed(() => stateFlow.value.filter((s) => s.enabled !== false).length)

const stateProgressIndex = computed(() => {
  const idx = stateFlow.value.findIndex((s) => s.key === currentState.value)
  return idx >= 0 ? idx : -1
})

function stateColor(key: string): string {
  const map: Record<string, string> = {
    ideation: '#6366f1', worldview: '#4f46e5', characters: '#00b578',
    outline: '#ff9f43', writing: '#eb5757', review: '#ef4444', style: '#8b5cf6',
  }
  return map[key] || '#909399'
}

function formatTime(timestamp: string): string {
  if (!timestamp) return '-'
  return new Date(timestamp).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function goTo(name: string) {
  router.push('/projects/' + projectId + '/' + name)
}

function handleNodeSelect(key: string) {
  // 可以在这里添加节点切换逻辑，如调用switchState API
  console.log('选择节点:', key)
}

function matchCharacterStateTemplate(list: CharacterStateTemplate[], genre: string): CharacterStateTemplate | null {
  const key = (genre || '').trim()
  if (!key) return list.find((t) => t.id === 'generic') || list[list.length - 1] || null
  return (
    list.find((t) => t.label === key || t.id === key || t.label.includes(key) || key.includes(t.label)) ||
    list.find((t) => t.id === 'generic') ||
    list[list.length - 1] ||
    null
  )
}

function addDim() {
  customDims.value.push({ key: '', label: '', hint: '' })
}

function removeDim(index: number) {
  customDims.value.splice(index, 1)
}

function resetToTemplate() {
  customDims.value = []
}

async function saveDims() {
  const cleaned = customDims.value
    .map((d) => ({ key: d.key.trim(), label: d.label.trim() || d.key.trim(), hint: d.hint.trim() }))
    .filter((d) => d.key)
  savingDims.value = true
  try {
    await updateProject(projectId, { character_dimensions: cleaned })
    customDims.value = cleaned
    ElMessage.success('人物状态维度已保存')
  } catch (e: any) {
    ElMessage.error('保存失败: ' + (e?.message || e))
  } finally {
    savingDims.value = false
  }
}

onMounted(async () => {
  try {
    const res = await getProjectStates(projectId)
    currentState.value = res.data.current_state
    currentStateLabel.value = res.data.current_label || res.data.current_state
    workUnit.value = res.data.work_unit || ''
    const enabled = res.data.states || []
    stateFlow.value = STATE_FLOW_BASE.map((s, i) => ({
      ...s,
      index: i,
      enabled: !enabled.length || enabled.some((e: any) => e?.key === s.key || e === s.key),
    }))
    runtimeLogs.value = []
    completionStats.value = [
      { key: 'vision', label: '故事愿景', percentage: 0 },
      { key: 'worldview', label: '世界观构建', percentage: 0 },
      { key: 'characters', label: '人物塑造', percentage: 0 },
      { key: 'outline', label: '大纲', percentage: 0 },
      { key: 'style', label: '风格规范', percentage: 0 },
    ]
    try {
      const proj = await getProject(projectId)
      projectGenre.value = proj.data?.genre || ''
      customDims.value = proj.data?.character_dimensions || []
    } catch {
      // 忽略：拿不到项目信息时保持默认
    }
    try {
      const tmpl = await getCharacterStateTemplates()
      templateInfo.value = matchCharacterStateTemplate(tmpl.data || [], projectGenre.value)
    } catch {
      templateInfo.value = null
    }
  } catch (err) {
    console.error('Failed to load workbench data:', err)
  }
})
</script>

<style scoped>
.workbench-view { max-width: 1400px; margin: 0 auto; }
.stat-value-ellipsis { font-size: 18px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 220px; }
.workbench-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(380px, 1fr)); gap: 16px; }
.panel-empty { min-height: 96px; }

/* 当前节点 */
.state-hero {
  display: flex; align-items: center; gap: 14px;
  border: 2px solid; border-radius: var(--radius-lg); padding: 16px 18px; 
  background: var(--surface); box-shadow: var(--shadow-sm);
  transition: all var(--transition-base);
}
.state-hero:hover {
  box-shadow: var(--shadow-md);
  transform: translateY(-2px);
}
.state-dot { 
  width: 14px; height: 14px; border-radius: 50%; flex-shrink: 0; 
  box-shadow: 0 0 0 4px rgba(79,70,229,.12);
  transition: all var(--transition-base);
}
.state-hero-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.state-hero-label { font-size: 17px; font-weight: 700; color: var(--text-primary); }
.state-hero-key { font-size: 12px; color: var(--text-secondary); }
.state-switch { margin-top: 14px; }
.state-switch-label { font-size: 12px; color: var(--text-secondary); font-weight: 600; display: block; margin-bottom: 8px; }
.flow-step { display: flex; align-items: center; gap: 8px; padding: 6px 0; }
.flow-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.flow-label { font-size: 13px; color: var(--text-primary); }
.flow-step.active .flow-label { font-weight: 700; }
.flow-step.done:not(.active) .flow-label { color: var(--text-secondary); }

/* 运行记录 */
.logs-list { display: flex; flex-direction: column; gap: 8px; }
.log-item {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 12px; background: var(--accent-soft); 
  border: 1px solid var(--accent-border); border-radius: var(--radius-md); 
  font-size: 13px; transition: all var(--transition-base);
}
.log-item:hover {
  background: var(--accent-border);
  transform: translateX(4px);
}
.log-time { color: var(--text-secondary); min-width: 80px; font-size: 12px; }
.log-node { font-weight: 600; color: var(--accent); }
.log-action { color: var(--text-primary); }

/* 完成度 */
.completion-stats { display: flex; flex-direction: column; gap: 14px; }
.completion-item { display: flex; flex-direction: column; gap: 6px; }
.completion-row { display: flex; align-items: center; justify-content: space-between; }
.completion-label { font-size: 13px; color: var(--text-primary); }
.completion-pct { font-size: 12px; color: var(--text-secondary); }

/* 快速入口 */
.quick-links { display: flex; flex-direction: column; gap: 10px; }
.quick-link {
  display: flex; align-items: center; gap: 12px;
  padding: 14px 16px; border: 1px solid var(--border); border-radius: var(--radius-lg);
  background: var(--surface); cursor: pointer; transition: all var(--transition-base);
}
.quick-link:hover { 
  border-color: var(--accent-border); 
  box-shadow: var(--shadow-hover);
  transform: translateY(-2px);
}
.quick-link-icon {
  width: 38px; height: 38px; border-radius: 10px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  background: #eef2ff; color: #6366f1; font-size: 18px;
}
.quick-link-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.quick-link-title { font-size: 14px; font-weight: 600; color: var(--text-primary); }
.quick-link-desc { font-size: 12px; color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.quick-link-arrow { color: var(--text-placeholder); }

/* 题材与人物状态维度 */
.genre-desc { font-size: 12px; color: var(--text-secondary); margin-bottom: 8px; }
.dims-hint { font-size: 12px; color: var(--text-placeholder); margin-bottom: 10px; }
.block-label { font-size: 12px; color: var(--text-secondary); font-weight: 600; margin-bottom: 8px; }
.template-dims { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
.dim-chip {
  padding: 3px 10px; border-radius: 999px; font-size: 12px;
  background: var(--accent-soft); color: var(--accent); border: 1px solid var(--accent-border);
}
.dim-chip.dim-core { font-weight: 600; }
.custom-dims { display: flex; flex-direction: column; gap: 8px; margin-bottom: 10px; }
.dim-row { display: flex; align-items: center; gap: 8px; }
.dim-key { width: 130px; }
.dim-label { width: 110px; }
.dim-hint { flex: 1; }
.dim-actions { display: flex; align-items: center; gap: 8px; }
</style>

