<template>
  <div class="workbench-page">
    <div class="page-head">
      <div>
        <h2 class="page-title">工作台 · {{ project?.name }}</h2>
        <p class="page-subtitle">小说级状态演进周期与项目总览</p>
      </div>
      <el-button type="primary" @click="goAgent">
        <el-icon style="margin-right: 6px"><ChatDotRound /></el-icon>
        进入 Agent 窗口
      </el-button>
    </div>

    <el-alert
      v-if="!prereq.complete && loaded"
      type="warning"
      :closable="false"
      show-icon
      style="margin-bottom: 16px"
    >
      <template #title>
        前置设定不完整：{{ prereq.missing.join('、') }}。可先在 Agent 窗口生成，或到对应状态面板补全。
      </template>
    </el-alert>

    <!-- 状态演进周期（T1） -->
    <el-card shadow="never" class="block-card">
      <template #header>
        <div class="card-head">
          <span>状态演进周期</span>
          <el-button link type="primary" size="small" @click="openStatesConfig">
            配置本书启用的状态
          </el-button>
        </div>
      </template>
      <div class="state-steps">
        <div
          v-for="s in states"
          :key="s.key"
          class="state-step"
          :class="{ current: s.key === currentState, disabled: !s.enabled_in_project }"
          @click="switchState(s.key)"
        >
          <div class="state-dot" :style="{ background: stateColor(s.key) }">
            <el-icon v-if="s.key === currentState"><Check /></el-icon>
          </div>
          <div class="state-label">{{ s.label }}</div>
          <div class="state-key">{{ s.key }}</div>
        </div>
      </div>
    </el-card>

    <el-collapse v-model="wbPanels" class="group-collapse mt-16">
      <el-collapse-item name="info">
        <template #title>
          <div class="collapse-title">
            <el-icon><InfoFilled /></el-icon>
            <span>项目信息</span>
            <span class="collapse-count">书名 / 题材 / 平台 / 目标字数 / 工作单元 / 核心梗</span>
          </div>
        </template>
        <el-form label-width="72px" size="small">
            <el-form-item label="书名"><el-input v-model="project.name" @change="saveMeta" /></el-form-item>
            <el-form-item label="题材"><el-input v-model="project.genre" placeholder="主+副，如 玄幻+系统流" @change="saveMeta" /></el-form-item>
            <el-form-item label="平台"><el-input v-model="project.platform" placeholder="番茄/起点/…" @change="saveMeta" /></el-form-item>
            <el-form-item label="目标字数">
              <el-input-number v-model="project.target_words" :min="0" :step="100000" style="width: 100%" @change="saveMeta" />
            </el-form-item>
            <el-form-item label="工作单元"><el-input v-model="project.work_unit" placeholder="如 ch3" @change="saveMeta" /></el-form-item>
            <el-form-item label="核心梗">
              <el-input v-model="project.idea" type="textarea" :rows="3" @change="saveMeta" />
            </el-form-item>
          </el-form>
          <el-divider />
          <div class="stat-grid">
            <div class="stat"><span class="num">{{ memoryStats.facts }}</span><span class="label">正典事实</span></div>
            <div class="stat"><span class="num">{{ memoryStats.foreshadow }}</span><span class="label">伏笔</span></div>
            <div class="stat"><span class="num">{{ memoryStats.characters }}</span><span class="label">人物</span></div>
            <div class="stat"><span class="num">{{ memoryStats.summaries }}</span><span class="label">摘要层</span></div>
          </div>
      </el-collapse-item>
      <el-collapse-item name="core">
        <template #title>
          <div class="collapse-title">
            <el-icon><DataAnalysis /></el-icon>
            <span>核心要素</span>
            <span class="collapse-count">唯一事实源（可在 Agent 窗口共创生成）</span>
          </div>
        </template>
        <pre v-if="coreElementsText" class="json-pre">{{ coreElementsText }}</pre>
          <el-empty v-else description="尚未生成核心要素，可在 Agent 窗口中与 Agent 共创生成" :image-size="60" />
      </el-collapse-item>
      <el-collapse-item name="docs">
        <template #title>
          <div class="collapse-title">
            <el-icon><FolderOpened /></el-icon>
            <span>项目文档</span>
            <span class="collapse-count">设定 / 记忆 / 审阅产物</span>
          </div>
        </template>
        <el-table :data="documents" size="small" max-height="360">
            <el-table-column prop="name" label="文档" show-overflow-tooltip />
            <el-table-column label="操作" width="90">
              <template #default="{ row }">
                <el-button link type="primary" size="small" @click="openDoc(row)">查看</el-button>
              </template>
            </el-table-column>
          </el-table>
      </el-collapse-item>
    </el-collapse>

    <!-- 状态配置对话框 -->
    <el-dialog v-model="statesConfigVisible" title="配置本书启用的状态（可扩展）" width="460px">
      <p class="tip">预置 7 个状态，可按本书需要增删启用。伏笔管理为横切可选状态。</p>
      <el-checkbox-group v-model="enabledStates">
        <el-checkbox v-for="s in allStates" :key="s.key" :label="s.key" :value="s.key" style="display: block; margin-bottom: 8px">
          {{ s.label }} <span class="muted">（{{ s.key }}）</span>
        </el-checkbox>
      </el-checkbox-group>
      <template #footer>
        <el-button @click="statesConfigVisible = false">取消</el-button>
        <el-button type="primary" :loading="savingStates" @click="saveStatesConfig">保存</el-button>
      </template>
    </el-dialog>

    <!-- 文档预览 -->
    <el-dialog v-model="docVisible" :title="currentDoc?.name ?? '文档'" width="720px" top="6vh">
      <div class="doc-content">
        <MarkdownView v-if="currentDocContent" :content="currentDocContent" />
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import MarkdownView from '@/components/MarkdownView.vue'
import {
  getProject, updateProject, getProjectStates, switchProjectState, updateStatesConfig,
  getProjectMemory, getProjectDocuments, readProjectDocument, getPrereqCheck, getCoreElements,
  type Project, type StateNode,
} from '@/api'

const route = useRoute()
const router = useRouter()
const projectId = route.params.id as string

const project = reactive<Project>({
  id: projectId, name: '', status: 'ideation', target_words: 0, platform: '', genre: '', idea: '',
  work_unit: '', states_enabled: [], created_at: '', updated_at: '',
})
const loaded = ref(false)
const states = ref<StateNode[]>([])
const currentState = ref('ideation')
const prereq = reactive<{ complete: boolean; missing: string[] }>({ complete: true, missing: [] })
const memoryStats = reactive({ facts: 0, foreshadow: 0, characters: 0, summaries: 0 })
const coreElementsText = ref('')
const documents = ref<Array<{ name: string; path: string; size: number; modified: number }>>([])
const docVisible = ref(false)
const currentDoc = ref<{ name: string; path: string } | null>(null)
const currentDocContent = ref('')

const wbPanels = ref(['info'])
const statesConfigVisible = ref(false)
const allStates = ref<StateNode[]>([])
const enabledStates = ref<string[]>([])
const savingStates = ref(false)

async function load() {
  const res = await getProject(projectId)
  Object.assign(project, res.data)
  const st = await getProjectStates(projectId)
  states.value = st.data.states
  currentState.value = st.data.current_state
  const pc = await getPrereqCheck(projectId)
  prereq.complete = pc.data.complete
  prereq.missing = pc.data.missing
  const mem = await getProjectMemory(projectId)
  Object.assign(memoryStats, mem.data.stats)
  const ce = await getCoreElements(projectId)
  coreElementsText.value = ce.data.exists && Object.keys(ce.data.data).length ? JSON.stringify(ce.data.data, null, 2) : ''
  const docs = await getProjectDocuments(projectId)
  documents.value = docs.data.documents
  loaded.value = true
}

async function saveMeta() {
  try {
    const res = await updateProject(projectId, {
      name: project.name, genre: project.genre, platform: project.platform,
      target_words: project.target_words, idea: project.idea, work_unit: project.work_unit,
    })
    Object.assign(project, res.data)
    ElMessage.success('已保存')
  } catch (err: any) {
    ElMessage.error(err?.response?.data?.error || '保存失败')
  }
}

async function switchState(key: string) {
  const s = states.value.find((x) => x.key === key)
  if (!s || s.enabled_in_project === false) return
  try {
    const res = await switchProjectState(projectId, key)
    currentState.value = res.data.current_state
    ElMessage.success(`已切换到 ${res.data.label}`)
  } catch (err: any) {
    ElMessage.error(err?.response?.data?.error || '切换失败')
  }
}

function stateColor(key: string): string {
  const map: Record<string, string> = {
    ideation: '#4f8cff', worldview: '#6f5cff', characters: '#00b578', outline: '#ff9f43',
    writing: '#eb5757', review: '#f5222d', foreshadow: '#722ed1',
  }
  return map[key] || '#909399'
}

function openStatesConfig() {
  allStates.value = states.value.map((s) => ({ ...s, enabled_in_project: undefined }))
  enabledStates.value = states.value.filter((s) => s.enabled_in_project !== false).map((s) => s.key)
  statesConfigVisible.value = true
}

async function saveStatesConfig() {
  savingStates.value = true
  try {
    const res = await updateStatesConfig(projectId, { states_enabled: enabledStates.value })
    project.states_enabled = res.data.states_enabled
    ElMessage.success('已保存状态配置')
    statesConfigVisible.value = false
    await load()
  } catch (err: any) {
    ElMessage.error(err?.response?.data?.error || '保存失败')
  } finally {
    savingStates.value = false
  }
}

async function openDoc(doc: { name: string; path: string }) {
  currentDoc.value = doc
  const res = await readProjectDocument(projectId, doc.path)
  currentDocContent.value = res.data.content
  docVisible.value = true
}

function goAgent() {
  router.push(`/projects/${projectId}/agent`)
}

onMounted(() => {
  load().catch((err: any) => ElMessage.error(err?.response?.data?.error || '加载失败'))
})
</script>

<style scoped>
.page-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.page-title { font-size: 20px; font-weight: 600; color: var(--text-primary); margin: 0 0 4px; }
.page-subtitle { font-size: 13px; color: var(--text-secondary); margin: 0; }
.block-card { margin-bottom: 16px; }
.h-full { height: 100%; }
.mt-16 { margin-top: 16px; }
.card-head { display: flex; justify-content: space-between; align-items: center; }

.state-steps { display: flex; gap: 12px; flex-wrap: wrap; }
.state-step {
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  padding: 14px 18px; border-radius: 12px; cursor: pointer; background: #f7f8fa;
  border: 1px solid transparent; transition: all .2s; min-width: 96px;
}
.state-step:hover { border-color: #4f8cff; transform: translateY(-2px); }
.state-step.current { background: linear-gradient(135deg, rgba(79,140,255,.12), rgba(111,92,255,.12)); border-color: #4f8cff; }
.state-step.disabled { opacity: .45; cursor: not-allowed; }
.state-dot { width: 34px; height: 34px; border-radius: 50%; color: #fff; display: flex; align-items: center; justify-content: center; }
.state-label { font-size: 13px; font-weight: 600; }
.state-key { font-size: 11px; color: var(--text-placeholder); }

.stat-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.stat { display: flex; flex-direction: column; align-items: center; gap: 2px; }
.stat .num { font-size: 22px; font-weight: 700; color: var(--app-primary); }
.stat .label { font-size: 12px; color: var(--text-secondary); }

.json-pre {
  background: #0f172a; color: #e2e8f0; border-radius: 8px; padding: 14px;
  font-size: 12px; line-height: 1.6; max-height: 400px; overflow: auto; white-space: pre-wrap; word-break: break-all;
}
.tip { font-size: 13px; color: var(--text-secondary); margin: 0 0 12px; }
.muted { color: var(--text-placeholder); }
.doc-content { max-height: 70vh; overflow: auto; }
</style>

