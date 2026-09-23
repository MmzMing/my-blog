# CLAUDE.md — 企业级代码规范

> 本文件是项目最高优先级的架构规范。所有代码修改必须遵守以下规则。

---

## 一、常用命令

| 用途 | 命令 |
|---|---|
| 开发服务器 (localhost:4321) | `pnpm dev` |
| 构建到 `./dist/` | `pnpm build`（图标生成 → astro build → pagefind） |
| 预览构建产物 | `pnpm preview` |
| 类型检查 | `pnpm check`（astro check）或 `pnpm type-check`（tsc --noEmit） |
| 格式化代码 | `pnpm format`（biome format --write ./src） |
| Lint + 自动修复 | `pnpm lint`（biome check --write ./src） |
| 新建博客文章 | `pnpm new-post <filename>` |
| 重新生成图标 | `pnpm icons` |

强制使用 pnpm（通过 `preinstall` 脚本限制）。要求 Node.js ≥ 22，pnpm ≥ 9。

---

## 二、技术栈

**核心**：Astro 6.x（SSG 静态站点）、Svelte 5、Tailwind CSS 4、TypeScript。

**工具链**：Biome 格式化/Lint、Swup v4 页面过渡、Pagefind 客户端搜索。

---

## 三、CSS 架构规范（强制）

### 3.1 核心原则

> **禁止在 `.astro` 和 `.svelte` 组件中编写 `<style>` 块。**
> 所有样式必须集中在 `src/styles/` 目录下管理。

**原因**：
1. **Swup 兼容性**：`<style>` 块在 Swup 容器替换时可能丢失或重复，导致样式闪烁。
2. **可维护性**：分散在 55+ 文件中的 63 个 `<style>` 块极难维护和调试。
3. **一致性**：集中管理确保命名规范、主题变量、响应式断点的统一。
4. **性能**：`cssCodeSplit: false` 配置下，所有 CSS 最终合并为一个文件，集中管理更高效。

### 3.2 目录结构

```
src/styles/
├── main.css                    # 入口文件，统一导入所有样式
├── variables.styl              # 设计令牌（CSS 自定义属性）
├── markdown-extend.styl        # Markdown 扩展样式
│
├── base/                       # 基础层
│   ├── reset.css               # 浏览器重置
│   ├── typography.css          # 排版基础
│   └── animations.css          # 全局动画关键帧
│
├── layout/                     # 布局层
│   ├── grid.css                # 主网格布局（#main-grid）
│   ├── navbar.css              # 导航栏
│   ├── nav-menu-panel.css      # 移动端抽屉菜单
│   ├── dropdown-menu.css       # 下拉菜单
│   ├── footer.css              # 页脚
│   ├── sidebar.css             # 侧边栏
│   └── waves.css               # 头部波浪效果
│
├── components/                 # 组件层
│   ├── post-card.css           # 文章卡片
│   ├── post-page.css           # 文章列表页
│   ├── widget-layout.css       # 侧边栏组件容器
│   ├── floating-dock.css       # 浮动工具栏
│   ├── floating-button.css     # 浮动按钮
│   ├── cover-image.css         # 封面图
│   ├── pagination.css          # 分页（含客户端分页）
│   ├── button-tag.css          # 标签按钮
│   ├── typewriter.css          # 打字机效果
│   ├── music-player.css        # 音乐播放器
│   ├── floating-lyrics.css     # 浮动歌词
│   ├── live2d-widget.css       # Live2D 模型
│   ├── friend-card.css         # 友链卡片
│   ├── home-hero.css           # 首页英雄区
│   ├── home-portal.css         # 首页个人资料区
│   ├── guestbook.css           # 留言板（含所有模态框）
│   ├── privacy-modal.css       # 隐私政策弹窗
│   ├── friend-rules-modal.css  # 友链规则弹窗
│   └── search-modal.css        # 搜索弹窗
│
├── widgets/                    # 侧边栏组件层
│   ├── site-stats.css          # 站点统计
│   ├── calendar.css            # 日历
│   ├── archive-heatmap.css     # 归档热力图
│   ├── advertisement.css       # 广告位
│   ├── sidebar-toc.css         # 侧边栏目录
│   └── terrarium-model.css     # 生态缸模型
│
├── pages/                      # 页面层
│   ├── sponsor.css             # 赞助页
│   ├── friends.css             # 友链页
│   ├── gallery.css             # 相册页（含相册详情）
│   ├── bangumi.css             # 追番页（含 TabNav）
│   ├── 404.css                 # 404 页
│   └── guestbook-page.css      # 留言板页
│
├── vendors/                    # 第三方样式
│   ├── transition.css          # Swup 过渡动画
│   ├── custom-scrollbar.css    # 自定义滚动条
│   ├── expressive-code.css     # 代码块样式
│   ├── toc.css                 # 目录导航
│   ├── collections.css         # 内容集合
│   ├── markdown.css            # Markdown 渲染
│   └── rehype-callouts.css     # 提示框样式
│
└── utils/                      # 工具层
    ├── theme-transition.css    # 主题切换过渡
    ├── responsive.css          # 响应式断点工具
    └── scrollbar.css           # OverlayScrollbars
```

### 3.3 样式导入顺序

`main.css` 中必须按以下顺序导入（层级从基础到具体）：

```css
/* 1. 框架 */
@import "tailwindcss";

/* 2. 设计令牌 */
/* variables.styl 通过 Layout.astro 导入 */

/* 3. 基础层 */
@import "./base/reset.css";
@import "./base/typography.css";
@import "./base/animations.css";

/* 4. 布局层 */
@import "./layout/grid.css";
@import "./layout/navbar.css";
@import "./layout/nav-menu-panel.css";
@import "./layout/dropdown-menu.css";
@import "./layout/footer.css";
@import "./layout/sidebar.css";
@import "./layout/waves.css";

/* 5. 组件层 */
@import "./components/post-card.css";
/* ... 其他组件 */

/* 6. 侧边栏组件层 */
@import "./widgets/site-stats.css";
/* ... 其他侧边栏组件 */

/* 7. 页面层 */
@import "./pages/sponsor.css";
/* ... 其他页面 */

/* 8. 第三方样式 */
@import "./vendors/transition.css";
/* ... 其他第三方 */

/* 9. 工具层 */
@import "./utils/theme-transition.css";
```

### 3.4 命名规范

**BEM 命名法**（Block__Element--Modifier）：

```css
/* Block */
.post-card { }

/* Element */
.post-card__title { }
.post-card__cover { }
.post-card__meta { }

/* Modifier */
.post-card--grid { }
.post-card--list { }
.post-card--pinned { }

/* 状态类（kebab-case，无 BEM 前缀） */
.is-active { }
.is-expanded { }
.is-loading { }
.is-hidden { }
```

**例外**：
- 已有的全局类名（如 `.card-base`、`.btn-plain`、`.link`）保持不变，避免破坏性变更。
- Swup 相关类名（`.transition-swup-main`、`.is-leaving`、`.is-rendering`）由框架控制，不适用 BEM。
- Tailwind 工具类直接使用，不嵌套在 BEM 中。

### 3.5 主题变量使用

**必须使用 `variables.styl` 中定义的 CSS 自定义属性**，禁止硬编码颜色值：

```css
/* ✅ 正确 */
.post-card {
  background: var(--card-bg);
  color: var(--deep-text);
  border-color: var(--line-divider);
}

/* ❌ 错误 */
.post-card {
  background: #ffffff;
  color: #333333;
  border-color: rgba(0, 0, 0, 0.1);
}
```

### 3.6 响应式规范

使用 `variables.styl` 中定义的断点变量，禁止硬编码断点值：

```css
/* ✅ 正确 — 使用容器查询或变量 */
@media (max-width: 768px) { }  /* 已有约定 */

/* ❌ 错误 — 魔法数字 */
@media (max-width: 767px) { }
@media (min-width: 1234px) { }
```

### 3.7 Scoped vs Global 样式

| 场景 | 使用方式 | 理由 |
|---|---|---|
| 组件内部样式 | 默认 scoped（Astro 自动） | 避免样式污染 |
| 需要影响子组件 | `:global()` 选择器 | 限定作用域 |
| 全局工具类 | 独立 CSS 文件在 `main.css` 导入 | 统一管理 |
| Swup 容器内样式 | 必须 global 或在 `<head>` | 防止容器替换丢失 |

**关键规则**：在 `src/styles/` 中编写的样式天然就是 global 的（通过 `main.css` 导入），这正是 Swup 所需的行为。

---

## 四、Swup 页面过渡规范（强制）

### 4.1 容器架构

```
┌─ Layout.astro (OUTSIDE Swup) ─────────────────────────────┐
│  <head> — 所有 CSS 在此加载，Swup 不替换                    │
│  <body>                                                     │
│  ┌─ MainGridLayout.astro ─────────────────────────────────┐ │
│  │  #top-row (OUTSIDE) — Navbar                           │ │
│  │  NavMenuPanel (OUTSIDE) — 移动端抽屉                    │ │
│  │  #main-grid-wrapper (OUTSIDE)                          │ │
│  │  ┌─ #main-grid ────────────────────────────────────┐   │ │
│  │  │  #left-sidebar-dynamic [SWUP CONTAINER] 占位    │   │ │
│  │  │  #right-sidebar-dynamic [SWUP CONTAINER] 占位   │   │ │
│  │  │  ┌─ #swup-container [SWUP CONTAINER] ────────┐ │   │ │
│  │  │  │  article-toc-wrapper (仅文章页)             │ │   │ │
│  │  │  │  CategoryBar (条件渲染)                     │ │   │ │
│  │  │  │  HomeHero + HomePortal (仅首页)             │ │   │ │
│  │  │  │  #content-wrapper > <slot />               │ │   │ │
│  │  │  │  Footer                                   │ │   │ │
│  │  │  └─────────────────────────────────────────────┘ │   │ │
│  │  │  SpineModel (OUTSIDE swup-container)             │   │ │
│  │  │  Live2DWidget (OUTSIDE swup-container)           │   │ │
│  │  └──────────────────────────────────────────────────┘   │ │
│  │  FloatingDock (OUTSIDE) — 固定定位                      │ │
│  │  AISearch / SearchModal / PrivacyModal (OUTSIDE)        │ │
│  └─────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

### 4.2 容器规则

**必须在 Swup 容器外的组件**（持久化，不随页面替换）：
- Navbar、NavMenuPanel — 全局导航，跨页面保持
- FloatingDock — 固定工具栏
- AISearch、SearchModal、PrivacyModal — 全局模态框
- MusicManager、FloatingLyrics — 全局播放器
- SpineModel、Live2DWidget — 全局装饰模型
- ConfigCarrier — 配置传递
- FancyboxManager — 图片查看器

**必须在 Swup 容器内的内容**（随页面替换）：
- 页面主体内容（`<slot />`）
- Footer — 每页可能不同
- 文章目录（article-toc-wrapper） — 仅文章页
- HomeHero、HomePortal — 仅首页
- CategoryBar — 条件渲染

### 4.3 CSS 加载策略

**所有 CSS 必须在 `<head>` 中加载**，确保 Swup 容器替换时样式不丢失：

```astro
---
// Layout.astro — 所有全局样式在此导入
import "@/styles/main.css";
import "@/styles/variables.styl";
import "@/styles/markdown-extend.styl";
---
```

**Astro 的 CSS 行为**：无论 `import` 语句写在哪个组件中，Astro 都会将 CSS 放入 `<head>`。但为了架构清晰，所有样式导入应集中在 `Layout.astro` 和 `MainGridLayout.astro` 中。

**`astro.config.mjs` 关键配置**：
```js
cssCodeSplit: false,  // 所有 CSS 合并为一个文件，防止页面切换丢失样式
```

### 4.4 Swup 事件监听规范

**推荐事件**：`astro:page-load`（由 `@swup/astro` 桥接触发，每次导航触发一次）

```javascript
// ✅ 正确 — 使用 astro:page-load
document.addEventListener("astro:page-load", () => {
  // 初始化/重新初始化逻辑
});

// ❌ 错误 — 同时监听多个事件导致重复执行
document.addEventListener("swup:contentReplaced", handler);
document.addEventListener("swup:page:view", handler);
document.addEventListener("astro:page-load", handler);
```

**事件选择指南**：

| 事件 | 用途 | 触发时机 |
|---|---|---|
| `astro:page-load` | **首选**。组件初始化/重新初始化 | 每次导航完成（含首次加载） |
| `swup:contentReplaced` | 需要在 DOM 替换后立即执行 | Swup 替换容器内容后 |
| `swup:page:view` | 需要在页面视图更新时执行 | 页面视图更新后 |
| `window.swup.hooks.on(...)` | 需要精细控制生命周期 | 指定的 Swup 钩子 |

**Layout.astro 中的全局 Swup 钩子**（通过 `window.swup.hooks.on` 注册）：
- `link:click` — 管理 `is-page-transitioning` 类
- `content:replace` — 溢出增强、图标加载、侧边栏可见性
- `visit:start` — 添加过渡类、启动进度条、滚动到顶部
- `page:view` — 主题同步、侧边栏可见性、评论系统事件
- `visit:end` — 完成进度条、移除过渡类（400ms 延迟）

### 4.5 过渡动画保护

`is-page-transitioning` 类在 `<html>` 上管理，用于抑制过渡期间的视觉闪烁：

```css
/* 在过渡期间强制某些元素行为 */
html.is-page-transitioning .banner-home-text-overlay {
  visibility: hidden;
}

html.is-page-transitioning #navbar-wrapper {
  background: transparent !important;
  backdrop-filter: none !important;
}

html.is-page-transitioning #header-waves {
  contain: layout style paint;
}
```

### 4.6 禁止事项

| 禁止 | 原因 | 替代方案 |
|---|---|---|
| `window.location.href = url` | 导致整页刷新，破坏 Swup | `navigateToPage(url)` |
| 容器内 `<style>` 块 | Swup 替换时丢失 | 移至 `src/styles/` |
| 同时监听多个 Swup 事件 | 同一导航重复执行 | 仅用 `astro:page-load` |
| 容器内 `<script>` 累积 | 监听器重复绑定 | 使用 `data-swup-ignore-script` 或事件委托 |
| `document.startViewTransition()` 用于页面导航 | 与 Swup 冲突 | 仅用于主题切换 |

---

## 五、组件规范

### 5.1 组件文件结构

```astro
---
// 1. 导入（按类型分组）
// - Astro/Svelte 组件
// - 工具函数
// - 配置
// - 类型

// 2. Props 接口
interface Props {
  title: string;
  class?: string;
}

// 3. 解构 Props
const { title, class: className } = Astro.props;

// 4. 服务端逻辑
const data = await fetchData();
---

<!-- 5. 模板 -->
<div class:list={["component-name", className]}>
  <!-- 内容 -->
</div>

<!-- ❌ 禁止 <style> 块 -->
<!-- 样式在 src/styles/components/component-name.css 中定义 -->
```

### 5.2 样式与组件的对应关系

每个组件必须有对应的 CSS 文件（如果需要样式）：

| 组件文件 | CSS 文件 |
|---|---|
| `src/components/layout/Navbar.astro` | `src/styles/layout/navbar.css` |
| `src/components/layout/PostCard.astro` | `src/styles/components/post-card.css` |
| `src/components/widget/Calendar.astro` | `src/styles/widgets/calendar.css` |
| `src/pages/sponsor.astro` | `src/styles/pages/sponsor.css` |

### 5.3 Svelte 组件样式

Svelte 组件的 `<style>` 块同样需要迁移到外部 CSS 文件。Svelte 的 scoped 样式需要改为使用 BEM 命名的全局类名：

```svelte
<!-- ❌ 原始 Svelte scoped 样式 -->
<style>
  .search-panel { /* ... */ }
</style>

<!-- ✅ 迁移后 — 使用 BEM 类名，样式在 src/styles/components/search-modal.css -->
<div class="search-panel">
  <input class="search-panel__input" />
</div>
```

---

## 六、内容系统

### 6.1 博客文章

存放在 `src/content/posts/`，支持 `.md`/`.mdx` 格式，通过 Astro content collections 加载（定义在 `src/content.config.ts`）。

**Frontmatter 字段**：`title`、`published`、`draft`、`tags`、`category`、`pinned`、`comment`、`password` 等。

`spec` 集合（`src/content/spec/`）用于特殊页面内容（关于、友链、留言板）。

### 6.2 Markdown 插件流水线

定义在 `astro.config.mjs`：

**Remark 插件**（解析阶段，按顺序）：
remarkMath → remarkReadingTime → remarkImageGrid → remarkExcerpt → remarkDirective → remarkSectionize → parseDirectiveNode → remarkMermaid → remarkPlantuml

**Rehype 插件**（HTML 转换阶段）：
rehypeKatex → rehypeCallouts → rehypeSlug → rehypeMermaid → rehypePlantuml → rehypeFigure → rehypeExternalLinks → rehypeEmailProtection → rehypeComponents → rehypeAutolinkHeadings

自定义插件位于 `src/plugins/`。

---

## 七、配置系统

所有配置集中在 `src/config/`，通过 `@/config`（barrel 文件 `index.ts` 统一导出）导入。

核心配置文件 `siteConfig.ts` 控制：语言（`SITE_LANG`）、主题色、壁纸模式、页面开关、文章列表布局（list/grid/masonry）、分页、分析、图片优化、字体等。

**侧边栏配置**：`src/config/sidebarConfig.ts`，支持 `left`/`right`/`both` 位置，每个组件可独立开关。

修改 `rehypeCallouts.theme` 或 `plantumlConfig` 后需要重启开发服务器。

---

## 八、Workers 后端

Cloudflare Workers 入口 `src/worker.js`，通过 wrangler 自动 bundle 发布为单文件。

- `src/workers/count.js` — PV/UV 统计
- `src/workers/guestbook.js` — 留言板 CRUD + 投票
- `src/workers/ai-chat.js` — AI 聊天（embedding + SSE 流式生成）
- `src/workers/utils/rate-limit.js` — KV 限流
- `src/workers/utils/streaming.js` — SSE 流读取器

---

## 九、国际化 (i18n)

翻译键定义在 `src/i18n/i18nKey.ts`（const enum）。语言文件在 `src/i18n/languages/`。

使用 `i18n(key)` 函数（来自 `src/i18n/translation.ts`），按 zh_CN → en 顺序回退。

---

## 十、路径别名

`@components/*` → `src/components/*`、`@assets/*` → `src/assets/*`、`@constants/*` → `src/constants/*`、`@utils/*` → `src/utils/*`、`@i18n/*` → `src/i18n/*`、`@layouts/*` → `src/layouts/*`、`@/*` → `src/*`

---

## 十一、Biome 配置

格式化使用 **tab 缩进**、**双引号**。Svelte/Astro/Vue 文件放宽 lint 规则。CI 中通过 `biome ci ./src --reporter=github` 检查。

`src/constants/icons.ts` 被排除在 biome 检查之外（自动生成文件）。

---

## 十二、构建注意事项

- `pnpm build` 三步流程：图标生成脚本 → `astro build` → `pagefind --site dist`
- Vite 构建会移除 `console.log` 和 `debugger`（esbuild `drop` 选项）
- 图片优化仅对 `src/` 目录下的图片生效，`public/` 目录的图片不会被 Astro 优化
- `generateOgImages: true` 构建很慢，默认关闭
- CI 在 push/PR 到 master 时运行 biome 检查

---

## 十三、重构检查清单

在修改代码时，使用以下检查清单确保合规：

- [ ] **无内联样式**：组件中没有 `<style>` 块
- [ ] **样式集中**：所有 CSS 在 `src/styles/` 目录下
- [ ] **BEM 命名**：类名遵循 BEM 规范
- [ ] **变量使用**：颜色、间距、圆角使用 CSS 自定义属性
- [ ] **Swup 容器**：组件放在正确的容器内外位置
- [ ] **事件规范**：使用 `astro:page-load` 而非多个事件
- [ ] **程序化导航**：使用 `navigateToPage()` 而非 `location.href`
- [ ] **无魔法数字**：断点、z-index 使用变量
- [ ] **主题兼容**：支持亮色/暗色主题切换
- [ ] **响应式**：移动端适配完整
