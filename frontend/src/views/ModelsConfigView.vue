<template>
  <div class="models-config-view">
    <PageHeader title="模型管理" subtitle="管理所有可用的大模型配置" icon="Cpu">
      <template #actions>
        <el-button type="primary" plain :loading="loading" @click="loadModels">
          <el-icon style="margin-right: 6px"><Refresh /></el-icon>
          刷新
        </el-button>
        <el-button type="primary" @click="openAddDialog">
          <el-icon style="margin-right: 6px"><Plus /></el-icon>
          添加模型
        </el-button>
      </template>
    </PageHeader>

    <div class="panel">
      <div class="panel-head">
        <div class="panel-title-group">
          <el-icon class="panel-title-icon"><Coin /></el-icon>
          <span class="panel-title">模型池</span>
          <span class="panel-subtitle">共 {{ models.length }} 个模型，行末三点菜单可测试 / 编辑 / 删除</span>
        </div>
        <div class="panel-actions">
          <el-tag size="small" type="info" effect="plain" round>{{ models.filter((m) => m.status === 'ok').length }} 个已连接</el-tag>
        </div>
      </div>
      <div class="panel-body panel-body-flat">
        <el-table
          v-loading="loading"
          :data="models"
          style="width: 100%"
          empty-text="暂无模型，请点击「添加模型」按钮"
        >
          <el-table-column prop="name" label="名称" min-width="120">
            <template #default="{ row }">
              <div class="model-name-cell">
                <span class="model-name">{{ row.name }}</span>
                <el-tag v-if="row.is_default" size="small" type="warning" effect="dark" round>默认</el-tag>
                <span v-if="row.provider_id" class="model-provider-tag">{{ getProviderName(row.provider_id) }}</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column prop="model" label="模型标识" min-width="140">
            <template #default="{ row }">
              <span class="mono">{{ row.model }}</span>
            </template>
          </el-table-column>
          <el-table-column label="Base URL" min-width="220" show-overflow-tooltip>
            <template #default="{ row }">
              <span class="mono url-text">{{ row.base_url }}</span>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="110" align="center">
            <template #default="{ row }">
              <el-tag :type="getStatusType(row.status)" effect="light" size="small" round>
                {{ getStatusText(row.status) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="70" align="center" fixed="right">
            <template #default="{ row, $index }">
              <el-dropdown trigger="click" @command="(cmd: string) => handleCommand(cmd, row, $index)">
                <el-button link type="primary" circle>
                  <el-icon><MoreFilled /></el-icon>
                </el-button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item command="set_default" :disabled="!!row.is_default">
                      <el-icon><StarFilled /></el-icon>{{ row.is_default ? '当前默认' : '设为默认' }}
                    </el-dropdown-item>
                    <el-dropdown-item command="test">
                      <el-icon><Connection /></el-icon>测试连接
                    </el-dropdown-item>
                    <el-dropdown-item command="edit">
                      <el-icon><EditPen /></el-icon>编辑
                    </el-dropdown-item>
                    <el-dropdown-item command="delete" divided>
                      <el-icon><Delete /></el-icon>删除
                    </el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </div>

    <!-- 添加/编辑对话框 -->
    <el-dialog v-model="dialogVisible" :title="isEdit ? '编辑模型' : '添加模型'" width="520px" :close-on-click-modal="false">
      <el-form :model="form" label-width="100px">
        <el-form-item label="名称" required>
          <el-input v-model="form.name" placeholder="如：GPT-4" />
        </el-form-item>
        <el-form-item label="服务商" required>
          <el-select v-model="form.provider_id" placeholder="选择服务商" style="width: 100%">
            <el-option v-for="p in providers" :key="p.id" :label="p.name" :value="p.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="模型标识" required>
          <el-input v-model="form.model" placeholder="如：gpt-4-turbo" />
        </el-form-item>
        <el-form-item label="Base URL" required>
          <el-input v-model="form.base_url" placeholder="https://api.openai.com/v1" />
        </el-form-item>
        <el-form-item label="API Key" required>
          <el-input v-model="form.api_key" type="password" show-password placeholder="sk-..." />
        </el-form-item>
        <el-divider content-position="left">高级参数</el-divider>
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="温度">
              <el-input-number v-model="form.temperature" :min="0" :max="2" :step="0.1" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="最大 Token">
              <el-input-number v-model="form.max_tokens" :min="1" :step="512" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="超时（秒）">
              <el-input-number v-model="form.timeout" :min="10" :step="10" style="width: 100%" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="重试次数">
              <el-input-number v-model="form.max_retries" :min="0" :max="10" :step="1" style="width: 100%" />
            </el-form-item>
          </el-col>
        </el-row>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="saveModel">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { getModels, createModel, updateModel, deleteModel, testModel, getProviders } from '@/api'
import PageHeader from '@/components/PageHeader.vue'

const loading = ref(false)
const models = ref<any[]>([])
const providers = ref<any[]>([])
const dialogVisible = ref(false)
const isEdit = ref(false)
const editingIndex = ref(-1)
const form = ref({
  name: '',
  provider_id: '',
  model: '',
  base_url: '',
  api_key: '',
  temperature: 0.7,
  max_tokens: 4096,
  timeout: 120,
  max_retries: 2,
})

function getProviderName(providerId: string): string {
  const p = providers.value.find((x) => x.id === providerId)
  return p?.name || providerId
}

function getStatusType(status: string): string {
  const map: Record<string, string> = {
    untested: 'info',
    ok: 'success',
    failed: 'danger',
  }
  return map[status] || 'info'
}

function getStatusText(status: string): string {
  const map: Record<string, string> = {
    untested: '未测试',
    ok: '已连接',
    failed: '失败',
  }
  return map[status] || status
}

async function loadModels() {
  loading.value = true
  try {
    const res = await getModels()
    models.value = res.data
  } catch (err) {
    ElMessage.error('加载模型列表失败')
  } finally {
    loading.value = false
  }
}

async function loadProviders() {
  try {
    const res = await getProviders()
    providers.value = res.data
  } catch (err) {
    console.error('Failed to load providers:', err)
  }
}

function openAddDialog() {
  isEdit.value = false
  editingIndex.value = -1
  form.value = { name: '', provider_id: '', model: '', base_url: '', api_key: '', temperature: 0.7, max_tokens: 4096, timeout: 120, max_retries: 2 }
  dialogVisible.value = true
}

async function saveModel() {
  if (!form.value.name || !form.value.model || !form.value.base_url || !form.value.api_key) {
    ElMessage.warning('请填写必填项')
    return
  }
  try {
    if (isEdit.value) {
      await updateModel(models.value[editingIndex.value].id, form.value)
      ElMessage.success('更新成功')
    } else {
      await createModel(form.value)
      ElMessage.success('添加成功')
    }
    dialogVisible.value = false
    await loadModels()
  } catch (err) {
    ElMessage.error('保存失败')
  }
}

async function handleCommand(command: string, row: any, index: number) {
  if (command === 'set_default') {
    try {
      await updateModel(row.id, { is_default: true })
      ElMessage.success('已设为系统默认模型')
      await loadModels()
    } catch (err) {
      ElMessage.error('设置默认失败')
    }
  } else if (command === 'test') {
    try {
      ElMessage.info('测试中...')
      const res = await testModel(row.id)
      if (res.data.success) {
        ElMessage.success('连接成功')
        await loadModels()
      } else {
        ElMessage.error('连接失败: ' + res.data.message)
      }
    } catch (err) {
      ElMessage.error('测试失败')
    }
  } else if (command === 'edit') {
    isEdit.value = true
    editingIndex.value = index
    form.value = { ...row }
    dialogVisible.value = true
  } else if (command === 'delete') {
    try {
      await ElMessageBox.confirm('确定要删除该模型吗？', '确认', { type: 'warning' })
      await deleteModel(row.id)
      ElMessage.success('删除成功')
      await loadModels()
    } catch (err) {
      if (err !== 'cancel') {
        ElMessage.error('删除失败')
      }
    }
  }
}

onMounted(() => {
  loadModels()
  loadProviders()
})
</script>

<style scoped>
.models-config-view {
  max-width: 1400px;
  margin: 0 auto;
}
.panel-body-flat { padding: 0; }
.model-name-cell { display: flex; align-items: center; gap: 8px; }
.model-name { font-weight: 500; color: var(--text-primary); }
.model-provider-tag {
  font-size: 11px; color: var(--text-secondary);
  background: #eef2ff; border: 1px solid rgba(99,102,241,.2);
  padding: 1px 8px; border-radius: 999px;
}
.mono { font-family: 'Consolas', 'Monaco', 'Courier New', monospace; font-size: 12px; }
.url-text { color: var(--text-regular); }
</style>
