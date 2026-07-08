// @author Codex
// @date 2026-07-07 14:27:58
// @comment 校验应用账号密码并签发登录会话

import { createError, defineEventHandler, readBody } from 'h3';
import { getAppAuthConfig, setAppAuthSession, verifyAppAuthPassword } from '~/server/utils/auth';

interface LoginBody {
  username?: string;
  password?: string;
}

export default defineEventHandler(async event => {
  const config = getAppAuthConfig();
  if (!config.enabled) {
    return {
      authenticated: true,
      username: null,
    };
  }
  if (!config.configured) {
    throw createError({
      statusCode: 503,
      statusMessage: 'App auth is not configured',
      message: '应用登录认证未配置，请设置 APP_AUTH_USERNAME 和 APP_AUTH_PASSWORD',
    });
  }

  const body = await readBody<LoginBody>(event);
  const username = (body.username || '').trim();
  const password = body.password || '';
  if (!verifyAppAuthPassword(username, password)) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Invalid credentials',
      message: '账号或密码错误',
    });
  }

  setAppAuthSession(event, username);
  return {
    authenticated: true,
    username,
  };
});
