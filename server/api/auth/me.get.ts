// @author Codex
// @date 2026-07-07 14:27:58
// @comment 返回当前应用登录认证状态

import { defineEventHandler } from 'h3';
import { getAppAuthStatus } from '~/server/utils/auth';

export default defineEventHandler(event => {
  return getAppAuthStatus(event);
});
