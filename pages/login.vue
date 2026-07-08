<script setup lang="ts">
interface AppAuthStatus {
  enabled: boolean;
  configured: boolean;
  authenticated: boolean;
  username: string | null;
}

useHead({
  title: '登录 | 公众号文章导出',
});

const route = useRoute();
const username = ref('');
const password = ref('');
const loading = ref(false);
const errorMessage = ref('');
const authStatus = ref<AppAuthStatus | null>(null);

const redirectPath = computed(() => {
  const redirect = route.query.redirect;
  return typeof redirect === 'string' && redirect.startsWith('/') ? redirect : '/dashboard/account';
});
const authMisconfigured = computed(() => authStatus.value?.enabled === true && authStatus.value.configured === false);

async function refreshAuthStatus() {
  try {
    authStatus.value = await $fetch<AppAuthStatus>('/api/auth/me', { retry: 0 });
  } catch {
    authStatus.value = {
      enabled: true,
      configured: false,
      authenticated: false,
      username: null,
    };
  }
}

async function login() {
  errorMessage.value = '';
  loading.value = true;
  try {
    await $fetch('/api/auth/login', {
      method: 'POST',
      body: {
        username: username.value,
        password: password.value,
      },
      retry: 0,
    });
    await navigateTo(redirectPath.value, { replace: true });
  } catch (error: any) {
    errorMessage.value = error?.data?.message || error?.message || error?.statusMessage || '登录失败';
    await refreshAuthStatus();
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  refreshAuthStatus();
});
</script>

<template>
  <main class="min-h-screen bg-slate-1 flex items-center justify-center px-4">
    <section class="w-full max-w-[380px] rounded-lg border border-slate-4 bg-white p-6 shadow-sm">
      <div class="mb-6">
        <h1 class="text-xl font-semibold text-slate-12">账号登录</h1>
        <p class="mt-2 text-sm text-slate-10">请输入部署环境配置的访问账号。</p>
      </div>

      <UAlert
        v-if="authMisconfigured"
        color="red"
        variant="soft"
        title="认证未配置"
        description="请在服务端配置 APP_AUTH_USERNAME 和 APP_AUTH_PASSWORD 后重建 app 容器。"
        class="mb-4"
      />

      <form class="space-y-4" @submit.prevent="login">
        <UFormGroup label="账号" name="username">
          <UInput
            v-model="username"
            autocomplete="username"
            :disabled="loading || authMisconfigured"
            autofocus
            icon="i-lucide:user"
          />
        </UFormGroup>

        <UFormGroup label="密码" name="password">
          <UInput
            v-model="password"
            type="password"
            autocomplete="current-password"
            :disabled="loading || authMisconfigured"
            icon="i-lucide:lock"
          />
        </UFormGroup>

        <UAlert v-if="errorMessage" color="red" variant="soft" :description="errorMessage" />

        <UButton
          type="submit"
          block
          color="black"
          :loading="loading"
          :disabled="authMisconfigured || !username || !password"
        >
          登录
        </UButton>
      </form>
    </section>
  </main>
</template>
