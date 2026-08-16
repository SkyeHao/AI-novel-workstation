import { createRouter, createWebHistory } from 'vue-router'
import ProjectsView from '@/views/ProjectsView.vue'
import WorkbenchView from '@/views/WorkbenchView.vue'
import AgentWindow from '@/views/AgentWindow.vue'
import WorldviewView from '@/views/WorldviewView.vue'
import CharactersView from '@/views/CharactersView.vue'
import OutlineView from '@/views/OutlineView.vue'
import WritingView from '@/views/WritingView.vue'
import ReviewView from '@/views/ReviewView.vue'
import ForeshadowView from '@/views/ForeshadowView.vue'
import ConfigView from '@/views/ConfigView.vue'
import InteractionsView from '@/views/InteractionsView.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/projects' },
    { path: '/projects', name: 'projects', component: ProjectsView, meta: { title: '作品库' } },
    { path: '/projects/:id/workbench', name: 'workbench', component: WorkbenchView, meta: { title: '工作台', projectScoped: true } },
    { path: '/projects/:id/agent', name: 'agent', component: AgentWindow, meta: { title: 'Agent', projectScoped: true } },
    { path: '/projects/:id/worldview', name: 'worldview', component: WorldviewView, meta: { title: '世界观', projectScoped: true } },
    { path: '/projects/:id/characters', name: 'characters', component: CharactersView, meta: { title: '人物', projectScoped: true } },
    { path: '/projects/:id/outline', name: 'outline', component: OutlineView, meta: { title: '章纲', projectScoped: true } },
    { path: '/projects/:id/writing', name: 'writing', component: WritingView, meta: { title: '正文', projectScoped: true } },
    { path: '/projects/:id/review', name: 'review', component: ReviewView, meta: { title: '审阅', projectScoped: true } },
    { path: '/projects/:id/foreshadow', name: 'foreshadow', component: ForeshadowView, meta: { title: '伏笔管理', projectScoped: true } },
    { path: '/config', name: 'config', component: ConfigView, meta: { title: '用户设置' } },
    { path: '/interactions', name: 'interactions', component: InteractionsView, meta: { title: '交互记录' } },
  ],
})

export default router
