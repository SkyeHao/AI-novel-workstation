<template>
  <div class="plans-view">
    <PageHeader title="讨论参考文档" subtitle="圆桌会议最终方案保存为固定格式的 Markdown 参考文档，可在此统一查阅" icon="Document">
      <template #actions>
        <el-tag size="small" type="primary" effect="plain" round>{{ documents.length }} 份文档</el-tag>
        <el-button plain size="small" :loading="loading" @click="loadData">
          <el-icon style="margin-right: 4px"><Refresh /></el-icon>
          刷新
        </el-button>
      </template>
    </PageHeader>

    <div class="plans-layout">
      <div class="doc-list panel">
        <div class="panel-title-group">
          <el-icon class="panel-title-icon"><Tickets /></el-icon>
          <span class="panel-title">参考文档</span>
        </div>
        <div v-if="documents.length === 0 && !loading" class="doc-empty">
          <el-icon :size="22"><DocumentRemove /></el-icon>
          <span>暂无参考文档</span>
          <span class="doc-empty-hint">在圆桌会议完成后点击「保存为文档」即可生成</span>
        </div>
        <div class="doc-items">
          <div
            v-for="doc in documents"
            :key="doc.path"
            class="doc-item"
            :class="{ active: activeDoc?.path === doc.path }"
            @click="selectDoc(doc)"
          >
            <div class="doc-item-top">
              <el-icon class="doc-file-icon"><Document /></el-icon>
              <span class="doc-title" :title="doc.title || doc.name">{{ doc.title || doc.name }}</span>
            </div>
            <div class="doc-item-meta">
              <span>{{ formatSize(doc.size) }}</span>
              <span>{{ formatDate(doc.modified) }}</span>
            </div>
          </div>
        </div>
      </div>

      <div class="doc-content panel">
        <div v-if="!activeDoc" class="doc-placeholder">
          <el-icon :size="40"><Document /></el-icon>
          <p>从左侧选择参考文档查看内容</p>
        </div>
        <template v-else>
          <div class="doc-content-head">
            <span class="doc-content-title">{{ activeDoc.title || activeDoc.name }}</span>
            <el-tag size="small" type="info" effect="plain">{{ activeDoc.path }}</el-tag>
          </div>
          <div class="doc-content-body">
            <MarkdownView :content="docContent" :loading="contentLoading" />
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { getProjectDocumentsByKind, readProjectDocument, type ProjectDocument } from '@/api'
import PageHeader from '@/components/PageHeader.vue'
import MarkdownView from '@/components/MarkdownView.vue'

const route = useRoute()
const projectId = route.params.id as string

const loading = ref(false)
const contentLoading = ref(false)
const documents = ref<ProjectDocument[]>([])
const activeDoc = ref<ProjectDocument | null>(null)
const docContent = ref('')

function formatSize(size: number): string {
  if (!size) return '0 B'
  if (size < 1024) return size + ' B'
  if (size < 1024 * 1024) return (size / 1024).toFixed(1) + ' KB'
  return (size / 1024 / 1024).toFixed(1) + ' MB'
}

function formatDate(ts: number): string {
  if (!ts) return ''
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function selectDoc(doc: ProjectDocument) {
  activeDoc.value = doc
  docContent.value = ''
  contentLoading.value = true
  try {
    const res = await readProjectDocument(projectId, doc.path)
    if (res.data.success) {
      docContent.value = res.data.content || ''
    } else {
      docContent.value = ''
      ElMessage.warning(res.data.error || '读取文档失败')
    }
  } catch (err: any) {
    console.error('读取参考文档失败:', err)
    ElMessage.error((err?.response?.data?.error as string) || '读取文档失败')
  } finally {
    contentLoading.value = false
  }
}

async function loadData() {
  loading.value = true
  try {
    const res = await getProjectDocumentsByKind(projectId, 'plan')
    documents.value = res.data.documents || []
    if (documents.value.length > 0) {
      const target = activeDoc.value
        ? documents.value.find((d) => d.path === activeDoc.value?.path) || documents.value[0]
        : documents.value[0]
      await selectDoc(target)
    } else {
      activeDoc.value = null
      docContent.value = ''
    }
  } catch (err: any) {
    console.error('加载参考文档列表失败:', err)
    ElMessage.error((err?.response?.data?.error as string) || '加载参考文档失败')
  } finally {
    loading.value = false
  }
}

onMounted(loadData)
</script>

<style scoped>
.plans-view {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.plans-layout {
  display: grid;
  grid-template-columns: 320px 1fr;
  gap: 16px;
  height: calc(100vh - 200px);
  min-height: 480px;
}

.panel {
  background: var(--surface);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 0;
}

.panel-title-group {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border-soft);
}

.panel-title-icon {
  color: var(--accent);
}

.panel-title {
  font-weight: 600;
  color: var(--text-title);
}

.doc-list {
  min-width: 0;
}

.doc-items {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.doc-item {
  padding: 10px 12px;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background var(--transition-fast), border-color var(--transition-fast);
}

.doc-item:hover {
  background: var(--surface-hover);
}

.doc-item.active {
  background: var(--accent-soft);
  border-color: var(--accent-border);
}

.doc-item-top {
  display: flex;
  align-items: center;
  gap: 8px;
}

.doc-file-icon {
  color: var(--accent);
  flex-shrink: 0;
}

.doc-title {
  font-weight: 600;
  font-size: 13px;
  color: var(--text-title);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  min-width: 0;
}

.doc-item-meta {
  display: flex;
  justify-content: space-between;
  margin-top: 4px;
  font-size: 11px;
  color: var(--text-aux);
}

.doc-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--text-aux);
  font-size: 13px;
}

.doc-empty-hint {
  font-size: 12px;
  color: var(--text-muted);
}

.doc-content {
  min-width: 0;
}

.doc-placeholder {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--text-aux);
}

.doc-content-head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border-soft);
}

.doc-content-title {
  font-weight: 600;
  font-size: 15px;
  color: var(--text-title);
  flex: 1;
  min-width: 0;
}

.doc-content-body {
  flex: 1;
  overflow-y: auto;
  padding: 20px 24px;
  background: var(--bg-soft);
}
</style>
