import { createRouter, createWebHistory } from 'vue-router'
import ProjectsView from '@/views/ProjectsView.vue'
import WorkbenchView from '@/views/WorkbenchView.vue'
import AgentWindow from '@/views/AgentWindow.vue'
import StaticSettingsView from '@/views/StaticSettingsView.vue'
import DynamicSettingsView from '@/views/DynamicSettingsView.vue'
import ReadingView from '@/views/ReadingView.vue'
import ModelsConfigView from '@/views/ModelsConfigView.vue'
import NodesConfigView from '@/views/NodesConfigView.vue'
import PromptsConfigView from '@/views/PromptsConfigView.vue'
import InteractionsView from '@/views/InteractionsView.vue'
import TemplatesAssetView from '@/views/TemplatesAssetView.vue'
import GroupChatView from '@/views/GroupChatView.vue'
import PlansView from '@/views/PlansView.vue'
import { ElMessage } from 'element-plus'
import { getProject } from '@/api'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/projects' },
    { path: '/projects', name: 'projects', component: ProjectsView, meta: { title: '作品库' } },
    
    // 创作模块
    { path: '/projects/:id/workbench', name: 'workbench', component: WorkbenchView, meta: { title: '工作台', projectScoped: true } },
    { path: '/projects/:id/agent', name: 'agent', component: AgentWindow, meta: { title: '创作引擎', projectScoped: true } },
    { path: '/projects/:id/static-settings', name: 'static-settings', component: StaticSettingsView, meta: { title: '静态设定', projectScoped: true } },
    { path: '/projects/:id/dynamic-settings', name: 'dynamic-settings', component: DynamicSettingsView, meta: { title: '动态设定', projectScoped: true } },
    { path: '/projects/:id/reading', name: 'reading', component: ReadingView, meta: { title: '正文', projectScoped: true } },
    { path: '/projects/:id/discussion', name: 'discussion', component: GroupChatView, meta: { title: '圆桌会议', projectScoped: true } },
    { path: '/projects/:id/plans', name: 'plans', component: PlansView, meta: { title: '讨论参考文档', projectScoped: true } },
    { path: '/interactions', name: 'interactions', component: InteractionsView, meta: { title: '交互记录' } },
    
    // 资产模块
    { path: '/assets/templates', name: 'templates', component: TemplatesAssetView, meta: { title: '设定模板资产' } },

    // 系统模块
    { path: '/config/models', name: 'models-config', component: ModelsConfigView, meta: { title: '模型管理' } },
    { path: '/config/nodes', name: 'nodes-config', component: NodesConfigView, meta: { title: '节点配置' } },
    { path: '/config/prompts', name: 'prompts-config', component: PromptsConfigView, meta: { title: '提示词管理' } },
  ],
})

// 项目页面守卫：若项目已从磁盘删除（残留 URL/标签页），自动跳回作品库，
// 避免创作引擎等页面反复请求不存在的项目而产生 404。
router.beforeEach(async (to) => {
  if (to.meta.projectScoped && to.params.id) {
    const id = to.params.id as string
    try {
      await getProject(id)
    } catch (err: any) {
      if (err?.response?.status === 404) {
        ElMessage.warning(`项目「${id}」已不存在，已为你跳转到作品库`)
        return { path: '/projects' }
      }
    }
  }
  return true
})

export default router

