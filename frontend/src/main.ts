import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'
import App from './App.vue'
import router from './router'
import './styles/global.css'

// 创建 Vue 应用实例
const app = createApp(App)

// 全局注册 ElementPlus 图标组件
for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
  app.component(key, component)
}

// 注册 ElementPlus 与路由
app.use(ElementPlus)
app.use(router)

app.mount('#app')
