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
          <span>工作台</span>
        </el-menu-item>
        <el-sub-menu v-if="currentProject.id" index="project">
          <template #title>
            <el-icon><Reading /></el-icon>
            <span>{{ currentProject.name || '当前项目' }}</span>
          </template>
          <el-menu-item :index="`/projects/${currentProject.id}/ideation`">
            <el-icon><ChatDotRound /></el-icon>
            <span>创意共创</span>
          </el-menu-item>
          <el-menu-item :index="`/projects/${currentProject.id}/settings`">
            <el-icon><Collection /></el-icon>
            <span>设定中心</span>
          </el-menu-item>
          <el-menu-item :index="`/projects/${currentProject.id}/writing`">
            <el-icon><EditPen /></el-icon>
            <span>正文生成</span>
          </el-menu-item>
          <el-menu-item :index="`/projects/${currentProject.id}/reading`">
            <el-icon><Document /></el-icon>
            <span>阅读</span>
          </el-menu-item>
          <el-menu-item :index="`/projects/${currentProject.id}/review`">
            <el-icon><Finished /></el-icon>
            <span>审阅 / 去AI味</span>
          </el-menu-item>
        </el-sub-menu>
        <el-menu-item index="/interactions">
          <el-icon><Files /></el-icon>
          <span>交互记录</span>
        </el-menu-item>
        <el-menu-item index="/config">
          <el-icon><Setting /></el-icon>
          <span>设置</span>
        </el-menu-item>
      </el-menu>
      <div class="sidebar-footer">
        <span class="version">v0.1.0</span>
      </div>
    </el-aside>

    <el-container class="main-container">
      <el-header class="app-header">
        <div class="header-left">
          <el-icon class="header-icon" size="18"><Location /></el-icon>
          <el-breadcrumb separator="/">
            <el-breadcrumb-item :to="{ path: '/projects' }">工作台</el-breadcrumb-item>
            <el-breadcrumb-item v-if="projectName">{{ projectName }}</el-breadcrumb-item>
            <el-breadcrumb-item>{{ pageTitle }}</el-breadcrumb-item>
          </el-breadcrumb>
        </div>
        <div class="header-right">
          <span class="header-title">{{ pageTitle }}</span>
        </div>
      </el-header>
      <el-main class="app-main">
        <router-view v-slot="{ Component }">
          <keep-alive :include="['IdeationView']">
            <component :is="Component" />
          </keep-alive>
        </router-view>
      </el-main>
    </el-container>
  </el-container>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import { setCurrentProject, useCurrentProject } from '@/stores/currentProject'

const route = useRoute()
const currentProject = useCurrentProject()

// 进入项目路由时记录当前项目（侧边栏页签固定显示）
watch(
  () => route.params.id,
  (id) => {
    if (id) {
      setCurrentProject(id as string, (route.query.name as string) || currentProject.name)
    }
  },
  { immediate: true }
)

const activeMenu = computed(() => {
  // 项目级路由：高亮子菜单中的当前项
  if (route.meta.projectScoped && route.params.id) {
    const base = `/projects/${route.params.id}`
    if (route.name === 'ideation') return `${base}/ideation`
    if (route.name === 'settings') return `${base}/settings`
    if (route.name === 'writing') return `${base}/writing`
    if (route.name === 'reading') return `${base}/reading`
    if (route.name === 'review') return `${base}/review`
  }
  return route.path
})

const projectName = computed(() => (route.query.name as string) || '')

const pageTitle = computed(() => {
  const t = (route.meta.title as string) || ''
  if (route.name === 'reading' && route.params.chapterNo) {
    return `阅读 · 第 ${route.params.chapterNo} 章`
  }
  return t
})

const sidebarWidth = '220px'
</script>

<style>
.app-container {
  height: 100vh;
}

/* ====== 侧边栏 ====== */
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

/* ====== 菜单 ====== */
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

.app-menu .el-menu-item .el-icon,
.app-menu .el-sub-menu__title .el-icon {
  color: inherit;
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

/* ====== 主容器 ====== */
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
