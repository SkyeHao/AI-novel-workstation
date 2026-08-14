<template>
  <div class="markdown-view">
    <div v-if="content" class="markdown-body" v-html="renderMarkdown(content)"></div>
    <el-empty v-else-if="loading" description="加载中..." :image-size="60" />
    <el-empty v-else description="文档内容为空" :image-size="60" />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { marked } from 'marked'
import DOMPurify from 'dompurify'

const props = defineProps<{
  content: string
  loading?: boolean
}>()

/** 渲染 Markdown 为安全 HTML */
const renderMarkdown = (text: string): string => {
  if (!text) return ''
  try {
    const raw = marked.parse(text) as string
    return DOMPurify.sanitize(raw)
  } catch {
    return text
  }
}

const content = computed(() => props.content)
</script>

<style scoped>
.markdown-view {
  min-height: 200px;
}

.markdown-body {
  font-size: 14px;
  line-height: 1.8;
  color: var(--text-primary);
  word-break: break-word;
}

.markdown-body h1 {
  font-size: 22px;
  margin: 20px 0 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border-color-light);
}

.markdown-body h2 {
  font-size: 18px;
  margin: 18px 0 10px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--border-color-light);
}

.markdown-body h3 {
  font-size: 15px;
  margin: 14px 0 8px;
}

.markdown-body h4 {
  font-size: 14px;
  margin: 12px 0 6px;
}

.markdown-body p {
  margin: 8px 0;
}

.markdown-body ul,
.markdown-body ol {
  padding-left: 22px;
  margin: 8px 0;
}

.markdown-body li {
  margin: 3px 0;
}

.markdown-body blockquote {
  margin: 10px 0;
  padding: 8px 14px;
  border-left: 3px solid var(--app-primary);
  background: #f6f8fc;
  color: var(--text-regular);
  border-radius: 4px;
}

.markdown-body code {
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  font-size: 13px;
  background: #f0f2f5;
  padding: 2px 5px;
  border-radius: 4px;
}

.markdown-body pre {
  background: #1e1e1e;
  color: #d4d4d4;
  padding: 12px;
  border-radius: 8px;
  overflow-x: auto;
  font-size: 13px;
  line-height: 1.6;
}

.markdown-body pre code {
  background: transparent;
  color: inherit;
  padding: 0;
}

.markdown-body table {
  border-collapse: collapse;
  margin: 10px 0;
  width: 100%;
  font-size: 13px;
}

.markdown-body th,
.markdown-body td {
  border: 1px solid #e0e4ea;
  padding: 6px 10px;
  text-align: left;
}

.markdown-body th {
  background: #f5f7fa;
  font-weight: 600;
}

.markdown-body a {
  color: var(--app-primary);
  text-decoration: none;
}
</style>
