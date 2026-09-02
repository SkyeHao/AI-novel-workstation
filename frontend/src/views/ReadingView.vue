<template>
  <div class="reading-view">
    <PageHeader title="正文阅读" subtitle="章节内容与章尾钩子" icon="Reading">
      <template #actions>
        <el-tag size="small" type="info" effect="plain" round>{{ chapters.length }} 章</el-tag>
        <el-tag v-if="selectedChapter" size="small" type="primary" effect="plain" round>
          第 {{ selectedChapter.no }} 章 · {{ selectedChapter.words }} 字
        </el-tag>
      </template>
    </PageHeader>

    <div class="reading-layout">
      <!-- 章节列表 -->
      <div class="chapter-list panel">
        <div class="chapter-list-head">
          <div class="panel-title-group">
            <el-icon class="panel-title-icon"><Tickets /></el-icon>
            <span class="panel-title">章节列表</span>
          </div>
          <el-select
            v-model="statusFilter"
            size="small"
            style="width: 110px"
            @change="applyFilter"
          >
            <el-option label="全部" value="" />
            <el-option label="未生成" value="PENDING" />
            <el-option label="已生成" value="GENERATED" />
            <el-option label="已审阅" value="REVIEWED" />
          </el-select>
        </div>
        <div v-if="filteredChapters.length === 0" class="chapter-empty">
          <el-icon :size="22"><DocumentRemove /></el-icon>
          <span>暂无章节</span>
        </div>
        <div class="chapter-items">
          <div
            v-for="chapter in filteredChapters"
            :key="chapter.no"
            class="chapter-item"
            :class="{ active: selectedChapter?.no === chapter.no }"
            @click="selectChapter(chapter)"
          >
            <div class="chapter-item-top">
              <span class="chapter-no mono">{{ String(chapter.no).padStart(2, '0') }}</span>
              <span class="chapter-title" :title="chapter.title">{{ chapter.title }}</span>
            </div>
            <div class="chapter-item-meta">
              <el-tag size="small" effect="light" round :type="getStatusType(chapter.status)">{{ statusText(chapter.status) }}</el-tag>
              <span class="chapter-words">{{ chapter.words }} 字</span>
              <span class="chapter-date">{{ shortDate(chapter.updated_at) }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 阅读区 -->
      <div class="reading-content panel">
        <div v-if="!selectedChapter" class="reading-placeholder">
          <el-icon :size="40"><Reading /></el-icon>
          <p>从左侧选择章节开始阅读</p>
        </div>
        <div v-else class="content-wrapper">
          <div class="chapter-header">
            <div class="chapter-head-left">
              <h3>{{ selectedChapter.title }}</h3>
              <div class="chapter-head-meta">
                <el-tag size="small" effect="light" round :type="getStatusType(selectedChapter.status)">{{ statusText(selectedChapter.status) }}</el-tag>
                <span>{{ selectedChapter.words }} 字</span>
                <span class="mono">第 {{ selectedChapter.no }} 章</span>
              </div>
            </div>
            <div class="chapter-head-nav">
              <el-button size="small" :disabled="!prevChapter" @click="selectChapter(prevChapter)">
                <el-icon><ArrowLeft /></el-icon>上一章
              </el-button>
              <el-button size="small" :disabled="!nextChapter" @click="selectChapter(nextChapter)">
                下一章<el-icon><ArrowRight /></el-icon>
              </el-button>
            </div>
          </div>
          <div class="chapter-body">
            <div v-if="loading" class="chapter-state">
              <el-icon class="is-loading"><Loading /></el-icon>
              <span>加载中...</span>
            </div>
            <div v-else-if="chapterContent" class="content-text" v-html="renderedContent"></div>
            <div v-else class="chapter-state">
              <el-icon :size="22"><DocumentRemove /></el-icon>
              <span>暂无内容</span>
            </div>
          </div>
          <div v-if="selectedChapter.hook" class="chapter-hook">
            <div class="hook-header">
              <el-icon><MagicStick /></el-icon>
              <span>章尾钩子</span>
            </div>
            <div class="hook-content">{{ selectedChapter.hook }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { getChapters, getChapter } from '@/api'
import { marked } from 'marked'
import PageHeader from '@/components/PageHeader.vue'

const route = useRoute()
const projectId = route.params.id as string

const chapters = ref<any[]>([])
const selectedChapter = ref<any>(null)
const chapterContent = ref('')
const loading = ref(false)
const statusFilter = ref('')

const filteredChapters = computed(() => {
  if (!statusFilter.value) return chapters.value
  return chapters.value.filter((c) => c.status === statusFilter.value)
})

const prevChapter = computed(() => {
  if (!selectedChapter.value) return null
  const idx = chapters.value.findIndex((c) => c.no === selectedChapter.value.no)
  return idx > 0 ? chapters.value[idx - 1] : null
})

const nextChapter = computed(() => {
  if (!selectedChapter.value) return null
  const idx = chapters.value.findIndex((c) => c.no === selectedChapter.value.no)
  return idx >= 0 && idx < chapters.value.length - 1 ? chapters.value[idx + 1] : null
})

const renderedContent = computed(() => {
  if (!chapterContent.value) return ''
  return marked(chapterContent.value)
})

function getStatusType(status: string): string {
  const map: Record<string, string> = {
    PENDING: 'info',
    GENERATED: 'warning',
    REVIEWED: 'success',
    FINALIZED: 'success',
  }
  return map[status] || 'info'
}

function statusText(status: string): string {
  const map: Record<string, string> = {
    PENDING: '未生成',
    GENERATED: '已生成',
    REVIEWED: '已审阅',
    FINALIZED: '已定稿',
  }
  return map[status] || status
}

function shortDate(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
}

async function loadChapters() {
  try {
    const res = await getChapters(projectId)
    chapters.value = res.data.chapters
    if (chapters.value.length > 0) {
      selectChapter(chapters.value[0])
    }
  } catch (err) {
    console.error('Failed to load chapters:', err)
  }
}

function applyFilter() {
  const list = filteredChapters.value
  if (list.length > 0) {
    selectChapter(list[0])
  } else {
    selectedChapter.value = null
    chapterContent.value = ''
  }
}

async function selectChapter(chapter: any) {
  if (!chapter) return
  selectedChapter.value = chapter
  loading.value = true
  try {
    const res = await getChapter(projectId, chapter.no)
    chapterContent.value = res.data.content
  } catch (err) {
    console.error('Failed to load chapter content:', err)
    chapterContent.value = ''
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  loadChapters()
})
</script>

<style scoped>
.reading-view {
  max-width: 1400px;
  margin: 0 auto;
}

.reading-layout {
  display: grid;
  grid-template-columns: 320px 1fr;
  gap: 16px;
  height: calc(100vh - 140px);
}

/* 章节列表 */
.chapter-list {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  margin-bottom: 0;
}
.chapter-list-head {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 12px 14px; border-bottom: 1px solid var(--border-color-light);
  background: #fafafa;
}
.chapter-empty {
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  padding: 48px 20px; color: var(--text-placeholder); font-size: 13px;
}
.chapter-items { flex: 1; overflow-y: auto; }
.chapter-item {
  padding: 10px 14px; border-bottom: 1px solid var(--border-color-lighter);
  cursor: pointer; transition: background .15s, border-left .15s;
  border-left: 3px solid transparent;
}
.chapter-item:hover { background: var(--el-fill-color-light); }
.chapter-item.active {
  background: #eef2ff;
  border-left-color: #6366f1;
}
.chapter-item-top { display: flex; align-items: center; gap: 8px; }
.chapter-no { font-size: 12px; color: var(--text-secondary); flex-shrink: 0; }
.chapter-title {
  font-weight: 600; font-size: 13px; color: var(--text-primary);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.chapter-item.active .chapter-title { color: #2f6fe0; }
.chapter-item-meta {
  display: flex; align-items: center; gap: 8px; margin-top: 6px;
  font-size: 12px; color: var(--text-secondary);
}
.chapter-words { font-size: 12px; }
.chapter-date { margin-left: auto; font-size: 11px; color: var(--text-placeholder); }

/* 阅读区 */
.reading-content {
  display: flex; flex-direction: column; overflow: hidden; margin-bottom: 0;
}
.reading-placeholder {
  flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 12px; color: var(--text-placeholder);
}
.reading-placeholder p { margin: 0; font-size: 14px; }
.content-wrapper { display: flex; flex-direction: column; height: 100%; overflow: hidden; }
.chapter-header {
  display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;
  padding: 16px 24px; border-bottom: 1px solid var(--border-color-light);
  background: #fafafa;
}
.chapter-head-left { min-width: 0; }
.chapter-header h3 { margin: 0 0 8px; font-size: 20px; font-weight: 700; color: var(--text-primary); }
.chapter-head-meta { display: flex; align-items: center; gap: 12px; font-size: 13px; color: var(--text-secondary); }
.chapter-head-nav { display: flex; gap: 8px; flex-shrink: 0; }
.chapter-body { flex: 1; overflow-y: auto; padding: 28px 36px; background: #fff; }
.chapter-state {
  display: flex; align-items: center; justify-content: center; gap: 8px;
  height: 240px; color: var(--text-secondary);
}
.content-text {
  line-height: 2; font-size: 16.5px; color: var(--text-primary);
  max-width: 860px; margin: 0 auto;
}
.content-text :deep(p) { margin-bottom: 18px; text-indent: 2em; }
.content-text :deep(h1), .content-text :deep(h2), .content-text :deep(h3) { text-indent: 0; margin: 20px 0 12px; }
.content-text :deep(pre) {
  background: #f6f8fa; border: 1px solid var(--border-color-light); border-radius: 8px; padding: 14px; overflow-x: auto;
}
.chapter-hook {
  padding: 14px 24px; border-top: 1px solid var(--border-color-light);
  background: #fffbf0;
}
.hook-header {
  display: flex; align-items: center; gap: 8px; margin-bottom: 6px;
  font-weight: 700; font-size: 13px; color: #d48806;
}
.hook-content { font-size: 14px; line-height: 1.7; color: var(--text-primary); }
</style>