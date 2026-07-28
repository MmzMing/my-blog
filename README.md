# Firefly-Mod

> 基于 [Firefly](https://github.com/CuteLeaf/Firefly) 的个人博客魔改版 `V2.6.2`

![Node.js >= 22](https://img.shields.io/badge/node.js-%3E%3D22-brightgreen)
![pnpm >= 9](https://img.shields.io/badge/pnpm-%3E%3D9-blue)
![Astro](https://img.shields.io/badge/Astro-6.x-orange)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)
![Svelte](https://img.shields.io/badge/Svelte-5.x-%23FF3E00)
![Tailwind CSS](https://img.shields.io/badge/Tailwind%20CSS-4.x-%2306B6D4)
![Biome](https://img.shields.io/badge/Biome-2.x-%2360A5FA)
![Swup](https://img.shields.io/badge/Swup-4.x-%237467EF)
![Pagefind](https://img.shields.io/badge/Pagefind-1.x-%234B5563)

PC端

<img alt="博客预览" src="./docs/images/image.webp" />

新能测试

<img alt="博客预览移动端" src="./docs/images/image-2.webp" />



## 项目概述

Firefly-Mod 是从 [Firefly](https://github.com/CuteLeaf/Firefly) 分支出的个性化魔改版本，已脱离原分支独立演进。

基于 Firefly 魔改新增以下特性：

- 重构整体UI，黑白简约风格，组件可交互为主，删除背景图片。
- 首页更偏向于展示个人能力爱好，不展示最新文章，删除侧边栏。
- 新增 AI 语义搜索（RAG）功能，基于 Cloudflare Vectorize 向量索引。
- QQ 群聊风格留言板，直接复用 Waline 登录、审核与评论数据，不依赖项目 Worker 或 KV。
- 新增日历页面，展示文章发布时间。
- 关于页面，注重交互。
- 删除动漫这些影响构建速度的功能。
- 文章分类更注重视觉排版分类。

## 常用命令

| 用途 | 命令 |
|------|------|
| 安装依赖 | `pnpm install` |
| 开发服务器 | `pnpm dev` |
| 构建 | `pnpm build` |
| 预览构建产物 | `pnpm preview` |
| Astro 类型检查 | `pnpm check` |
| TypeScript 类型检查 | `pnpm type-check` |
| 格式化代码 | `pnpm format` |
| Lint + 自动修复 | `pnpm lint` |
| 新建博客文章 | `pnpm new-post <filename>` |
| 重新生成图标 | `pnpm icons` |
| 构建/更新 AI 向量索引 | `pnpm build-index` |

## AI 搜索向量索引
```bash
# 配置好.env文件后，执行以下命令：

# 登录 Cloudflare（需要先删掉CLOUDFLARE_API_TOKEN环境变量）
npx wrangler login

# 构建/更新 AI 搜索向量索引（增量）（登录后需要配置CLOUDFLARE_API_TOKEN环境变量）
pnpm build-index

# 强制全量重建 AI 搜索向量索引（登录后需要配置CLOUDFLARE_API_TOKEN环境变量）
pnpm build-index -- --force
```

## 配置系统

所有配置集中在 `src/config/`，通过 `@/config`（barrel 文件 `index.ts` 统一导出）导入。

| 配置文件 | 职责 |
|----------|------|
| `siteConfig.ts` | 核心配置：语言、主题色、页面开关、文章列表布局、分页、分析、图片优化、字体 |
| `sidebarConfig.ts` | 侧边栏布局与组件配置 |
| `navBarConfig.ts` | 导航栏链接配置（根据页面开关动态生成） |
| `homeConfig.ts` | 首页与用户资料配置：头像、昵称、签名、社交链接、首页图片、技能图标、作品百叶窗 |
| `commentConfig.ts` | 评论系统配置（Waline/Twikoo/Giscus/Artalk/Disqus） |
| `musicConfig.ts` | 音乐播放器配置（Meting API / 本地音乐） |
| `pioConfig.ts` | Live2D / Spine 看板娘配置 |
| `fontConfig.ts` | 自定义字体配置 |
| `galleryConfig.ts` | 相册配置 |
| `friendsConfig.ts` | 友链配置 |
| `sponsorConfig.ts` | 赞助页配置 |
| `calendarConfig.ts` | 日历页面配置 |
| `announcementConfig.ts` | 公告栏配置 |
| `licenseConfig.ts` | 文章许可证配置 |
| `footerConfig.ts` | 页脚配置 |
| `coverImageConfig.ts` | 封面图配置 |
| `expressiveCodeConfig.ts` | 代码块渲染配置 |
| `plantumlConfig.ts` | PlantUML 配置 |
| `collectionsApiConfig.ts` | 收藏 API 配置 |
| `aiSearchConfig.ts` | AI 搜索配置（模型、Embedding、向量索引） |

## CI/CD 工作流

| 工作流 | 触发条件 | 说明 |
|--------|----------|------|
| `ci.yml` | push/PR 到 master | Astro 类型检查 + Biome Lint 代码质量检查 |
| `cron-check.yml` | 每日 08:00 + 手动触发 | 友链可达性巡检，使用 Playwright 逐个访问，异常自动创建 Issue 报告 |
| `friend-link-checker.yml` | Issue 创建/评论 | 通过 Issue 自动处理友链申请，提取信息并提交 PR |
| `claude.yml` | Issue/PR 评论、Issue 创建、PR Review | 提及 `@claude` 时触发 AI 响应 |
| `claude-review.yml` | PR 创建/更新 | 自动进行 AI 代码审查 |

注意：建议在 GitHub 仓库设置中关闭邮箱订阅，避免 CI 工作流频繁触发邮件通知。

## 部署清单

粗略编写了一下部署清单，包括以下内容：
如果有缺失的，请在 Issue 中报告。

| 检查项 | 说明 |
|--------|------|
| 托管平台 | 支持任何静态托管：Cloudflare Pages、Vercel、Netlify、GitHub Pages、Nginx 等 |
| 评论服务 | 若启用评论，需自行部署对应后端（Waline / Twikoo / Artalk 等） |
| 留言板 | 留言板固定使用 Waline `/guestbook/` 频道；启用前需在 `src/config/commentConfig.ts` 中配置 Waline，无需 Cloudflare KV 或项目 Worker 路由 |
| 统计服务 | 站点访问统计通过 Umami 获取（`siteConfig.ts` 中配置 `analytics.umamiAnalytics`，Worker 中配置 `UMAMI_TOKEN` Secret） |
| AI 搜索 | 需 Cloudflare Vectorize 索引；构建索引需 `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`；LLM/Embedding 默认走 Workers AI，也可在 `aiSearchConfig.ts` 中配置第三方 API（如魔搭社区）并设置 `AI_API_KEY` |
| 图片上传（可选） | 留言板默认将不超过 128 KB 的图片内嵌到 Waline 留言；如需上传不超过 5 MB 的图片，可在 `commentConfig.waline.imageUploadURL` 中配置兼容的自建上传接口。文章图片仍建议使用独立图床 |

## Cloudflare Pages 部署方案

因为是魔改[Firefly](https://github.com/CuteLeaf/Firefly)，所以部署方案与 Firefly 相同。

其他与 Firefly 相同，除了以下几点：

创建 AI 搜索向量索引：
   - 索引名称需与 `src/config/aiSearchConfig.ts` 中的 `indexName` 一致（默认 `blog-ai-search`）
   - 使用 wrangler 创建：`wrangler vectorize create --name blog-ai-search --dimensions 1024 --metric cosine`

## Live2D 版权声明

Live2D 模型作者为 B 站用户 [木果阿木果](https://space.bilibili.com/886695)，使用需遵守以下规则：

- 使用前必须征得作者同意
- 必须标明作者信息和来源地址
- 模型设计版权归属库洛
- 模型可用于鸣潮相关视频和直播（需标注来源）
- 禁止商用盈利，禁止二次上传转载引流

## 灵感项目

- [fuwari](https://github.com/saicaca/fuwari)
- [hexo-theme-shoka](https://github.com/amehime/hexo-theme-shoka)
- [astro-koharu](https://github.com/cosZone/astro-koharu)
- [Mizuki](https://github.com/matsuzaka-yuki/Mizuki)

## 许可协议

最初 Fork 自 [saicaca/fuwari](https://github.com/saicaca/fuwari)。

**版权声明：**

- Copyright (c) 2024 [saicaca](https://github.com/saicaca) - [fuwari](https://github.com/saicaca/fuwari)
- Copyright (c) 2025 [CuteLeaf](https://github.com/CuteLeaf) - [Firefly](https://github.com/CuteLeaf/Firefly)

根据 MIT 开源协议，可自由使用、修改、分发代码，但需保留上述版权声明。
