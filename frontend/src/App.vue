<template>
  <el-container class="app-container">
    <el-aside :width="sidebarWidth" class="app-aside">
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
        text-color="rgba(255, 255, 255, 0.75)"
        active-text-color="#ffffff"
        router
      >
        <el-menu-item index="/projects">
          <el-icon><HomeFilled /></el-icon>
          <span>作品库</span>
        </el-menu-item>

        <el-sub-menu v-if="currentProject.id" index="project">
          <template #title>
            <el-icon><Reading /></el-icon>
            <span>{{ currentProject.name || '当前项目' }}</span>
          </template>
          <el-menu-item :index="`/projects/${currentProject.id}/workbench`">
            <el-icon><Odometer /></el-icon>
            <span>工作台</span>
          </el-menu-item>
          <el-menu-item :index="`/projects/${currentProject.id}/agent`" class="menu-agent">
            <el-icon><ChatDotRound /></el-icon>
            <span>Agent 窗口</span>
          </el-menu-item>
          <el-menu-item :index="`/projects/${currentProject.id}/worldview`">
            <el-icon><Compass /></el-icon>
            <span>世界观</span>
          </el-menu-item>
          <el-menu-item :index="`/projects/${currentProject.id}/characters`">
            <el-icon><User /></el-icon>
            <span>人物</span>
          </el-menu-item>
          <el-menu-item :index="`/projects/${currentProject.id}/outline`">
            <el-icon><Collection /></el-icon>
            <span>章纲</span>
          </el-menu-item>
          <el-menu-item :index="`/projects/${currentProject.id}/writing`">
            <el-icon><EditPen /></el-icon>
            <span>正文</span>
          </el-menu-item>
          <el-menu-item :index="`/projects/${currentProject.id}/review`">
            <el-icon><Finished /></el-icon>
            <span>审阅</span>
          </el-menu-item>
          <el-menu-item :index="`/projects/${currentProject.id}/foreshadow`">
            <el-icon><Link /></el-icon>
            <span>伏笔管理</span>
          </el-menu-item>
        </el-sub-menu>

        <el-menu-item index="/config">
          <el-icon><Setting /></el-icon>
          <span>用户设置</span>
        </el-menu-item>
        <el-menu-item index="/interactions">
          <el-icon><DataAnalysis /></el-icon>
          <span>交互记录</span>
        </el-menu-item>
      </el-menu>
      <div class="sidebar-footer">
        <span class="version">v0.2 · Agent 中心化重构</span>
      </div>
    </el-aside>

    <el-container class="main-container">
      <el-header class="app-header">
        <div class="header-left">
          <el-icon class="header-icon" :size="18"><Menu /></el-icon>
          <span class="header-title">{{ pageTitle }}</span>
        </div>
        <div class="header-right">
          <el-tag v-if="currentStateLabel" size="small" effect="light" round>
            当前状态：{{ currentStateLabel }}
          </el-tag>
        </div>
      </el-header>
      <el-main class="app-main">
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { clearCurrentProject, setCurrentProject, useCurrentProject } from '@/stores/currentProject'
import { getProjectStates } from '@/api'

const route = useRoute()
const currentProject = useCurrentProject()
const currentStateLabel = ref('')

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

async function refreshStateLabel(id: string): Promise<boolean> {
  try {
    const res = await getProjectStates(id)
    currentStateLabel.value = res.data.current_label || ''
    return true
  } catch (err: any) {
    currentStateLabel.value = ''
    // 仅 404 表示项目已不存在；网络等异常不视为失效
    return err?.response?.status !== 404
  }
}

const activeMenu = computed(() => {
  if (route.meta.projectScoped && route.params.id) {
    const base = `/projects/${route.params.id}`
    switch (route.name) {
      case 'workbench': return `${base}/workbench`
      case 'agent': return `${base}/agent`
      case 'worldview': return `${base}/worldview`
      case 'characters': return `${base}/characters`
      case 'outline': return `${base}/outline`
      case 'writing': return `${base}/writing`
      case 'review': return `${base}/review`
      case 'foreshadow': return `${base}/foreshadow`
    }
  }
  return route.path
})

const pageTitle = computed(() => (route.meta.title as string) || '')

const sidebarWidth = '220px'

onMounted(async () => {
  if (!currentProject.id) return
  const ok = await refreshStateLabel(currentProject.id)
  if (!ok) {
    const staleName = currentProject.name || currentProject.id
    clearCurrentProject()
    ElMessage.warning(`项目「${staleName}」已不存在，已从侧边栏移除，请回到作品库重新选择`)
  }
})
</script>

<style>
.app-container {
  height: 100vh;
}

.app-aside {
  background: linear-gradient(180deg, var(--sidebar-bg-start) 0%, var(--sidebar-bg-end) 100%);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  border-right: 1px solid rgba(255, 255, 255, 0.06);
  box-shadow: 2px 0 12px rgba(0, 0, 0, 0.15);
}

.logo {
  height: 72px;
  display: flex;
  align-items: center;
  padding: 0 20px;
  gap: 12px;
  color: #ffffff;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  flex-shrink: 0;
}

.logo-icon {
  width: 38px;
  height: 38px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  background: linear-gradient(135deg, #4f8cff 0%, #6f5cff 100%);
  box-shadow: 0 4px 12px rgba(79, 140, 255, 0.4);
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
  font-weight: 600;
  letter-spacing: 0.3px;
  color: #ffffff;
  white-space: nowrap;
}

.logo-subtitle {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.45);
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

.app-menu .el-menu-item,
.app-menu .el-sub-menu__title {
  height: 44px;
  line-height: 44px;
  border-radius: 8px;
  margin-bottom: 4px;
  color: rgba(255, 255, 255, 0.75) !important;
}

.app-menu .el-menu-item.menu-agent .el-icon {
  color: #6f5cff;
}

.app-menu .el-menu-item:hover,
.app-menu .el-sub-menu__title:hover {
  background-color: rgba(255, 255, 255, 0.08) !important;
  color: #ffffff !important;
  transform: translateX(2px);
}

.app-menu .el-menu-item.is-active {
  background: linear-gradient(90deg, rgba(79, 140, 255, 0.25) 0%, rgba(79, 140, 255, 0.08) 100%) !important;
  color: #ffffff !important;
}

.app-menu .el-sub-menu .el-menu-item {
  padding-left: 42px !important;
}

.sidebar-footer {
  padding: 14px 20px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  flex-shrink: 0;
}

.version {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.35);
  letter-spacing: 0.3px;
}

.main-container {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
}

.app-header {
  height: 56px !important;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  background: #ffffff;
  border-bottom: 1px solid var(--border-color-light);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
  flex-shrink: 0;
  z-index: 10;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.header-icon {
  color: var(--text-secondary);
}

.header-right .header-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.app-main {
  padding: 20px;
  background-color: var(--content-bg);
  overflow-y: auto;
  flex: 1;
}
</style>
