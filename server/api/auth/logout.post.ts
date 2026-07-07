// @author Codex
// @date 2026-07-07 14:27:58
// @comment 清理应用登录会话

import { defineEventHandler } from 'h3';
import { clearAppAuthSession } from '~/server/utils/auth';

export default defineEventHandler(event => {
  clearAppAuthSession(event);
  return {
    ok: true,
  };
});
