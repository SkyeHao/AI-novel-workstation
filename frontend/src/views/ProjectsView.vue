<template>
  <div class="projects-page">
    <PageHeader title="我的作品" subtitle="在这里创建并管理你的小说项目" icon="Reading">
      <template #actions>
        <el-button type="primary" @click="openCreate">
          <el-icon style="margin-right: 6px"><Plus /></el-icon>
          新建项目
        </el-button>
      </template>
    </PageHeader>

    <div v-if="loading" class="app-empty">
      <el-icon class="is-loading" :size="26"><Loading /></el-icon>
      <span>加载中...</span>
    </div>

    <template v-else-if="projects.length > 0">
      <div class="stat-grid cols-4">
        <div class="stat-card">
          <div class="stat-card-icon"><el-icon><Collection /></el-icon></div>
          <div class="stat-card-info">
            <div class="stat-card-value">{{ projects.length }}</div>
            <div class="stat-card-label">全部作品</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-card-icon"><el-icon><EditPen /></el-icon></div>
          <div class="stat-card-info">
            <div class="stat-card-value">{{ countByStatus('writing') }}</div>
            <div class="stat-card-label">正文生成中</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-card-icon"><el-icon><DataLine /></el-icon></div>
          <div class="stat-card-info">
            <div class="stat-card-value">{{ countByStatus('outline') }}</div>
            <div class="stat-card-label">大纲生成中</div>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-card-icon"><el-icon><CircleCheck /></el-icon></div>
          <div class="stat-card-info">
            <div class="stat-card-value">{{ countByStatus('review') }}</div>
            <div class="stat-card-label">质量审查中</div>
          </div>
        </div>
      </div>

      <div class="project-grid">
        <div v-for="p in projects" :key="p.id" class="project-card" @click="enterProject(p)">
          <div class="project-card-head">
            <div class="proj-dot" :class="'dot-' + p.status"></div>
            <span class="project-name" :title="p.name">{{ p.name }}</span>
            <el-tag size="small" :type="statusTag(p.status)" effect="light" round>{{ statusLabel(p.status) }}</el-tag>
            <RowActions class="card-menu" :items="rowActions()" @command="(cmd: string) => onRowCommand(cmd, p)" />
          </div>
          <div class="project-idea">{{ p.idea || '（暂无核心梗）' }}</div>
          <div class="project-meta">
            <span v-if="p.genre" class="meta-item">
              <el-icon><PriceTag /></el-icon>{{ p.genre }}
            </span>
            <span v-if="p.target_words" class="meta-item">
              <el-icon><Memo /></el-icon>{{ formatWords(p.target_words) }}
            </span>
            <span v-if="p.platform" class="meta-item">
              <el-icon><Aim /></el-icon>{{ platformLabel(p.platform) }}
            </span>
            <span class="meta-item time">
              <el-icon><Clock /></el-icon>{{ shortTime(p.updated_at) }}
            </span>
          </div>
          <div class="project-foot">
            <span class="foot-hint">点击进入创作</span>
            <el-button link type="primary" size="small" @click.stop="enterProject(p)">
              进入工作台<el-icon class="foot-arrow"><ArrowRight /></el-icon>
            </el-button>
          </div>
        </div>
      </div>
    </template>

    <div v-else class="empty-wrap">
      <el-empty description="还没有项目，点击右上角开始你的第一部作品">
        <el-button type="primary" @click="openCreate">新建项目</el-button>
      </el-empty>
    </div>

    <!-- 新建项目对话框 -->
    <el-dialog v-model="createVisible" title="新建小说项目" width="520px" :close-on-click-modal="false">
      <el-form :model="createForm" label-width="90px">
        <el-form-item label="书名" required>
          <el-input v-model="createForm.name" placeholder="输入书名（将作为项目目录名）" maxlength="32" show-word-limit />
        </el-form-item>
        <el-form-item label="题材类型">
          <el-select v-model="createForm.genre" placeholder="选择类型（可选）" clearable style="width: 100%">
            <el-option v-for="g in genreOptions" :key="g" :label="g" :value="g" />
          </el-select>
        </el-form-item>
        <el-form-item label="核心梗">
          <el-input
            v-model="createForm.idea"
            type="textarea"
            :rows="3"
            placeholder="一句话核心梗：谁 + 陷入什么死局 + 靠什么翻盘 + 最后爽到什么程度"
          />
        </el-form-item>
        <el-form-item label="目标字数">
          <el-input-number v-model="createForm.target_words" :min="0" :step="500000" :max="5000000" style="width: 100%" />
        </el-form-item>
        <el-form-item label="目标平台">
          <el-select v-model="createForm.platform" placeholder="可选" clearable style="width: 100%">
            <el-option label="番茄" value="fanqie" />
            <el-option label="起点" value="qidian" />
            <el-option label="晋江" value="jinjiang" />
            <el-option label="纵横" value="zongheng" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" :loading="creating" @click="submitCreate">创建</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { createProject, deleteProject, getCharacterStateTemplates, getProjects, type Project } from '@/api'
import RowActions, { type RowActionItem } from '@/components/RowActions.vue'
import PageHeader from '@/components/PageHeader.vue'

const router = useRouter()
const projects = ref<Project[]>([])
const loading = ref(false)
const createVisible = ref(false)
const creating = ref(false)
const createForm = reactive({
  name: '',
  genre: '',
  idea: '',
  target_words: 0,
  platform: '',
})

const DEFAULT_GENRE_OPTIONS = ['都市', '玄幻仙侠', '科幻未来', '历史权谋', '悬疑推理', '游戏异界', '言情', '末世生存', '军事竞技', '通用']
const genreOptions = ref<string[]>(DEFAULT_GENRE_OPTIONS)
async function loadGenreOptions() {
  try {
    const { data } = await getCharacterStateTemplates()
    if (data && data.length) genreOptions.value = data.map((t) => t.label)
  } catch {
    // 加载失败沿用内置默认题材
  }
}

const STATUS_LABELS: Record<string, string> = {
  ideation: '灵感捕捉',
  worldview: '世界观构建',
  characters: '人物塑造',
  outline: '大纲生成',
  writing: '正文生成',
  review: '质量审查',
  foreshadow: '文风优化',
}

function statusLabel(status: string): string {
  return STATUS_LABELS[status] || status
}

function statusTag(status: string) {
  switch (status) {
    case 'ideation': return 'primary'
    case 'writing': return 'success'
    case 'review': return 'warning'
    case 'foreshadow': return 'info'
    default: return 'primary'
  }
}

function countByStatus(status: string): number {
  return projects.value.filter((p) => p.status === status).length
}

function formatWords(w: number): string {
  if (w >= 10000) return (w / 10000).toFixed(0) + ' 万字'
  return w + ' 字'
}

const PLATFORM_LABELS: Record<string, string> = {
  fanqie: '番茄',
  qidian: '起点',
  jinjiang: '晋江',
  zongheng: '纵横',
}

function platformLabel(p: string): string {
  return PLATFORM_LABELS[p] || p
}

function shortTime(ts: string): string {
  if (!ts) return '-'
  const d = new Date(ts)
  const now = new Date()
  const diff = (now.getTime() - d.getTime()) / 1000
  if (diff < 3600) return '刚刚更新'
  if (diff < 86400) return Math.floor(diff / 3600) + ' 小时前更新'
  return d.toLocaleDateString('zh-CN') + ' 更新'
}

async function loadProjects() {
  loading.value = true
  try {
    const { data } = await getProjects()
    projects.value = data
  } catch (e: any) {
    ElMessage.error('加载项目失败: ' + (e?.message || e))
  } finally {
    loading.value = false
  }
}

function openCreate() {
  createForm.name = ''
  createForm.genre = ''
  createForm.idea = ''
  createForm.target_words = 0
  createForm.platform = ''
  createVisible.value = true
}

async function submitCreate() {
  if (!createForm.name.trim()) {
    ElMessage.warning('请输入书名')
    return
  }
  creating.value = true
  try {
    const { data } = await createProject({
      name: createForm.name.trim(),
      genre: createForm.genre,
      idea: createForm.idea,
      target_words: createForm.target_words,
      platform: createForm.platform,
    })
    ElMessage.success('项目「' + data.name + '」已创建')
    createVisible.value = false
    router.push({ path: '/projects/' + data.id + '/workbench', query: { name: data.name } })
  } catch (e: any) {
    ElMessage.error('创建失败: ' + (e?.response?.data?.detail || e?.message || e))
  } finally {
    creating.value = false
  }
}

function enterProject(p: Project) {
  router.push({ path: '/projects/' + p.id + '/workbench', query: { name: p.name } })
}

function rowActions(): RowActionItem[] {
  return [
    { command: 'enter', label: '进入工作台', icon: 'Right' },
    { command: 'delete', label: '删除项目', icon: 'Delete', type: 'danger', divided: true },
  ]
}

function onRowCommand(cmd: string, p: Project) {
  if (cmd === 'enter') enterProject(p)
  else if (cmd === 'delete') handleDelete(p)
}

async function handleDelete(p: Project) {
  try {
    await ElMessageBox.confirm(
      '确定删除项目「' + p.name + '」？项目数据（设定、章节等）将被永久删除，不可恢复。',
      '删除项目',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  try {
    await deleteProject(p.id)
    ElMessage.success('已删除「' + p.name + '」')
    await loadProjects()
  } catch (e: any) {
    ElMessage.error('删除失败: ' + (e?.response?.data?.detail || e?.message || e))
  }
}

onMounted(loadProjects)
onMounted(loadGenreOptions)
</script>

<style scoped>
.projects-page {
  max-width: 1200px;
  margin: 0 auto;
}
.project-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 16px;
}
.project-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  background: #fff;
  border: 1px solid var(--border-color-light);
  border-radius: 12px;
  padding: 16px 18px;
  cursor: pointer;
  transition: box-shadow var(--transition-base), transform var(--transition-base), border-color var(--transition-base);
}
.project-card:hover {
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08);
  transform: translateY(-2px);
  border-color: rgba(99, 102, 241, 0.35);
}
.project-card-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.project-name {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.card-menu {
  flex-shrink: 0;
}
.proj-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
  box-shadow: 0 0 0 4px rgba(99, 102, 241, 0.1);
}
.dot-ideation { background: #6366f1; }
.dot-worldview { background: #06b6d4; }
.dot-characters { background: #00b578; }
.dot-outline { background: #ff9f43; }
.dot-writing { background: #f7971e; }
.dot-review { background: #ef4444; }
.dot-foreshadow { background: #722ed1; }
.project-idea {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.6;
  min-height: 42px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.project-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
  font-size: 12px;
  color: var(--text-secondary);
}
.meta-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.meta-item .el-icon {
  color: var(--text-placeholder);
}
.meta-item.time {
  margin-left: auto;
  color: var(--text-placeholder);
}
.project-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 10px;
  border-top: 1px solid var(--border-color-light);
}
.foot-hint {
  font-size: 12px;
  color: var(--text-placeholder);
}
.foot-arrow {
  margin-left: 4px;
}
.empty-wrap {
  padding: 60px 0;
}
</style>

