// @author Codex
// @date 2026-07-14 10:49:30
// @comment 为 IndexedDB 兼容模式提供受限 HTML 到 PDF 转换接口

import { getRequestHeader } from 'h3';
import { renderHtmlToPdf } from '~/server/utils/pdf/render';

export default defineEventHandler(async event => {
  const maxBodyBytes = positiveInteger(process.env.PDF_LEGACY_MAX_BODY_BYTES, 32 * 1024 * 1024);
  const contentLength = Number(getRequestHeader(event, 'content-length') || 0);
  if (contentLength > maxBodyBytes) {
    throw createError({
      statusCode: 413,
      statusMessage: 'Payload Too Large',
      message: `PDF HTML 请求体不能超过 ${maxBodyBytes} 字节`,
    });
  }

  const html = await readBody<string>(event);
  if (!html || typeof html !== 'string') {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request', message: '请求体必须是 HTML 字符串' });
  }
  if (Buffer.byteLength(html, 'utf8') > maxBodyBytes) {
    throw createError({
      statusCode: 413,
      statusMessage: 'Payload Too Large',
      message: `PDF HTML 请求体不能超过 ${maxBodyBytes} 字节`,
    });
  }

  try {
    const pdfBuffer = await renderHtmlToPdf(html);
    setResponseHeader(event, 'Content-Type', 'application/pdf');
    return pdfBuffer;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Cannot find package 'puppeteer'")) {
      throw createError({
        statusCode: 501,
        statusMessage: 'Not Implemented',
        message: '当前部署环境不支持 PDF 导出，请使用 Docker 部署',
      });
    }
    throw error;
  }
});

function positiveInteger(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}
