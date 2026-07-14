// @author Codex
// @date 2026-07-07 14:44:30
// @comment 从微信文章 HTML 脚本片段中安全提取数据字面量，避免执行 eval

import type { VideoPageInfo, VideoTransInfo } from '~/types/video';

export interface QmtplSsrData {
  title?: string;
  desc?: string;
  [key: string]: unknown;
}

export interface IpWordingConfig {
  countryId?: string | number;
  countryName?: string;
  provinceName?: string;
  [key: string]: unknown;
}

export interface PicturePageInfo {
  cdn_url?: string;
  [key: string]: unknown;
}

export type MpVideoTransInfo = VideoTransInfo & {
  [key: string]: unknown;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function readStringLiteral(source: string, start: number): { value: string; end: number } | null {
  const quote = source[start];
  if (quote !== "'" && quote !== '"') {
    return null;
  }

  let value = '';
  for (let index = start + 1; index < source.length; index++) {
    const char = source[index];
    if (char === quote) {
      return {
        value,
        end: index + 1,
      };
    }
    if (char !== '\\') {
      value += char;
      continue;
    }

    const next = source[++index];
    if (next === undefined) {
      value += '\\';
      break;
    }

    if (next === 'x') {
      const hex = source.slice(index + 1, index + 3);
      if (/^[\da-f]{2}$/i.test(hex)) {
        value += String.fromCharCode(parseInt(hex, 16));
        index += 2;
      } else {
        value += next;
      }
      continue;
    }

    if (next === 'u') {
      if (source[index + 1] === '{') {
        const endBrace = source.indexOf('}', index + 2);
        const hex = endBrace === -1 ? '' : source.slice(index + 2, endBrace);
        if (/^[\da-f]+$/i.test(hex)) {
          value += String.fromCodePoint(parseInt(hex, 16));
          index = endBrace;
          continue;
        }
      }

      const hex = source.slice(index + 1, index + 5);
      if (/^[\da-f]{4}$/i.test(hex)) {
        value += String.fromCharCode(parseInt(hex, 16));
        index += 4;
      } else {
        value += next;
      }
      continue;
    }

    const escaped: Record<string, string> = {
      b: '\b',
      f: '\f',
      n: '\n',
      r: '\r',
      t: '\t',
      v: '\v',
      0: '\0',
      '\\': '\\',
      "'": "'",
      '"': '"',
    };
    if (next === '\n' || next === '\r') {
      continue;
    }
    value += escaped[next] ?? next;
  }

  return null;
}

export function parseWechatStringLiteral(literal: string | undefined): string | null {
  if (!literal) {
    return null;
  }

  return readStringLiteral(literal.trim(), 0)?.value ?? null;
}

function extractBalancedLiteral(source: string, start: number): string | null {
  const open = source[start];
  const close = open === '{' ? '}' : open === '[' ? ']' : '';
  if (!close) {
    return null;
  }

  let depth = 0;
  for (let index = start; index < source.length; index++) {
    const char = source[index];
    if (char === "'" || char === '"') {
      const parsed = readStringLiteral(source, index);
      if (!parsed) {
        return null;
      }
      index = parsed.end - 1;
      continue;
    }
    if (char === open) {
      depth++;
    } else if (char === close) {
      depth--;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }

  return null;
}

function findLiteralsAfterAssignments(html: string, assignmentName: string): string[] {
  const assignmentPattern = new RegExp(`${escapeRegExp(assignmentName)}\\s*=`, 'g');
  const literals: string[] = [];

  for (const match of html.matchAll(assignmentPattern)) {
    let index = (match.index ?? 0) + match[0].length;
    while (/\s/.test(html[index] || '')) {
      index++;
    }

    if (html[index] === "'" || html[index] === '"') {
      const parsed = readStringLiteral(html, index);
      if (parsed) {
        literals.push(html.slice(index, parsed.end));
      }
      continue;
    }

    const literal = extractBalancedLiteral(html, index);
    if (literal) {
      literals.push(literal);
    }
  }

  return literals;
}

function findLiteralAfterAssignment(html: string, assignmentName: string): string | null {
  return findLiteralsAfterAssignments(html, assignmentName)[0] ?? null;
}

function normalizeJsLiteralToJson(literal: string): string {
  let jsonLike = '';
  for (let index = 0; index < literal.length; index++) {
    const char = literal[index];
    if (char === "'" || char === '"') {
      const parsed = readStringLiteral(literal, index);
      if (!parsed) {
        throw new Error('Invalid string literal');
      }
      jsonLike += JSON.stringify(parsed.value);
      index = parsed.end - 1;
      continue;
    }
    jsonLike += char;
  }

  return jsonLike
    .replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')
    .replace(/:\s*"(-?\d+(?:\.\d+)?)"\s*\*\s*1/g, ':$1')
    .replace(/:\s*undefined\b/g, ':null')
    .replace(/:\s*void\s+0\b/g, ':null')
    .replace(/,\s*([}\]])/g, '$1');
}

function tryParseWechatDataLiteral<T>(literal: string): { value: T } | { error: unknown } {
  try {
    return { value: JSON.parse(normalizeJsLiteralToJson(literal)) as T };
  } catch (error) {
    return { error };
  }
}

export function parseWechatDataLiteral<T>(literal: string | null | undefined): T | null {
  if (!literal) {
    return null;
  }

  const result = tryParseWechatDataLiteral<T>(literal);
  if ('value' in result) {
    return result.value;
  }

  console.warn('微信脚本数据解析失败:', result.error);
  return null;
}

export function parseWechatAssignment<T>(html: string, assignmentName: string): T | null {
  for (const literal of findLiteralsAfterAssignments(html, assignmentName)) {
    const result = tryParseWechatDataLiteral<T>(literal);
    if ('value' in result) {
      return result.value;
    }
  }

  return null;
}

export function parseWechatStringAssignment(html: string, assignmentName: string): string | null {
  return parseWechatStringLiteral(findLiteralAfterAssignment(html, assignmentName) || undefined);
}

export function parseWechatFallbackStringAssignment(html: string, variableName: string): string | null {
  const match = new RegExp(
    `var\\s+${escapeRegExp(variableName)}\\s*=\\s*window\\.a_value_which_never_exists\\s*\\|\\|\\s*(?<literal>['"])`,
    's'
  ).exec(html);
  if (!match || !match.groups?.literal) {
    return null;
  }

  const literalStart = match.index + match[0].length - 1;
  return parseWechatStringLiteral(readStringLiteral(html, literalStart) ? html.slice(literalStart) : undefined);
}

export function parseQmtplSsrData(html: string): QmtplSsrData | null {
  return parseWechatAssignment<QmtplSsrData>(html, 'window.__QMTPL_SSR_DATA__');
}

export function parseIpWordingConfig(html: string): IpWordingConfig | null {
  return parseWechatAssignment<IpWordingConfig>(html, 'window.ip_wording');
}

export function parsePicturePageInfoList(html: string): PicturePageInfo[] {
  return parseWechatAssignment<PicturePageInfo[]>(html, 'window.picture_page_info_list') || [];
}

export function parseMpVideoCoverUrl(html: string): string {
  return parseWechatStringAssignment(html, 'window.__mpVideoCoverUrl') || '';
}

export function parseMpVideoTransInfo(html: string): MpVideoTransInfo[] {
  return parseWechatAssignment<MpVideoTransInfo[]>(html, 'window.__mpVideoTransInfo') || [];
}

export function parseVideoPageInfos(html: string): VideoPageInfo[] {
  return parseWechatAssignment<VideoPageInfo[]>(html, 'var videoPageInfos') || [];
}
