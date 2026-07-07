// @author Codex
// @date 2026-07-07 14:27:58
// @comment 拦截未登录用户访问应用页面与服务端 API

import { createError, defineEventHandler, getRequestURL, sendRedirect } from 'h3';
import { getAppAuthStatus, isAppAuthEnabled } from '~/server/utils/auth';

function isPublicPath(path: string): boolean {
  if (path === '/login' || path.startsWith('/api/auth/')) {
    return true;
  }
  if (path.startsWith('/_nuxt/') || path.startsWith('/vendors/') || path.startsWith('/custom-elements/')) {
    return true;
  }
  if (path === '/favicon.ico' || path === '/robots.txt') {
    return true;
  }

  return /\.(css|js|map|png|jpg|jpeg|gif|svg|ico|webp|woff|woff2|ttf|wasm)$/i.test(path);
}

export default defineEventHandler(async event => {
  if (!isAppAuthEnabled()) {
    return;
  }

  const url = getRequestURL(event);
  if (isPublicPath(url.pathname)) {
    return;
  }

  const status = getAppAuthStatus(event);
  if (status.authenticated) {
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    throw createError({
      statusCode: status.configured ? 401 : 503,
      statusMessage: status.configured ? 'Unauthorized' : 'App auth is not configured',
      message: status.configured ? '未登录' : '应用登录认证未配置',
    });
  }

  const redirect = status.configured
    ? `/login?redirect=${encodeURIComponent(`${url.pathname}${url.search}`)}`
    : '/login';
  return sendRedirect(event, redirect, 302);
});
