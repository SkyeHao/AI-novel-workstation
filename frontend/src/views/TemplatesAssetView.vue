<template>
  <div class="templates-asset-view">
    <PageHeader title="设定模板资产" subtitle="管理所有设定类型的模板，定义 Agent 生成时的维度结构" icon="Files">
      <template #actions>
        <el-tag size="small" type="info" effect="plain" round>{{ currentLabel }}</el-tag>
      </template>
    </PageHeader>

    <div class="ta-tabs">
      <button
        v-for="item in tabs"
        :key="item.key"
        class="ta-tab-chip"
        :class="{ active: activeTab === item.key }"
        @click="activeTab = item.key"
      >
        <span class="ta-tab-label">{{ item.label }}</span>
        <span class="ta-tab-count">{{ item.count }}</span>
      </button>
    </div>

    <div class="ta-content">
      <!-- 人物状态模板 -->
      <div v-if="activeTab === 'character-state'" class="ta-grid">
        <div v-for="template in characterStateTemplates" :key="template.id" class="ta-card">
          <div class="ta-card-header">
            <div class="ta-card-title">{{ template.label }}</div>
            <div class="ta-card-badge">{{ template.dimensions.length }} 维度</div>
          </div>
          <div class="ta-card-desc">{{ template.description }}</div>
          <div class="ta-card-tags">
            <span
              v-for="dim in template.dimensions"
              :key="dim.key"
              class="ta-dim-tag"
              :class="{ core: dim.core }"
            >
              {{ dim.label }}
            </span>
          </div>
        </div>
      </div>

      <!-- 世界观模板 -->
      <div v-if="activeTab === 'worldview'" class="ta-grid">
        <div v-for="template in worldviewTemplates" :key="template.id" class="ta-card">
          <div class="ta-card-header">
            <div class="ta-card-title">{{ template.label }}</div>
            <div class="ta-card-badge">{{ template.dimensions.length }} 维度</div>
          </div>
          <div class="ta-card-desc">{{ template.description }}</div>
          <div class="ta-card-tags">
            <span
              v-for="dim in template.dimensions"
              :key="dim.key"
              class="ta-dim-tag"
              :class="{ required: dim.required }"
            >
              {{ dim.label }}
            </span>
          </div>
        </div>
      </div>

      <!-- 人物模板 -->
      <div v-if="activeTab === 'character'" class="ta-grid">
        <div v-for="template in characterTemplates" :key="template.id" class="ta-card">
          <div class="ta-card-header">
            <div class="ta-card-title">{{ template.label }}</div>
            <div class="ta-card-badge">{{ template.dimensions.length }} 维度</div>
          </div>
          <div class="ta-card-desc">{{ template.description }}</div>
          <div class="ta-card-tags">
            <span
              v-for="dim in template.dimensions"
              :key="dim.key"
              class="ta-dim-tag"
              :class="{ required: dim.required }"
            >
              {{ dim.label }}
            </span>
          </div>
        </div>
      </div>

      <!-- 大纲模板 -->
      <div v-if="activeTab === 'outline'" class="ta-grid">
        <div v-for="template in outlineTemplates" :key="template.id" class="ta-card">
          <div class="ta-card-header">
            <div class="ta-card-title">{{ template.label }}</div>
            <div class="ta-card-badge">{{ template.structure.length }} 层结构</div>
          </div>
          <div class="ta-card-desc">{{ template.description }}</div>
          <div class="ta-card-structure">
            <div class="ta-structure-label">层级结构</div>
            <div class="ta-structure-flow">
              <span
                v-for="(level, idx) in template.structure"
                :key="level"
                class="ta-structure-node"
              >
                {{ level }}
                <span v-if="idx < template.structure.length - 1" class="ta-structure-arrow">→</span>
              </span>
            </div>
          </div>
          <div class="ta-card-props">
            <div class="ta-structure-label">节点属性</div>
            <div
              v-for="(props, nodeType) in template.nodeProperties"
              :key="nodeType"
              class="ta-prop-row"
            >
              <span class="ta-prop-type">{{ nodeType }}</span>
              <span class="ta-prop-count">{{ props.length }} 个属性</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 风格模板 -->
      <div v-if="activeTab === 'style'" class="ta-grid">
        <div v-for="template in styleTemplates" :key="template.id" class="ta-card">
          <div class="ta-card-header">
            <div class="ta-card-title">{{ template.label }}</div>
            <div class="ta-card-badge">{{ template.dimensions.length }} 维度</div>
          </div>
          <div class="ta-card-desc">{{ template.description }}</div>
          <div class="ta-card-tags">
            <span
              v-for="dim in template.dimensions"
              :key="dim.key"
              class="ta-dim-tag"
              :class="{ required: dim.required }"
            >
              {{ dim.label }}
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import {
  getCharacterStateTemplates,
  getWorldviewTemplates,
  getCharacterTemplates,
  getOutlineTemplates,
  getStyleTemplates,
  type CharacterStateTemplate,
  type WorldviewTemplate,
  type CharacterTemplate,
  type OutlineTemplate,
  type StyleTemplate,
} from '@/api'
import PageHeader from '@/components/PageHeader.vue'

const activeTab = ref('character-state')

const characterStateTemplates = ref<CharacterStateTemplate[]>([])
const worldviewTemplates = ref<WorldviewTemplate[]>([])
const characterTemplates = ref<CharacterTemplate[]>([])
const outlineTemplates = ref<OutlineTemplate[]>([])
const styleTemplates = ref<StyleTemplate[]>([])

const tabs = computed(() => [
  { key: 'character-state', label: '人物状态模板', count: characterStateTemplates.value.length },
  { key: 'worldview', label: '世界观模板', count: worldviewTemplates.value.length },
  { key: 'character', label: '人物模板', count: characterTemplates.value.length },
  { key: 'outline', label: '大纲模板', count: outlineTemplates.value.length },
  { key: 'style', label: '风格模板', count: styleTemplates.value.length },
])

const currentLabel = computed(() => {
  return tabs.value.find(t => t.key === activeTab.value)?.label || ''
})

onMounted(async () => {
  try {
    const [csRes, wvRes, chRes, olRes, stRes] = await Promise.all([
      getCharacterStateTemplates(),
      getWorldviewTemplates(),
      getCharacterTemplates(),
      getOutlineTemplates(),
      getStyleTemplates(),
    ])
    characterStateTemplates.value = csRes.data
    worldviewTemplates.value = wvRes.data
    characterTemplates.value = chRes.data
    outlineTemplates.value = olRes.data
    styleTemplates.value = stRes.data
  } catch (err) {
    ElMessage.error('加载模板失败')
    console.error(err)
  }
})
</script>

<style scoped>
.templates-asset-view {
  max-width: 1400px;
  margin: 0 auto;
}

/* Tab 按钮组 - 与静态设定保持一致 */
.ta-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 14px;
}

.ta-tab-chip {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 5px 12px;
  border: 1px solid var(--border-color-light);
  border-radius: 999px;
  background: #fff;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.ta-tab-chip:hover {
  border-color: #4f46e5;
  background: #f5f5ff;
}

.ta-tab-chip.active {
  border-color: #4f46e5;
  background: linear-gradient(135deg, #4f46e5, #2563eb);
  box-shadow: 0 4px 12px rgba(79, 70, 229, 0.3);
}

.ta-tab-label {
  font-size: 12.5px;
  color: var(--text-regular);
}

.ta-tab-chip.active .ta-tab-label {
  color: #fff;
}

.ta-tab-count {
  font-size: 11px;
  font-weight: 600;
  color: #4f46e5;
  background: rgba(79, 70, 229, 0.1);
  padding: 1px 8px;
  border-radius: 999px;
}

.ta-tab-chip.active .ta-tab-count {
  color: #fff;
  background: rgba(255, 255, 255, 0.25);
}

/* 内容区 */
.ta-content {
  padding: 2px;
}

/* 卡片网格 */
.ta-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
  gap: 16px;
}

/* 卡片样式 - 增强对比度和边界 */
.ta-card {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 20px;
  transition: all 0.2s ease;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
}

.ta-card:hover {
  border-color: #6366f1;
  box-shadow: 0 4px 12px rgba(99, 102, 241, 0.12);
  transform: translateY(-2px);
}

/* 卡片头部 */
.ta-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
  padding-bottom: 12px;
  border-bottom: 1px solid #f3f4f6;
}

.ta-card-title {
  font-size: 16px;
  font-weight: 600;
  color: #1f2937;
}

.ta-card-badge {
  font-size: 11px;
  font-weight: 600;
  color: #6366f1;
  background: rgba(99, 102, 241, 0.1);
  padding: 3px 10px;
  border-radius: 999px;
}

/* 描述 */
.ta-card-desc {
  font-size: 13px;
  color: #6b7280;
  line-height: 1.5;
  margin-bottom: 16px;
}

/* 维度标签 */
.ta-card-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.ta-dim-tag {
  font-size: 12px;
  color: #4b5563;
  background: #f3f4f6;
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid #e5e7eb;
}

.ta-dim-tag.core {
  color: #6366f1;
  background: rgba(99, 102, 241, 0.08);
  border-color: rgba(99, 102, 241, 0.2);
  font-weight: 500;
}

.ta-dim-tag.required {
  color: #dc2626;
  background: rgba(220, 38, 38, 0.06);
  border-color: rgba(220, 38, 38, 0.15);
}

/* 大纲模板特有样式 */
.ta-card-structure {
  margin-bottom: 16px;
}

.ta-structure-label {
  font-size: 12px;
  color: #9ca3af;
  margin-bottom: 8px;
  font-weight: 500;
}

.ta-structure-flow {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
}

.ta-structure-node {
  font-size: 13px;
  color: #059669;
  background: rgba(5, 150, 105, 0.08);
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid rgba(5, 150, 105, 0.2);
}

.ta-structure-arrow {
  color: #9ca3af;
  margin: 0 2px;
}

/* 属性列表 */
.ta-card-props {
  padding-top: 12px;
  border-top: 1px solid #f3f4f6;
}

.ta-prop-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 0;
}

.ta-prop-type {
  font-size: 12px;
  color: #6366f1;
  font-weight: 500;
}

.ta-prop-count {
  font-size: 12px;
  color: #6b7280;
}
</style>

