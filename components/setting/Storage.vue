<template>
  <UCard class="mx-4 mt-10">
    <template #header>
      <div class="flex items-center justify-between gap-4">
        <div>
          <h3 class="text-2xl font-semibold">服务端存储</h3>
          <p class="text-sm text-slate-10 font-serif">PostgreSQL / MinIO</p>
        </div>
        <UButton
          color="gray"
          variant="ghost"
          icon="i-heroicons-arrow-path-20-solid"
          :loading="loading"
          @click="loadStats"
        />
      </div>
    </template>

    <div class="space-y-5">
      <dl
        class="grid grid-cols-2 lg:grid-cols-6 border-y border-slate-200 dark:border-slate-700 divide-x divide-slate-200 dark:divide-slate-700"
      >
        <div class="p-3">
          <dt class="text-xs text-slate-500">文章</dt>
          <dd class="font-mono text-xl">{{ formatNumber(stats?.articleCount) }}</dd>
        </div>
        <div class="p-3">
          <dt class="text-xs text-slate-500">汇总行</dt>
          <dd class="font-mono text-xl">{{ formatNumber(stats?.exportRowCount) }}</dd>
        </div>
        <div class="p-3">
          <dt class="text-xs text-slate-500">缺失</dt>
          <dd class="font-mono text-xl" :class="stats?.missingExportRowCount ? 'text-amber-600' : 'text-emerald-600'">
            {{ formatNumber(stats?.missingExportRowCount) }}
          </dd>
        </div>
        <div class="p-3">
          <dt class="text-xs text-slate-500">阅读指标</dt>
          <dd class="font-mono text-xl">{{ formatNumber(stats?.metadataCount) }}</dd>
        </div>
        <div class="p-3">
          <dt class="text-xs text-slate-500">留言</dt>
          <dd class="font-mono text-xl">{{ formatNumber(stats?.commentCacheCount) }}</dd>
        </div>
        <div class="p-3">
          <dt class="text-xs text-slate-500">正文</dt>
          <dd class="font-mono text-xl">{{ formatNumber(stats?.htmlCacheCount) }}</dd>
        </div>
      </dl>

      <div class="flex flex-wrap items-end gap-3">
        <div>
          <p class="mb-1 text-xs text-slate-500">公众号 fakeid</p>
          <UInput v-model="fakeid" class="w-[260px] font-mono" placeholder="留空表示全部公众号" />
        </div>
        <UButton
          icon="i-heroicons-wrench-screwdriver-20-solid"
          color="blue"
          :loading="refreshingMode === 'missing'"
          :disabled="!!refreshingMode"
          @click="refreshRows('missing')"
        >
          补齐缺失汇总
        </UButton>
        <UButton
          icon="i-heroicons-arrow-path-rounded-square-20-solid"
          color="orange"
          variant="soft"
          :loading="refreshingMode === 'full'"
          :disabled="!!refreshingMode"
          @click="refreshRows('full')"
        >
          全量刷新汇总
        </UButton>
        <p class="text-xs text-slate-500">最后刷新：{{ formatTime(stats?.lastRefreshedAt) }}</p>
      </div>
    </div>
  </UCard>
</template>

<script setup lang="ts">
import dayjs from 'dayjs';
import toastFactory from '~/composables/toast';

type RefreshMode = 'missing' | 'full';

interface ExportRowsStats {
  articleCount: number;
  exportRowCount: number;
  metadataCount: number;
  commentCacheCount: number;
  htmlCacheCount: number;
  missingExportRowCount: number;
  lastRefreshedAt: string | null;
}

const toast = toastFactory();
const stats = ref<ExportRowsStats | null>(null);
const fakeid = ref('');
const loading = ref(false);
const refreshingMode = ref<RefreshMode | ''>('');

onMounted(() => {
  loadStats();
});

async function loadStats() {
  loading.value = true;
  try {
    const response = await fetch('/api/web/storage/export-rows');
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }
    const result = await response.json();
    stats.value = result.data;
  } catch (error: any) {
    toast.error('汇总状态读取失败', error?.message || '请求失败');
  } finally {
    loading.value = false;
  }
}

async function refreshRows(mode: RefreshMode) {
  if (mode === 'full' && !window.confirm('全量刷新会扫描现有文章缓存并重建导出汇总，是否继续？')) {
    return;
  }

  refreshingMode.value = mode;
  try {
    const response = await fetch('/api/web/storage/export-rows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode,
        fakeid: fakeid.value.trim() || undefined,
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(result?.message || `${response.status} ${response.statusText}`);
    }
    stats.value = result.data.after;
    toast.success('汇总刷新完成', `本次刷新 ${formatNumber(result.data.refreshed)} 行`);
  } catch (error: any) {
    toast.error('汇总刷新失败', error?.message || '请求失败');
  } finally {
    refreshingMode.value = '';
  }
}

function formatNumber(value: number | undefined | null) {
  return new Intl.NumberFormat('zh-CN').format(Number(value || 0));
}

function formatTime(value: string | null | undefined) {
  return value ? dayjs(value).format('YYYY-MM-DD HH:mm:ss') : '-';
}
</script>
