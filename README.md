<p align="center">
  <img src="./assets/logo.svg" alt="Logo">
</p>

# wechat-article-exporter

![GitHub stars]
![GitHub forks]
![GitHub License]
![Package Version]


一款在线的 **微信公众号文章批量下载** 工具，支持导出阅读量与评论数据，无需搭建任何环境，可通过 [在线网站] 使用，同时也支持 docker 私有化部署和 Cloudflare 部署。

支持下载各种文件格式，其中 HTML 格式可100%还原文章排版与样式。

> [!TIP]
> **想要更稳定、更省心的开箱体验？** 试试本项目的商业版 —— **[公号三刀 →](https://wechat.zoro.build)**
> 自带高速抓取通道，**无需自建代理、也不用抢公共节点的每日额度**，注册即用；功能更全、更新更及时。

交流群(QQ):
- `494723496`

## :bell: 重要告知：项目域名调整
项目域名调整如下：

|     | 下载站                            | 文档站                        |
|-----|--------------------------------|----------------------------|
| 调整后 | https://down.mptext.top        | https://docs.mptext.top    |
| 调整前 | https://exporter.wxdown.online | https://docs.wxdown.online |

具体细节可以查看 [这里](https://docs.mptext.top/misc/domain.html)。


## :books: 如何使用？

该工具的使用教程已移至 [文档站点](https://docs.mptext.top)。

### 私有化访问登录

私有化部署到公网时建议开启应用登录认证，避免任何人直接访问页面或服务端 API：

```env
APP_AUTH_ENABLED=true
APP_AUTH_USERNAME=admin
APP_AUTH_PASSWORD=change-me
APP_AUTH_SESSION_TTL_SECONDS=604800
APP_AUTH_COOKIE_SECURE=false
```

Docker compose 默认启用认证；如果未配置账号或密码，应用会进入登录页并提示认证未配置，不会放开访问。

### Credentials 服务远程访问

评论、阅读量等能力依赖浏览器直接连接 Credentials 采集服务。公网部署时，不能让前端继续连接 `127.0.0.1`，否则远程浏览器会访问用户自己电脑的本地端口。

```env
# 默认自动判断：localhost / 127.0.0.1 / 内网 IP 访问时走本机服务；公网域名访问时走这个 host。
NUXT_PUBLIC_CREDENTIAL_PUBLIC_HOST=http://home.mohe.ai

# 如果你的 Credentials 服务没有和上面的 host 复用同一入口，可以强制指定完整地址：
#NUXT_PUBLIC_CREDENTIAL_API_HOST=https://home.mohe.ai:65000
#NUXT_PUBLIC_CREDENTIAL_WS_URL=wss://home.mohe.ai:65001
```

如果通过反向代理收敛端口，也可以把强制地址配置成类似 `https://home.mohe.ai/wxdown-api` 和 `wss://home.mohe.ai/wxdown-ws`。这两个地址必须能被访问页面的浏览器直接访问。

### PostgreSQL + MinIO 持久化缓存

默认仍使用浏览器 IndexedDB。私有化长期运行时可以开启服务端持久化缓存：

```env
STORAGE_DRIVER=postgres-minio
DATABASE_URL=postgres://postgres:postgres@postgres:5432/wechat_article_exporter
MINIO_ENDPOINT=minio
MINIO_PORT=9000
MINIO_USE_SSL=false
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_BUCKET=wechat-article-exporter
MINIO_REGION=us-east-1
```

开启后，PostgreSQL 保存公众号、文章、下载状态、评论、阅读量和对象索引；MinIO 保存 HTML、图片、CSS、音视频等 Blob 内容。未配置完整环境变量时会自动回退到 IndexedDB。


## :dart: 特性

- [x] 搜索公众号，支持关键字搜索
- [x] 支持导出 html/json/excel/txt/md/docx 格式(html 格式打包了图片和样式文件，能够保证100%还原文章样式)
- [x] 缓存文章列表数据，减少接口请求次数
- [x] 支持文章过滤，包括作者、标题、发布时间、原创标识、所属合集等
- [x] 支持合集下载
- [x] 支持图片分享消息
- [x] 支持视频分享消息
- [x] 支持导出评论、评论回复、阅读量、转发量等数据 (需要抓包获取 credentials 信息，[查看操作步骤](https://docs.mptext.top/advanced/wxdown-service.html))
- [x] 支持 Docker 部署
- [x] 支持 Cloudflare 部署
- [x] 开放 API 接口


## :heart: 感谢

- 感谢 [Deno Deploy]、[Cloudflare Workers] 提供免费托管服务
- 感谢 [WeChat_Article] 项目提供原理思路


## :star: 支持

如果你觉得本项目帮助到了你，请给作者一个免费的 Star，感谢你的支持！


## :bulb: 原理

在公众号后台写文章时支持搜索其他公众号的文章功能，以此来实现抓取指定公众号所有文章的目的。


## :memo: 许可

MIT

## :red_circle: 声明

本程序承诺，不会利用您扫码登录的公众号进行任何形式的私有爬虫，也就是说不存在把你的账号作为公共账号为别人爬取文章的行为，也不存在类似账号池的东西。

您的公众号只会服务于您自己的抓取文章的目的。

通过本程序获取的公众号文章内容，版权归文章原作者所有，请合理使用。若发现侵权行为，请联系我们处理。


## :chart_with_upwards_trend: Star 历史

[![Star History Chart]][Star History Chart Link]



<!-- Definitions -->

[GitHub stars]: https://img.shields.io/github/stars/wechat-article/wechat-article-exporter?style=social&label=Star&style=plastic

[GitHub forks]: https://img.shields.io/github/forks/wechat-article/wechat-article-exporter?style=social&label=Fork&style=plastic

[GitHub License]: https://img.shields.io/github/license/wechat-article/wechat-article-exporter?label=License

[Package Version]: https://img.shields.io/github/package-json/v/wechat-article/wechat-article-exporter


[Deno Deploy]: https://deno.com/deploy

[Cloudflare Workers]: https://workers.cloudflare.com

[Wechat_Article]: https://github.com/1061700625/WeChat_Article

[Star History Chart]: https://api.star-history.com/svg?repos=wechat-article/wechat-article-exporter&type=Timeline

[Star History Chart Link]: https://star-history.com/#wechat-article/wechat-article-exporter&Timeline

[在线网站]: https://down.mptext.top
