<script setup lang="ts">
const usage = ref('计算中');

function formatBytes(bytes: number) {
  if (bytes < 1000) {
    return `${bytes} B`;
  }
  if (bytes < 1000 ** 2) {
    return `${(bytes / 1000).toFixed(0)} kB`;
  }
  if (bytes < 1000 ** 3) {
    return `${(bytes / 1000 ** 2).toFixed(1)} M`;
  }
  return `${(bytes / 1000 ** 3).toFixed(1)} G`;
}

function canEstimateStorage() {
  return typeof navigator !== 'undefined' && typeof navigator.storage?.estimate === 'function';
}

async function init() {
  if (!canEstimateStorage()) {
    usage.value = '暂不可用';
    return;
  }

  try {
    const storageUsage = await navigator.storage.estimate();
    usage.value = formatBytes(storageUsage.usage ?? 0);
  } catch (error) {
    console.warn('Failed to estimate storage usage', error);
    usage.value = '暂不可用';
  }
}

let timer: number | null = null;
onMounted(() => {
  init();
  if (!canEstimateStorage()) {
    return;
  }

  timer = window.setInterval(() => {
    init();
  }, 1000);
});
onUnmounted(() => {
  if (timer !== null) {
    window.clearInterval(timer);
  }
});
</script>

<template>
  <p class="text-sm">
    本地数据库占用约为 <span class="text-rose-500">{{ usage }}</span>
  </p>
</template>
