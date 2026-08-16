---
title: Umami通过Vercel+Neon部署方案
published: 2026-05-07
description: 使用 Vercel 部署 Umami、Neon 托管 PostgreSQL 数据库，介绍 Prisma 7 适配、自定义域名和 Share API 展示博客 UV/PV 的配置方法。
tags: [Umami, 部署, Vercel]
category: 部署文档
draft: false
---

> [!NOTE] 提示
> 本文将 Umami 部署到 Vercel，将 PostgreSQL 数据库部署到 Neon，再通过 Share API 在博客首页展示 UV/PV。方案适用于低流量个人站点；免费额度、休眠策略和函数限制会随服务商政策变化，部署前应重新核对当前定价。

## 一、架构

```
博客用户
    │
    ▼
Cloudflare CDN (博客静态站)
    │  加载 script.js
    ▼
Vercel (Umami Next.js 应用)
    │  读写数据
    ▼
Neon (Serverless PostgreSQL)
```

| 服务 | 免费额度 | Umami 实际消耗 | 够用 |
|---|---|---|---|
| **Vercel Hobby** | 100 万次函数调用/月，100 GB-Hours | 个人博客约 1-5 万次/月 | ✅ |
| **Neon Free** | 0.5 GB 存储/项目，100 CU-hours/项目 | Umami 数据约 50-200 MB/年 | ✅ |

Cloudflare D1 基于 SQLite，Umami 仅支持 PostgreSQL，无法兼容。

---

## 二、第一步：创建 Neon 数据库

1. 访问 [neon.tech](https://neon.tech/) 注册
2. **Create Project**：
   - **Project name**：`umami`
   - **Region**：`Singapore` 或 `Tokyo`
   - **Postgres version**：默认 17
3. 进入 **Dashboard → Connection String → 选择 Prisma → 进入 .env 复制**
4. 复制 `DATABASE_URL` 连接字符串

![Neon 项目 Dashboard，复制 Prisma 连接字符串作为 DATABASE_URL](./image/others-umami-vercel-neon-deployment.assets/others-umami-vercel-neon-deployment-20260512042258.webp)

---

## 三、第二步：Fork Umami 仓库

访问 [github.com/umami-software/umami](https://github.com/umami-software/umami)，点击 **Fork**，保持默认设置。

---

## 四、第三步：确认 Prisma 7 适配

Umami 最新版使用 **Prisma 7**，`url` 和 `directUrl` 不再支持在 `schema.prisma` 中配置，已移至 `prisma.config.ts`。Umami 项目根目录已自带 `prisma.config.ts`：

```typescript
import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  datasource: {
    url: env('DATABASE_URL'),
  },
});
```

无需手动修改，只需确认 Fork 出来的版本中存在该文件。

---

## 五、第四步：部署到 Vercel

1. 访问 [vercel.com](https://vercel.com/)，GitHub 登录
2. **Add New → Project**，找到 Fork 的 `umami` 仓库，**Import**
3. 配置保持默认
4. **Environment Variables** 添加：

| Name | Value |
|---|---|
| `DATABASE_URL` | Neon 中复制的 Prisma 连接字符串 |

5. 点击 **Deploy**，等待 2-3 分钟，得到访问地址 `umami-xxxx.vercel.app`

---

## 六、第五步：首次登录和安全设置

1. 访问部署地址，默认凭据：用户名 `admin`，密码 `umami`
2. **立即修改密码**：Settings → Profile
3. 添加博客网站：主页 → Websites → Add website → 填写 Name 和 Domain
4. 进入网站看板 → 右上角 **Edit** → 复制 **Website ID**

---

## 七、第六步：绑定自定义域名

> Vercel 的 `.vercel.app` 域名在国内可能被墙，绑定自定义域名解决。

1. Vercel 项目 → Settings → Domains → 添加域名（如 `stats.yourdomain.com`）
2. Vercel 会报错。去 Cloudflare DNS 添加记录：

| Type  | Name    | Target                 | Proxy status |
| ----- | ------- | ---------------------- | ------------ |
| CNAME | `stats` | `cname.vercel-dns.com` | **关闭（灰色云朵）** |

> ⚠️ Proxy 必须关闭。Vercel 自带 CDN，开 Cloudflare Proxy 会冲突导致 SSL 问题。

3. 等待域名验证通过，Vercel 自动配置 SSL 证书
4. Vercel 显示黄色警告时点进去授权，Cloudflare 的 Target 会被自动更新
5. 验证成功

---

## 八、第七步：配置博客接入 Umami

### 1、通用接入方式

在网站 `<head>` 中添加：

```html
<script async src="https://你的Umami域名/script.js" data-website-id="你的 Website ID"></script>
```

可选参数：

| 参数 | 说明 |
|---|---|
| `data-auto-track="false"` | 禁用自动追踪，需手动调用 `umami.track()` |
| `data-do-not-track="true"` | 尊重浏览器 DNT 设置 |
| `data-domains="example.com"` | 仅在指定域名下追踪 |

### 2、本项目接入方式

本博客已内置 Umami 组件，修改 `src/config/siteConfig.ts`：

```typescript
analytics: {
    umamiAnalytics: {
        websiteId: "你的 Website ID",
        shareId: "你的 Share ID",   // 用于拉取公开统计，见第八步
        scriptUrl: "https://你的Umami域名/script.js",
        trackOutboundLinks: true,
        collectWebVitals: false,
    },
},
```

组件 `src/components/analytics/UmamiAnalytics.astro` 负责注入脚本并自动追踪出站链接点击。

---

## 九、第八步：开启 Share URL（用于公开访问 UV/PV）

> 通过 Umami 的 Share API，无需服务端鉴权即可在博客首页展示访问数据。

### 1、开启 Share URL

1. 登录 Umami 后台 → 你的网站 → 右上角 **Edit**
2. 找到 **Share URL** 选项
3. 勾选要公开的内容（推荐只勾选 **Traffic → Overview**）
4. 保存后复制生成的分享链接，格式：`https://stats.yourdomain.com/share/xxxxxxxxx`
5. 链接末尾的字符串即为 **Share ID**，填入 `siteConfig.ts` 的 `shareId` 字段

### 2、本项目获取 UV/PV 的实现

实现位于 `src/components/layout/HomeDataLayer.astro`，核心流程：

1. 从 `siteConfig.analytics.umamiAnalytics` 取出 `scriptUrl`（推导出 base url）和 `shareId`
2. 通过 `shareId` 调用 `GET /api/share/{shareId}` 获取 `websiteId` 和 `token`（1 小时缓存）
3. 用 `token` 调用 `GET /api/websites/{websiteId}/stats?startAt=0&endAt={now}`，请求头携带：
   ```
   x-umami-share-token: {token}
   x-umami-share-context: 1
   ```
4. 返回 JSON 中 `uv`/`visitors` 即访客数，`pv`/`pageviews` 即浏览量
5. 渲染到首页"站点访问"卡片

```typescript
// 核心调用逻辑（简化版）
const shareRes = await fetch(`${statsBaseUrl}/api/share/${shareId}`);
const share = await shareRes.json();
const websiteId = share.websiteId || share.entityId;
const token = share.token || shareId;

const statsRes = await fetch(
  `${statsBaseUrl}/api/websites/${websiteId}/stats?startAt=0&endAt=${Date.now()}`,
  {
    headers: {
      "x-umami-share-token": token,
      "x-umami-share-context": "1",
      "Content-Type": "application/json",
    },
  },
);
const data = await statsRes.json();
// data.uv / data.visitors → UV
// data.pv / data.pageviews → PV
```

> 不需要在本项目后端配置 Umami 的 API Token。Share URL 是 Umami 提供的公开访问入口，前端可直接调用。

### 3、直接重定向到分享页

如果只需要跳转到 Umami 公开面板，可在博客路由中直接重定向到 `https://stats.yourdomain.com/share/{shareId}`。

---

## 十、第九步：设置数据自动清理

Umami 后台 → Settings → Websites → 你的网站 → **Data retention**，建议设为 **1 年**，避免超出 Neon 0.5 GB 免费额度。

---

## 十一、更新 Umami 版本

进入 Fork 的 GitHub 仓库 → **Sync fork → Update branch**，Vercel 自动检测变更并重新部署。

---

## 十二、常见问题

| 问题 | 解决方案 |
|---|---|
| `P1012: The datasource property url is no longer supported` | Prisma 7 破坏性变更，确认 `prisma.config.ts` 已配置 `url`，`schema.prisma` 中不能有 `url`/`directUrl` |
| 国内访问 `.vercel.app` 慢/打不开 | 绑定自定义域名，Cloudflare DNS 关闭 Proxy |
| SSL 警告 `sslmode "prefer" is treated as alias for "verify-full"` | 将 `sslmode=require` 改为 `sslmode=verify-full`，不影响功能 |
| 首页 UV/PV 显示 `--` | 检查 `shareId` 是否正确、Share URL 是否开启、Umami 域名是否可访问 |
| 公开统计面板样式与别人不同 | Umami 不同版本分享页样式不同，无配置项可切换 |

---

## 十三、保存清单

| 项目 | 存放位置 |
|---|---|
| Neon 数据库密码 | Neon Dashboard → Settings → Database |
| Neon 连接字符串 | Neon Dashboard → Connection Details |
| Umami 管理员账号 | Umami 后台 → Settings → Profile |
| Website ID | Umami 后台 → Edit Website |
| Share ID | Umami 后台 → Edit Website → Share URL |
| Umami 公开数据分享链接 | Umami 后台 → Edit Website → Share URL |
| Vercel 项目地址 | Vercel Dashboard |
| Umami 自定义域名 | Vercel → Settings → Domains |

> ⚠️ 数据库密码和管理员密码不要提交到 GitHub 或公开分享。`Website ID` 和 `Share ID` 可公开，前者已在页面 HTML 中暴露，后者是 Umami 设计的公开访问凭据。
