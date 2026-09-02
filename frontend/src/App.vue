<template>
  <el-container class="app-container">
    <el-aside :width="sidebarWidth" class="app-aside" :class="{ collapsed: sidebarCollapsed }">
      <div class="logo">
        <div class="logo-icon">
          <el-icon size="22"><Notebook /></el-icon>
        </div>
        <div class="logo-text-group">
          <span class="logo-title">AI 小说工作站</span>
          <span class="logo-subtitle">Novel Workstation</span>
        </div>
      </div>
      <el-menu
        :default-active="activeMenu"
        class="app-menu"
        :background-color="'transparent'"
        text-color="#3f3f46"
        active-text-color="#4f46e5"
        router
      >
        <!-- 创作模块 -->
        <el-menu-item-group title="创作">
          <el-menu-item index="/projects">
            <el-icon><HomeFilled /></el-icon>
            <span>作品库</span>
          </el-menu-item>
          <template v-if="currentProject.id">
            <el-menu-item :index="`/projects/${currentProject.id}/workbench`">
              <el-icon><Odometer /></el-icon>
              <span>工作台</span>
            </el-menu-item>
            <el-menu-item :index="`/projects/${currentProject.id}/static-settings`">
              <el-icon><Files /></el-icon>
              <span>静态设定</span>
            </el-menu-item>
            <el-menu-item :index="`/projects/${currentProject.id}/dynamic-settings`">
              <el-icon><DataLine /></el-icon>
              <span>动态设定</span>
            </el-menu-item>
            <el-menu-item :index="`/projects/${currentProject.id}/reading`">
              <el-icon><EditPen /></el-icon>
              <span>正文</span>
            </el-menu-item>
            <el-menu-item :index="`/projects/${currentProject.id}/discussion`">
              <el-icon><ChatLineSquare /></el-icon>
              <span>圆桌会议</span>
            </el-menu-item>
            <el-menu-item :index="`/projects/${currentProject.id}/plans`">
              <el-icon><Files /></el-icon>
              <span>讨论参考文档</span>
            </el-menu-item>
            <el-menu-item :index="`/projects/${currentProject.id}/agent`" class="menu-agent">
              <el-icon><ChatDotRound /></el-icon>
              <span>创作引擎</span>
            </el-menu-item>
          </template>
          <el-menu-item index="/interactions">
            <el-icon><DataAnalysis /></el-icon>
            <span>交互记录</span>
          </el-menu-item>
        </el-menu-item-group>

      <!-- 资产模块 -->
      <el-menu-item-group title="资产">
          <el-menu-item index="/assets/templates">
            <el-icon><Files /></el-icon>
            <span>设定模板资产</span>
          </el-menu-item>
          <el-menu-item index="disabled-character-card" disabled>
            <el-icon><User /></el-icon>
            <span>标准人设卡片</span>
          </el-menu-item>
          <el-menu-item index="disabled-worldview" disabled>
            <el-icon><MapLocation /></el-icon>
            <span>标准世界观</span>
          </el-menu-item>
          <el-menu-item index="disabled-style" disabled>
            <el-icon><Edit /></el-icon>
            <span>文风</span>
          </el-menu-item>
          <el-menu-item index="disabled-deai" disabled>
            <el-icon><MagicStick /></el-icon>
            <span>去AI味规则</span>
          </el-menu-item>
        </el-menu-item-group>

        <!-- 系统模块 -->
        <el-menu-item-group title="系统">
          <el-menu-item index="/config/models">
            <el-icon><Cpu /></el-icon>
            <span>模型管理</span>
          </el-menu-item>
          <el-menu-item index="/config/nodes">
            <el-icon><Connection /></el-icon>
            <span>节点配置</span>
          </el-menu-item>
          <el-menu-item index="/config/prompts">
            <el-icon><Document /></el-icon>
            <span>提示词管理</span>
          </el-menu-item>
        </el-menu-item-group>
      </el-menu>
      <div class="sidebar-footer">
        <span class="version">v0.3 · 前端重构</span>
      </div>
    </el-aside>

    <el-container class="main-container">
      <el-header class="app-header">
        <div class="header-content">
          <div class="header-title-area">
            <div class="header-subtitle">NOVEL WORKSTATION</div>
            <h1 v-if="currentProject.id" class="header-main-title">
              {{ currentProject.name || '未命名作品' }}
            </h1>
            <div v-if="currentStateLabel" class="header-node-badge">
              <span class="node-dot"></span>
              <span class="node-label">当前节点：</span>
              <span class="node-value">{{ currentStateLabel }}</span>
            </div>
          </div>
          <div class="header-actions">
            <el-button
              class="sidebar-toggle-btn"
              text
              :title="sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'"
              @click="toggleSidebar"
            >
              <el-icon :size="18"><Expand v-if="sidebarCollapsed" /><Fold v-else /></el-icon>
            </el-button>
            <div v-if="currentProject.id" class="project-switcher" @click="showProjectSwitcher = true">
              <el-icon :size="14"><Folder /></el-icon>
              <span class="project-name">{{ currentProject.name || '未命名作品' }}</span>
              <el-icon :size="12"><ArrowDown /></el-icon>
            </div>
          </div>
        </div>
      </el-header>
      <el-main class="app-main">
        <router-view />
      </el-main>
    </el-container>

    <!-- 作品切换对话框 -->
    <el-dialog v-model="showProjectSwitcher" title="切换作品" width="400px" :close-on-click-modal="true">
      <div class="project-list">
        <div
          v-for="p in allProjects"
          :key="p.id"
          class="project-item"
          :class="{ active: p.id === currentProject.id }"
          @click="switchProject(p)"
        >
          <el-icon :size="16"><Folder /></el-icon>
          <span class="project-item-name">{{ p.name }}</span>
          <el-icon v-if="p.id === currentProject.id" class="check-icon" :size="14"><Check /></el-icon>
        </div>
        <div v-if="allProjects.length === 0" class="empty-projects">
          <el-empty description="暂无作品" :image-size="60" />
        </div>
      </div>
    </el-dialog>
  </el-container>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { clearCurrentProject, setCurrentProject, useCurrentProject } from '@/stores/currentProject'
import { getProjectStates, getProjects, type Project } from '@/api'

const route = useRoute()
const router = useRouter()
const currentProject = useCurrentProject()
const currentStateLabel = ref('')
const showProjectSwitcher = ref(false)
const allProjects = ref<Project[]>([])

// 加载作品列表
async function loadProjects() {
  try {
    const res = await getProjects()
    allProjects.value = res.data
  } catch {
    allProjects.value = []
  }
}

// 切换作品
function switchProject(p: Project) {
  setCurrentProject(p.id, p.name)
  showProjectSwitcher.value = false
  // 跳转到当前页面的新作品路径
  const routeName = route.name as string
  if (routeName && route.meta.projectScoped) {
    router.push({ name: routeName, params: { id: p.id }, query: { name: p.name } })
  } else {
    router.push({ path: `/projects/${p.id}/workbench`, query: { name: p.name } })
  }
}

watch(
  () => route.params.id,
  (id) => {
    if (id) {
      setCurrentProject(id as string, (route.query.name as string) || currentProject.name)
      refreshStateLabel(id as string)
    }
  },
  { immediate: true }
)

// 打开对话框时加载作品列表
watch(showProjectSwitcher, (val) => {
  if (val) loadProjects()
})

async function refreshStateLabel(id: string): Promise<boolean> {
  try {
    const res = await getProjectStates(id)
    currentStateLabel.value = res.data.current_label || ''
    return true
  } catch (err: any) {
    currentStateLabel.value = ''
    return err?.response?.status !== 404
  }
}

const activeMenu = computed(() => {
  if (route.meta.projectScoped && route.params.id) {
    const base = `/projects/${route.params.id}`
    switch (route.name) {
      case 'workbench': return `${base}/workbench`
      case 'agent': return `${base}/agent`
      case 'static-settings': return `${base}/static-settings`
      case 'dynamic-settings': return `${base}/dynamic-settings`
      case 'reading': return `${base}/reading`
      case 'discussion': return `${base}/discussion`
      case 'plans': return `${base}/plans`
    }
  }
  return route.path
})

/** 窄屏断点（px）：低于此宽度自动收起侧边栏。 */
const SIDEBAR_BREAKPOINT = 1100
const SIDEBAR_STORAGE_KEY = 'anw:sidebar-collapsed'

/** 侧边栏是否收起（localStorage 记忆；窄屏自动收起）。 */
const sidebarCollapsed = ref(false)

const sidebarWidth = computed(() => (sidebarCollapsed.value ? '64px' : '220px'))

function toggleSidebar(): void {
  sidebarCollapsed.value = !sidebarCollapsed.value
  localStorage.setItem(SIDEBAR_STORAGE_KEY, String(sidebarCollapsed.value))
}

function applyResponsiveSidebar(): void {
  if (window.innerWidth < SIDEBAR_BREAKPOINT) {
    if (!sidebarCollapsed.value) {
      sidebarCollapsed.value = true
      localStorage.setItem(SIDEBAR_STORAGE_KEY, 'true')
    }
  }
}

onMounted(async () => {
  sidebarCollapsed.value = localStorage.getItem(SIDEBAR_STORAGE_KEY) === 'true' || window.innerWidth < SIDEBAR_BREAKPOINT
  window.addEventListener('resize', applyResponsiveSidebar)
  if (!currentProject.id) return
  const ok = await refreshStateLabel(currentProject.id)
  if (!ok) {
    const staleName = currentProject.name || currentProject.id
    clearCurrentProject()
    ElMessage.warning(`项目「${staleName}」已不存在，已从侧边栏移除，请回到作品库重新选择`)
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', applyResponsiveSidebar)
})
</script>

<style>
.app-container {
  height: 100vh;
}

.app-aside {
  background: linear-gradient(180deg, var(--sidebar-bg-start) 0%, var(--sidebar-bg-end) 100%);
  border-right: 1px solid var(--border);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-shadow: 1px 0 8px rgba(0, 0, 0, 0.03);
}

.app-aside.collapsed .logo {
  padding: 0;
  justify-content: center;
  gap: 0;
}

.app-aside.collapsed .logo-text-group,
.app-aside.collapsed .app-menu .el-menu-item > span,
.app-aside.collapsed .app-menu .el-menu-item-group__title,
.app-aside.collapsed .sidebar-footer .version,
.app-aside.collapsed .app-menu .el-menu-item .el-menu-tooltip__trigger > span {
  display: none;
}

.app-aside.collapsed .app-menu {
  padding: 12px 8px;
}

.app-aside.collapsed .app-menu .el-menu-item {
  justify-content: center;
  padding: 0 !important;
}

.app-aside.collapsed .sidebar-footer {
  padding: 14px 0;
  text-align: center;
}

.logo {
  height: 64px;
  display: flex;
  align-items: center;
  padding: 0 20px;
  gap: 12px;
  color: var(--text-title);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.logo-icon {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  background: var(--gradient-accent);
  box-shadow: 0 4px 12px rgba(79, 70, 229, 0.25);
  color: #fff;
  flex-shrink: 0;
}

.logo-text-group {
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow: hidden;
}

.logo-title {
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.3px;
  color: var(--text-title);
  white-space: nowrap;
}

.logo-subtitle {
  font-size: 11px;
  color: var(--text-aux);
  letter-spacing: 0.3px;
  white-space: nowrap;
}

.app-menu {
  border-right: none;
  padding: 12px 10px;
  flex: 1;
  background: transparent !important;
  overflow-y: auto;
}

.app-menu .el-menu-item-group__title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
  padding: 8px 12px 4px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.app-menu .el-menu-item,
.app-menu .el-sub-menu__title {
  height: 44px;
  line-height: 44px;
  border-radius: 8px;
  margin-bottom: 4px;
  color: var(--sidebar-text) !important;
}

.app-menu .el-menu-item.menu-agent .el-icon {
  color: var(--accent);
}

.app-menu .el-menu-item:hover,
.app-menu .el-sub-menu__title:hover {
  background-color: var(--surface-hover) !important;
  color: var(--text-title) !important;
  transform: translateX(2px);
}

.app-menu .el-menu-item.is-active {
  background: var(--accent-soft) !important;
  color: var(--accent-hover) !important;
  font-weight: 600;
}

.sidebar-footer {
  padding: 14px 20px;
  border-top: 1px solid var(--border-color-light);
  flex-shrink: 0;
}

.version {
  font-size: 11px;
  color: var(--text-muted);
  letter-spacing: 0.3px;
}

.main-container {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
}

.app-header {
  min-height: 80px;
  display: flex;
  align-items: stretch;
  padding: 14px 28px;
  background: #FFFFFF;
  border-bottom: 1px solid #E2E8F0;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
  flex-shrink: 0;
  z-index: 10;
}

.header-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  gap: 24px;
}

.header-title-area {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.header-subtitle {
  font-size: 10px;
  font-weight: 500;
  color: #A1A1AA;
  letter-spacing: 2px;
  text-transform: uppercase;
  line-height: 1;
}

.header-main-title {
  font-size: 22px;
  font-weight: 700;
  color: #18181B;
  margin: 0;
  line-height: 1.3;
  letter-spacing: -0.3px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 400px;
}

.header-node-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 2px;
}

.node-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #4F46E5;
  flex-shrink: 0;
  animation: node-pulse 2.5s ease-in-out infinite;
}

@keyframes node-pulse {
  0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(79, 70, 229, 0.3); }
  50% { opacity: 0.7; box-shadow: 0 0 0 4px rgba(79, 70, 229, 0); }
}

.node-label {
  font-size: 12px;
  font-weight: 400;
  color: #71717A;
}

.node-value {
  font-size: 12px;
  font-weight: 600;
  color: #4F46E5;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}

.header-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  gap: 24px;
}

.header-title-area {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.header-subtitle {
  font-size: 10px;
  font-weight: 500;
  color: #A1A1AA;
  letter-spacing: 2px;
  text-transform: uppercase;
  line-height: 1;
}

.header-main-title {
  font-size: 22px;
  font-weight: 700;
  color: #18181B;
  margin: 0;
  line-height: 1.3;
  letter-spacing: -0.3px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 400px;
}

.header-node-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 2px;
}

.node-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #4F46E5;
  flex-shrink: 0;
  animation: node-pulse 2.5s ease-in-out infinite;
}

@keyframes node-pulse {
  0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(79, 70, 229, 0.3); }
  50% { opacity: 0.7; box-shadow: 0 0 0 4px rgba(79, 70, 229, 0); }
}

.node-label {
  font-size: 12px;
  font-weight: 400;
  color: #71717A;
}

.node-value {
  font-size: 12px;
  font-weight: 600;
  color: #4F46E5;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}

.app-main {
  padding: 24px;
  background-color: var(--bg);
  overflow-y: auto;
  flex: 1;
}

/* 作品切换器 */
.project-switcher {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  background: #F8FAFC;
  border: 1px solid #E2E8F0;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.project-switcher:hover {
  background: #EEF2FF;
  border-color: #C7D2FE;
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(79, 70, 229, 0.1);
}

.project-name {
  font-size: 13px;
  font-weight: 500;
  color: #18181B;
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 作品列表 */
.project-list {
  max-height: 400px;
  overflow-y: auto;
}

.project-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
  margin-bottom: 4px;
}

.project-item:hover {
  background: var(--surface-hover);
}

.project-item.active {
  background: var(--accent-soft);
  color: var(--accent);
}

.project-item-name {
  flex: 1;
  font-size: 14px;
}

.check-icon {
  color: var(--accent);
}

.empty-projects {
  padding: 20px 0;
}
</style>










