// @author Codex
// @date 2026-07-14 14:57:46
// @comment 将文章展示 HTML 裁剪为语义化 Markdown，移除样式、微信页面控件和装饰性资源

import * as cheerio from 'cheerio';
import TurndownService from 'turndown';

const PRESENTATION_SELECTORS = [
  'style',
  'script',
  'noscript',
  'template',
  'iframe',
  'frame',
  'object',
  'embed',
  'applet',
  'svg',
  'link[rel~="stylesheet"]',
  'meta',
  'mp-style-type',
  '.__bottom-bar__',
  '#js_article_bottom_bar',
  '.js_temp_bottom_bar',
  '#js_temp_bottom_area',
  '#content_bottom_area',
  '#js_pc_qr_code',
  '#js_top_ad_area',
  '#js_tags_preview_toast',
  '#wx_stream_article_slide_tip',
].join(',');

const AD_MARKER_PATTERN = /^[-—－\s]*广告[-—－\s]*$/;

export function htmlToMarkdown(html: string): string {
  const $ = cheerio.load(html);

  $(PRESENTATION_SELECTORS).remove();
  removeStandaloneAdMarkers($);
  normalizeImages($);

  const content = $('body').html() || $.root().html() || '';
  return new TurndownService().turndown(content).trim();
}

function removeStandaloneAdMarkers($: cheerio.CheerioAPI): void {
  $('section, div, p').each((_, element) => {
    const node = $(element);
    const text = node
      .text()
      .replace(/[\s\u00A0]+/g, ' ')
      .trim();
    if (AD_MARKER_PATTERN.test(text) && node.find('a, img, picture, video, audio').length === 0) {
      node.remove();
    }
  });
}

function normalizeImages($: cheerio.CheerioAPI): void {
  $('img').each((_, element) => {
    const image = $(element);
    const source = image.attr('src') || image.attr('data-src');
    if (!source || source.trim().toLowerCase().startsWith('data:')) {
      image.remove();
      return;
    }
    image.attr('src', source);
    image.removeAttr('data-src').removeAttr('srcset').removeAttr('data-srcset');
  });
}
