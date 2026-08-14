<template>
  <div class="projects-page">
    <div class="page-head">
      <div>
        <h2 class="page-title">我的作品</h2>
        <p class="page-subtitle">在这里创建并管理你的小说项目</p>
      </div>
      <el-button type="primary" size="large" @click="openCreate">
        <el-icon style="margin-right: 6px"><Plus /></el-icon>
        新建项目
      </el-button>
    </div>

    <el-empty
      v-if="loading"
      description="加载中..."
      :image-size="80"
    />

    <div v-else-if="projects.length === 0" class="empty-wrap">
      <el-empty description="还没有项目，点击右上角开始你的第一部作品">
        <el-button type="primary" @click="openCreate">新建项目</el-button>
      </el-empty>
    </div>

    <div v-else class="project-grid">
      <div
        v-for="p in projects"
        :key="p.id"
        class="project-card"
        @click="enterProject(p)"
      >
        <div class="project-cover" :class="'cover-' + p.status">
          <el-icon :size="34"><Notebook /></el-icon>
          <span class="cover-status">{{ statusLabel(p.status) }}</span>
        </div>
        <div class="project-body">
          <h3 class="project-name">{{ p.name }}</h3>
          <p class="project-idea" :title="p.idea">{{ p.idea || '（暂无核心梗）' }}</p>
          <div class="project-meta">
            <el-tag size="small" :type="statusTag(p.status)">{{ statusLabel(p.status) }}</el-tag>
            <span v-if="p.genre" class="meta-item">{{ p.genre }}</span>
            <span v-if="p.target_words" class="meta-item">{{ formatWords(p.target_words) }}</span>
            <span v-if="p.platform" class="meta-item">{{ platformLabel(p.platform) }}</span>
          </div>
        </div>
        <div class="project-footer">
          <span class="update-time">更新于 {{ shortTime(p.updated_at) }}</span>
          <span class="footer-actions">
            <el-button
              class="delete-btn"
              link
              type="danger"
              size="small"
              @click.stop="handleDelete(p)"
            >
              <el-icon><Delete /></el-icon>
            </el-button>
            <span class="enter-hint">
              进入
              <el-icon size="14"><ArrowRight /></el-icon>
            </span>
          </span>
        </div>
      </div>
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
import { createProject, deleteProject, getProjects, type Project } from '@/api'

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

const genreOptions = ['玄幻', '都市', '科幻', '历史', '系统流', '重生', '穿越', '末世', '游戏', '灵异', '军事', '其他']

const STATUS_LABELS: Record<string, string> = {
  ideation: '创意中',
  setting: '设定中',
  writing: '写作中',
  reviewing: '审阅中',
}

function statusLabel(status: string): string {
  return STATUS_LABELS[status] || status
}

function statusTag(status: string) {
  switch (status) {
    case 'ideation': return 'info'
    case 'setting': return 'primary'
    case 'writing': return 'success'
    case 'reviewing': return 'warning'
    default: return 'info'
  }
}

function formatWords(w: number): string {
  if (w >= 10000) return `${(w / 10000).toFixed(0)} 万字`
  return `${w} 字`
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
  if (diff < 3600) return '刚刚'
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`
  return d.toLocaleDateString('zh-CN')
}

async function loadProjects() {
  loading.value = true
  try {
    const { data } = await getProjects()
    projects.value = data
  } catch (e: any) {
    ElMessage.error(`加载项目失败: ${e?.message || e}`)
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
    ElMessage.success(`项目「${data.name}」已创建`)
    createVisible.value = false
    // 直接进入 IDEATION
    router.push({ path: `/projects/${data.id}/ideation` })
  } catch (e: any) {
    ElMessage.error(`创建失败: ${e?.response?.data?.detail || e?.message || e}`)
  } finally {
    creating.value = false
  }
}

function enterProject(p: Project) {
  router.push({ path: `/projects/${p.id}/ideation` })
}

async function handleDelete(p: Project) {
  try {
    await ElMessageBox.confirm(
      `确定删除项目「${p.name}」？项目数据（设定、章节等）将被永久删除，不可恢复。`,
      '删除项目',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  try {
    await deleteProject(p.id)
    ElMessage.success(`已删除「${p.name}」`)
    await loadProjects()
  } catch (e: any) {
    ElMessage.error(`删除失败: ${e?.response?.data?.detail || e?.message || e}`)
  }
}

onMounted(loadProjects)
</script>

<style scoped>
.projects-page {
  max-width: 1200px;
  margin: 0 auto;
}

.page-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  margin-bottom: 24px;
}

.page-title {
  margin: 0;
  font-size: 24px;
  font-weight: 600;
  color: var(--text-primary);
}

.page-subtitle {
  margin: 6px 0 0;
  color: var(--text-secondary);
  font-size: 14px;
}

.project-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 20px;
}

.project-card {
  background: var(--card-bg);
  border-radius: 12px;
  overflow: hidden;
  cursor: pointer;
  border: 1px solid var(--border-color-light);
  box-shadow: var(--card-shadow);
  transition: all var(--transition-base);
  display: flex;
  flex-direction: column;
}

.project-card:hover {
  transform: translateY(-4px);
  box-shadow: var(--card-shadow-hover);
  border-color: rgba(79, 140, 255, 0.4);
}

.project-cover {
  height: 110px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  position: relative;
  gap: 10px;
}

.cover-ideation { background: linear-gradient(135deg, #4f8cff 0%, #6f5cff 100%); }
.cover-setting { background: linear-gradient(135deg, #36d1dc 0%, #5b86e5 100%); }
.cover-writing { background: linear-gradient(135deg, #f7971e 0%, #ffd200 100%); }
.cover-reviewing { background: linear-gradient(135deg, #c86dd7 0%, #ff6ec4 100%); }

.cover-status {
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 1px;
}

.project-body {
  padding: 16px 18px;
  flex: 1;
}

.project-name {
  margin: 0 0 8px;
  font-size: 17px;
  font-weight: 600;
  color: var(--text-primary);
}

.project-idea {
  margin: 0 0 12px;
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  min-height: 39px;
}

.project-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.meta-item {
  font-size: 12px;
  color: var(--text-secondary);
}

.project-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 18px;
  border-top: 1px solid var(--border-color-light);
  background: #fafbfc;
}

.update-time {
  font-size: 12px;
  color: var(--text-placeholder);
}

.enter-hint {
  display: flex;
  align-items: center;
  gap: 2px;
  font-size: 13px;
  color: var(--app-primary);
  font-weight: 500;
}

.footer-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.delete-btn {
  padding: 4px;
  color: var(--text-placeholder) !important;
}

.delete-btn:hover {
  color: var(--app-danger) !important;
  background: rgba(245, 108, 108, 0.08);
}

.empty-wrap {
  padding: 60px 0;
}
</style>
