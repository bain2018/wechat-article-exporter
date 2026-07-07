// @author Codex
// @date 2026-07-07 14:27:58
// @comment 客户端路由层应用登录状态检查与登录页跳转

interface AppAuthStatus {
  enabled: boolean;
  configured: boolean;
  authenticated: boolean;
  username: string | null;
}

export default defineNuxtRouteMiddleware(async to => {
  const isLoginPage = to.path === '/login';

  try {
    const status = await $fetch<AppAuthStatus>('/api/auth/me', {
      retry: 0,
    });

    if (!status.enabled) {
      return;
    }
    if (status.authenticated) {
      if (isLoginPage) {
        return navigateTo('/dashboard/account');
      }
      return;
    }
    if (!isLoginPage) {
      return navigateTo({
        path: '/login',
        query: {
          redirect: to.fullPath,
        },
      });
    }
  } catch {
    if (!isLoginPage) {
      return navigateTo({
        path: '/login',
        query: {
          redirect: to.fullPath,
        },
      });
    }
  }
});
