<template>
  <div class="genre-asset-view">
    <PageHeader title="人物状态模板" subtitle="可复用到所有小说的人物状态维度资产库" icon="MagicStick">
      <template #actions>
        <el-tag type="primary" effect="plain" round>{{ templates.length }} 套模板</el-tag>
        <el-button plain :loading="loading" @click="loadData">
          <el-icon style="margin-right: 4px"><Refresh /></el-icon>
          刷新
        </el-button>
      </template>
    </PageHeader>

    <div class="asset-intro">
      <div class="asset-intro-text">
        人物动态状态的维度随题材变化。每个模板提供一组「建议维度」，用于正文章末回写的提示词引导与前端人物状态展示。
        模板不是硬约束——Agent 仍可自由写入额外字段，前端会动态追加展示。
      </div>
      <div class="asset-intro-tags">
        <el-tag size="small" type="info" effect="plain" round>通用必填：名称 / 当前状态</el-tag>
        <el-tag size="small" type="warning" effect="plain" round>带 * 为核心维度</el-tag>
      </div>
    </div>

    <div class="genre-grid">
      <div v-for="t in templates" :key="t.id" class="genre-card">
        <div class="genre-card-head">
          <span class="genre-card-title">{{ t.label }}</span>
          <span class="genre-card-id">{{ t.id }}</span>
        </div>
        <p class="genre-card-desc">{{ t.description }}</p>
        <div class="genre-dims">
          <span
            v-for="d in t.dimensions"
            :key="d.key"
            class="dim-chip"
            :class="{ 'dim-core': d.core }"
            :title="d.hint"
          >
            {{ d.label }}<span v-if="d.core" class="dim-star">*</span>
          </span>
        </div>
      </div>
    </div>

    <el-empty v-if="!loading && templates.length === 0" description="暂无题材模板" />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { getCharacterStateTemplates, type CharacterStateTemplate } from '@/api'
import PageHeader from '@/components/PageHeader.vue'

const loading = ref(false)
const templates = ref<CharacterStateTemplate[]>([])

async function loadData() {
  loading.value = true
  try {
    const res = await getCharacterStateTemplates()
    templates.value = res.data || []
  } catch {
    templates.value = []
  } finally {
    loading.value = false
  }
}

onMounted(loadData)
</script>

<style scoped>
.genre-asset-view { max-width: 1400px; margin: 0 auto; }
.asset-intro {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 18px;
  margin-bottom: 16px;
  background: var(--surface);
  border: 1px solid var(--border-color-light);
  border-radius: 10px;
  flex-wrap: wrap;
}
.asset-intro-text { flex: 1; min-width: 260px; font-size: 13px; color: var(--text-secondary); line-height: 1.7; }
.asset-intro-tags { display: flex; gap: 8px; flex-shrink: 0; flex-wrap: wrap; }

.genre-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 16px;
}
.genre-card {
  padding: 18px 20px;
  background: #fff;
  border: 1px solid var(--border-color-light);
  border-radius: 12px;
  transition: all 0.2s ease;
}
.genre-card:hover {
  border-color: var(--accent-border);
  box-shadow: 0 6px 20px rgba(79, 70, 229, 0.08);
  transform: translateY(-2px);
}
.genre-card-head { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.genre-card-title { font-size: 17px; font-weight: 700; color: var(--text-title); }
.genre-card-id { font-size: 11px; color: var(--text-placeholder); background: var(--surface-hover); padding: 2px 8px; border-radius: 6px; }
.genre-card-desc { font-size: 12px; color: var(--text-secondary); line-height: 1.7; margin: 0 0 14px; min-height: 40px; }
.genre-dims { display: flex; flex-wrap: wrap; gap: 6px; }
.dim-chip {
  padding: 3px 10px; border-radius: 999px; font-size: 12px;
  background: var(--accent-soft); color: var(--accent); border: 1px solid var(--accent-border);
}
.dim-chip.dim-core { font-weight: 600; }
.dim-star { margin-left: 2px; color: var(--accent-hover); }
</style>

