// @author Codex
// @date 2026-07-07 14:27:58
// @comment 应用级账号登录认证配置、会话签发与校验逻辑

import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { H3Event } from 'h3';
import { deleteCookie, getCookie, setCookie } from 'h3';

const AUTH_COOKIE_NAME = 'wae-session';
const DEFAULT_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

interface AppAuthConfig {
  enabled: boolean;
  configured: boolean;
  username: string;
  password: string;
  passwordSha256: string;
  secret: string;
  sessionTtlSeconds: number;
  cookieSecure: boolean;
}

export interface AppAuthStatus {
  enabled: boolean;
  configured: boolean;
  authenticated: boolean;
  username: string | null;
}

interface AppAuthPayload {
  sub: string;
  iat: number;
  exp: number;
  nonce: string;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') {
    return fallback;
  }

  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function parseSessionTtl(value: string | undefined): number {
  const ttl = Number(value || DEFAULT_SESSION_TTL_SECONDS);
  return Number.isFinite(ttl) && ttl > 0 ? Math.floor(ttl) : DEFAULT_SESSION_TTL_SECONDS;
}

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url');
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function timingSafeStringEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function getAppAuthConfig(): AppAuthConfig {
  const enabled = parseBoolean(process.env.APP_AUTH_ENABLED, process.env.NODE_ENV === 'production');
  const username = (process.env.APP_AUTH_USERNAME || '').trim();
  const password = process.env.APP_AUTH_PASSWORD || '';
  const passwordSha256 = (process.env.APP_AUTH_PASSWORD_SHA256 || '').trim().toLowerCase();
  const secret = process.env.APP_AUTH_SECRET || '';

  return {
    enabled,
    configured: Boolean(username && secret && (password || passwordSha256)),
    username,
    password,
    passwordSha256,
    secret,
    sessionTtlSeconds: parseSessionTtl(process.env.APP_AUTH_SESSION_TTL_SECONDS),
    cookieSecure: parseBoolean(process.env.APP_AUTH_COOKIE_SECURE, false),
  };
}

export function isAppAuthEnabled(): boolean {
  return getAppAuthConfig().enabled;
}

export function isAppAuthConfigured(): boolean {
  const config = getAppAuthConfig();
  return !config.enabled || config.configured;
}

export function verifyAppAuthPassword(username: string, password: string): boolean {
  const config = getAppAuthConfig();
  if (!config.enabled || !config.configured) {
    return false;
  }
  if (!timingSafeStringEqual(username, config.username)) {
    return false;
  }
  if (config.passwordSha256) {
    return timingSafeStringEqual(sha256(password), config.passwordSha256);
  }

  return timingSafeStringEqual(password, config.password);
}

function createSessionToken(username: string): string {
  const config = getAppAuthConfig();
  const now = Math.floor(Date.now() / 1000);
  const payload: AppAuthPayload = {
    sub: username,
    iat: now,
    exp: now + config.sessionTtlSeconds,
    nonce: randomUUID(),
  };
  const encodedPayload = base64url(JSON.stringify(payload));
  return `${encodedPayload}.${sign(encodedPayload, config.secret)}`;
}

export function setAppAuthSession(event: H3Event, username: string): void {
  const config = getAppAuthConfig();
  setCookie(event, AUTH_COOKIE_NAME, createSessionToken(username), {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    path: '/',
    maxAge: config.sessionTtlSeconds,
  });
}

export function clearAppAuthSession(event: H3Event): void {
  deleteCookie(event, AUTH_COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'lax',
    secure: getAppAuthConfig().cookieSecure,
    path: '/',
  });
}

export function verifyAppAuthSession(event: H3Event): string | null {
  const config = getAppAuthConfig();
  if (!config.enabled) {
    return null;
  }

  const token = getCookie(event, AUTH_COOKIE_NAME);
  if (!token) {
    return null;
  }

  const [encodedPayload, signature] = token.split('.');
  if (!encodedPayload || !signature || !timingSafeStringEqual(signature, sign(encodedPayload, config.secret))) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as AppAuthPayload;
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp <= now || payload.sub !== config.username) {
      return null;
    }

    return payload.sub;
  } catch {
    return null;
  }
}

export function getAppAuthStatus(event: H3Event): AppAuthStatus {
  const config = getAppAuthConfig();
  if (!config.enabled) {
    return {
      enabled: false,
      configured: true,
      authenticated: true,
      username: null,
    };
  }

  const username = config.configured ? verifyAppAuthSession(event) : null;
  return {
    enabled: true,
    configured: config.configured,
    authenticated: Boolean(username),
    username,
  };
}
