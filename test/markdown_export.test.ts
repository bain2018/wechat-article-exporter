import assert from 'node:assert/strict';
import { test } from 'node:test';
import { htmlToMarkdown } from '../shared/utils/markdown.ts';

test('Markdown export removes presentation CSS and WeChat page chrome', () => {
  const markdown = htmlToMarkdown(`<!doctype html>
    <html>
      <head>
        <style>.title { color: red; }</style>
        <link rel="stylesheet" href="article.css">
      </head>
      <body>
        <main class="__page_content__">
          <h1>文章标题</h1>
          <section class="item_show_type_0">
            <p>正文内容</p>
            <img data-src="https://mmbiz.qpic.cn/article.png" alt="正文图片">
            <section><span>-广告-</span></section>
            <p style="display: none"><mp-style-type data-value="10000"></mp-style-type></p>
          </section>
          <div class="__bottom-bar__">
            <img src="data:image/svg+xml,%3Csvg%3E%3C/svg%3E" alt="操作图标">
            <span>公众号名称</span>
            <button>阅读</button>
          </div>
        </main>
        <div id="js_article_bottom_bar">点赞 分享 推荐 留言</div>
      </body>
    </html>`);

  assert.match(markdown, /文章标题/);
  assert.match(markdown, /正文内容/);
  assert.match(markdown, /!\[正文图片\]\(https:\/\/mmbiz\.qpic\.cn\/article\.png\)/);
  assert.doesNotMatch(markdown, /\.title|color:\s*red|article\.css/);
  assert.doesNotMatch(markdown, /广告|公众号名称|阅读|点赞|分享|推荐|留言/);
  assert.doesNotMatch(markdown, /data:image|svg/);
});
