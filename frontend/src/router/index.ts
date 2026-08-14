import { createRouter, createWebHistory } from 'vue-router'
import ProjectsView from '@/views/ProjectsView.vue'
import IdeationView from '@/views/IdeationView.vue'
import SettingsView from '@/views/SettingsView.vue'
import WritingView from '@/views/WritingView.vue'
import ReadingView from '@/views/ReadingView.vue'
import ReviewView from '@/views/ReviewView.vue'
import ConfigView from '@/views/ConfigView.vue'
import ChatView from '@/views/ChatView.vue'
import InteractionsView from '@/views/InteractionsView.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/projects' },
    {
      path: '/projects',
      name: 'projects',
      component: ProjectsView,
      meta: { title: '工作台' },
    },
    {
      path: '/projects/:id/ideation',
      name: 'ideation',
      component: IdeationView,
      meta: { title: '创意共创', projectScoped: true },
    },
    {
      path: '/projects/:id/settings',
      name: 'settings',
      component: SettingsView,
      meta: { title: '设定中心', projectScoped: true },
    },
    {
      path: '/projects/:id/writing',
      name: 'writing',
      component: WritingView,
      meta: { title: '正文生成', projectScoped: true },
    },
    {
      path: '/projects/:id/reading/:chapterNo?',
      name: 'reading',
      component: ReadingView,
      meta: { title: '阅读', projectScoped: true },
    },
    {
      path: '/projects/:id/review',
      name: 'review',
      component: ReviewView,
      meta: { title: '审阅与去AI味', projectScoped: true },
    },
    {
      path: '/config',
      name: 'config',
      component: ConfigView,
      meta: { title: '设置' },
    },
    {
      path: '/chat',
      name: 'chat',
      component: ChatView,
      meta: { title: '聊天调试', hidden: true },
    },
    {
      path: '/interactions',
      name: 'interactions',
      component: InteractionsView,
      meta: { title: '交互记录' },
    },
  ],
})

export default router
