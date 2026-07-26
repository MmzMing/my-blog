# 页面切换瞬时化改造设计

> 本方案将 Swup 页面切换的感知延迟从当前代码声明的约 700ms 压缩到 150ms 以内，并补齐预载策略，使预载命中路径达到"点击后下一帧换内容"。评审重点：A1 动画预算削减的视觉验收标准、B3 CSS 单文件化对首包体积的影响、C3 导航入口改 `<a>` 的样式回归面。目标：预载命中路径点击到内容完全可见 ≤ 150ms，以 §7 的测量脚本验证。

全部数值来源：2026-07-26 对仓库源码与 `node_modules` 产物的静态分析与实测（swup@4.8.2、@swup/astro@1.8.0、@swup/preload-plugin@3.2.11）。动画时长为 CSS 声明值；swup 对声明时长做硬等待（机制见 §1.1），声明值即阻塞下限。上线前后按 §7 实测复核。

---

## 1. 现状基线

### 1.1 一次导航的时间线（桌面端、预载命中、非首页目标）

swup@4.8.2 对每个匹配 `[class*="transition-swup-"]` 的元素读取 computed style 动画时长，用 `animationend` 事件等待，并以 `setTimeout(时长+1ms)` 兜底。声明的动画时长因此是导航流程中真实阻塞的串行阶段，不是纯视觉效果。

| 时刻 | 阶段 | 时长 | 来源 |
|---|---|---|---|
| 0ms | 点击 → `visit:start`，进度条立即显示 | — | `src/layouts/Layout.astro:431-435` |
| 0–300ms | 出场动画 blur-fade-out，硬等待 | 300ms | `src/styles/transition.css:51` |
| 300ms | `content:replace`；head 更新，若目标页有未加载 CSS chunk 则串行等待下载 | 0 至 1 次 RTT | SwupHeadPlugin `awaitAssets: true`（@swup/astro 默认） |
| 300–700ms | 入场动画 blur-fade-in | 400ms | `src/styles/transition.css:57` |
| 300–950ms | `.onload-animation` 叠加二次淡入 400ms + 50–250ms 阶梯延迟 | 至 650ms | `src/styles/transition.css:74-84` |
| 700ms 后 | 进度条 finishing 200ms + done 300ms | 500ms | `src/layouts/Layout.astro:459-469` |

HTML fetch 与出场动画并行，hover 预载命中时为 0。即网络成本为 0 时，内容完全可见仍需约 700–950ms。移动端 `transition.css:157-162` 仅禁用 `.onload-animation`，blur-fade 的 300+400ms 照常执行。

### 1.2 三条更慢的路径

1. **导航到首页（桌面端）**：每次显示全屏 PageLoader，等待非懒加载图片与字体就绪，上限 8000ms（`src/utils/page-loader-controller.js:2`、`:215-245`、`:99-108`）。loader 隐藏后 HomeHero 再播放 GSAP 开场时间线，单步 duration 0.7–1.18s（`src/components/layout/HomeHero.astro:934-1100`，触发链 `:1206`）。
2. **进站后的冷窗口**：@swup/astro 默认 `loadOnIdle: true`，Swup 在 `window.load` + `requestIdleCallback` 后才动态加载。窗口期内所有点击为整页刷新，`navigateToPage()` 降级 `location.href`。首页图片多，`load` 到达晚，窗口达秒级（需实测，方法见 §7）。
3. **页面类型首访**：`vite.build.cssCodeSplit: true`（`astro.config.mjs:306`）+ 12 个页面有页面级 CSS import（`src/pages/index.astro:7-13` 一页 7 个），首次导航到该类页面时 SwupHeadPlugin 串行等待新 CSS 下载完才播入场动画。

### 1.3 预载现状

`preload: true` 在 @swup/astro 中仅映射为 hover 预载（`preloadHoveredLinks: true, preloadVisibleLinks: false`）。缺口有二：

1. 视口预载未启用。移动端无 hover，仅 touchstart 提供约 80ms 提前量。
2. 以下入口通过 JS `navigateToPage()` 导航而非 `<a>`，hover 预载完全不生效：CategoryBar 下拉、FloatingDock、MobileDock、TagBubble、TagGraph、TagWordcloud、CategoryRose、SearchModal 结果项、calendar 事件面板。

已确认健康、本次不动：文章列表行为真实 `<a href>`（`src/components/pages/ArticleVirtualList.svelte:250`）；内链尾斜杠全部合规（`src/utils/url-utils.ts`、`src/constants/link-presets.ts`），无 301 损耗；`cache: true` 生效；持久组件全部位于 Swup 容器外。

### 1.4 佐证：零动画导航已在站内运行

音乐页通过 `src/styles/pages/music-visualizer.css:58-64` 对 swup 动画整体 `animation: none !important`。该页导航即当前架构下的零动画路径，无已知问题。

---

## 2. 目标与验收标准

| 指标 | 当前（声明值推导） | 目标 | 验证方法 |
|---|---|---|---|
| 预载/缓存命中路径：点击 → 内容完全可见 | 约 700–950ms | ≤ 150ms | §7 脚本，取 10 次中位数 |
| 冷路径（未预载）：点击 → 内容完全可见 | max(RTT, 300ms) + 400–650ms | RTT + 150ms | 同上，DevTools Fast 4G 节流 |
| 首页会话内重复访问 | loader 等待（≤8000ms）+ 开场秒级 | ≤ 150ms | 首页→文章→首页实测 |
| 进站后立即点击 | 整页刷新 | Swup 接管 | 刷新后 1s 内点击，观察无整页白屏 |
| 首次进站 LCP（B2/B3 守门指标） | 基线待测 | 劣化 ≤ 5% | Lighthouse 移动端 3 次取中位数，前后对比 |

非目标（本次不做）：

1. 不将 Swup 替换为 Astro ClientRouter，不引入 Speculation Rules 预渲染。两者要求真实 MPA 导航，与跨页持久的音乐播放器/歌词/Live2D 冲突，此为选用 Swup 的前提。
2. 不移除首页首次进站的开场编排与 PageLoader（仅限制其在 Swup 导航中重放）。
3. 不改造 Mermaid 运行时渲染（内容驱动，单独立项）。

---

## 3. 改造项

编号规则：A = 动画层，B = 配置层，C = 加载与入口层，D = 清理与文档。每项一个 commit，可独立 revert。

### A1 出场动画归零、入场改 150ms 纯 opacity

- **修改文件**：`src/styles/transition.css:25-68`
- **改法**：删除 `blur-fade-out`/`blur-fade-in` keyframes（:25-46）、`html.is-leaving` 规则块（:49-52）、现有 `html.is-rendering` 400ms 规则（:55-58），替换为：

```css
@keyframes swup-fade-in {
	from { opacity: 0; }
	to { opacity: 1; }
}

html.is-rendering .transition-swup-main {
	animation: swup-fade-in 150ms ease-out forwards;
}

@media (prefers-reduced-motion: reduce) {
	html.is-rendering .transition-swup-main {
		animation: none;
	}
}
```

- **收益**：每次导航 -550ms（出 300 + 入 400 → 入 150）。移除 `transform: translateY` 后动画仅涉及 opacity，由合成器处理，无布局参与。
- **影响面**：
  - 交互模型变为"旧内容保持原样直到新内容就绪"，与浏览器原生导航一致；预载命中时替换发生在点击后下一帧。
  - 出场阶段所有匹配元素声明时长为 0，swup 在 dev 控制台输出 1 条 warning（"No CSS animation duration defined"）；生产构建 `drop: ["console"]`（`astro.config.mjs:266`），无输出。
  - `music-visualizer.css:58-64` 的音乐页覆盖规则（`animation: none !important`）在新规则下仍成立，不需改动。
- **验证**：Performance 面板录制单次点击，确认 `content:replace` 到首帧 ≤ 1 帧；录屏逐帧检查无闪烁；音乐页进出导航正常。

### A2 `.onload-animation` 与入场动画合并节拍

- **修改文件**：`src/styles/transition.css:74-84`
- **改法**：duration 400ms → 150ms；删除 :80-84 的 5 条 `nth-child` 阶梯延迟。使用该类的 5 个文件（`MainGridLayout.astro`、`HomeDisplayLayer.astro`、`PostFooterActions.astro`、`posts/[...slug].astro`、`rss.astro`）不改。
- **收益**：内容完全可见时刻从 replace + 650ms 提前到 replace + 150ms；与 A1 同节拍，双层淡入在视觉上合并为一次。
- **影响面**：首次整页加载（非 Swup）的入场同样变快，首屏卡片阶梯感消失；移动端本已禁用该类，无变化。
- **验证**：首页与文章页各做一次整页刷新 + 一次 Swup 导航，录屏对比。

### A3 进度条延迟 200ms 显示

- **修改文件**：`src/layouts/Layout.astro:361-372`（timeout 管理）、`:431-435`（visit:start）、`:459-469`（visit:end）
- **改法**：

```ts
let progressShowTimeout: ReturnType<typeof setTimeout> | null = null;

// visit:start 内，替换原立即 add("loading")：
progressShowTimeout = setTimeout(() => {
	progressShowTimeout = null;
	progressBar.classList.remove("finishing", "done");
	void progressBar.offsetWidth;
	progressBar.classList.add("loading");
}, 200);

// visit:end 内，收尾前：
if (progressShowTimeout) {
	clearTimeout(progressShowTimeout);
	progressShowTimeout = null;
	// 进度条未显示过，跳过 finishing/done 收尾
} else {
	// 原 finishing/done 逻辑
}
```

同时将 `progressShowTimeout` 纳入 `clearAllTransitionTimeouts()`。

- **收益**：≤ 200ms 完成的导航（改造后为绝大多数）不再出现进度条闪烁。进度 UI 只在真正的慢网络场景出现。
- **影响面**：慢导航的进度条出现晚 200ms；快速连续导航由既有 timeout 清理逻辑覆盖。
- **验证**：无节流下导航确认无进度条；Fast 4G 节流下导航确认进度条仍出现且正常收尾。

### B1 启用视口预载

- **修改文件**：`astro.config.mjs:77`
- **改法**：`preload: true` → `preload: { hover: true, visible: true }`
- **收益**：视口内链接在停留 500ms 后自动预取 HTML（@swup/preload-plugin@3.2.11：IntersectionObserver threshold 0.2、delay 500ms、并发上限 5）。移动端从"touchstart 约 80ms 提前量"变为"点击时大概率已在缓存"。此为 Astro 内置 `prefetch: viewport` 策略在 Swup 架构下的等价物。
- **影响面**：静态托管请求量上升（每个可见链接 1 次 HTML 预取）。插件在 `navigator.connection.saveData` 或 2g `effectiveType` 时自动跳过（源码确认）。风险与回退见 R5。
- **验证**：Network 面板确认视口链接空闲预取、并发不超过 5；DevTools 模拟 data-saver 确认跳过。

### B2 Swup 立即初始化

- **修改文件**：`astro.config.mjs` swup() 选项
- **改法**：增加 `loadOnIdle: false`
- **收益**：Swup 从"window.load + idle 后"提前到脚本执行时接管，消除进站后的整页刷新冷窗口（§1.2 第 2 条）。
- **影响面**：Swup 核心 + 4 插件共 13.2KB gz（实测：swup 7.2 + a11y 1.8 + preload 2.3 + head 1.3 + scripts 0.6，2026-07-26 对 node_modules 产物 gzip 测量）从空闲加载改为随页加载。对 LCP 的影响以 §2 守门指标验收，超标处理见 R3。
- **验证**：刷新后 1s 内点击导航，确认走 Swup；Lighthouse 移动端 LCP 前后对比。

### B3 CSS 单文件化

- **修改文件**：`astro.config.mjs:306`
- **改法**：`cssCodeSplit: true` → `false`。CLAUDE.md 第十四节现文即为 `false`，本项同时消除配置与文档的漂移。
- **收益**：全站共享 1 个 CSS 文件，SwupHeadPlugin 在导航时无新增样式表可等，消除每页面类型首访的串行 CSS 等待（§1.2 第 3 条，受影响 12 个页面）。
- **影响面**：首包 CSS 体积增大，量级需构建实测：`pnpm build` 后检查 `dist/_astro/*.css` 的数量与 gzip 体积。回退方案见 R2。
- **验证**：构建产物 CSS 文件数为 1；导航到 gallery、calendar 等页面时 Network 面板无新增 CSS 请求。

### C1 PageLoader 仅整页加载时显示

- **修改文件**：`src/utils/page-loader-controller.js:215-245`
- **改法**：删除 `bindSwup` 函数及其调用（link:click / visit:start / content:replace 的 `show()` 与 page:view / visit:end 的 `hideWhenReady()` 绑定整体移除）。保留初始进站逻辑（:276-290）与 `astro:page-load` 监听（:292-295，`LOADER_READY_EVENT` 派发不变）。
- **收益**：Swup 导航到首页不再显示全屏 loader，不再等待图片与字体（原上限 8000ms）。内容立即可见，图片走既有 LQIP 渐进加载。
- **影响面**：HomeHero 开场经 `waitForPageLoaderHidden()`（`HomeHero.astro:1206`）等待 loader；loader 未显示时该函数立即 resolve（`page-loader-controller.js:204-211`，已核对），开场触发链不阻塞、不报错。首页图片未就绪时用户可见渐进加载过程，为本方案的明确取舍。
- **验证**：从文章页导航回首页，无全屏 loader，HomeHero 正常初始化；整页刷新首页时 loader 行为不变。

### C2 首页开场编排每会话仅播放 1 次

- **修改文件**：`src/components/layout/HomeHero.astro`（`scheduleHomeInit` / `init` 区域，:1180-1225）
- **改法**：以 `sessionStorage` 标记 `home-opening-played`。已播放时跳过 opening timeline（:934-1100），复用现有的立即揭示路径（:1027 的 `motion-pending` 移除逻辑）；对话框、工作状态、ScrollTrigger 滚动动效、雨效照常初始化。
- **收益**：会话内重复进首页内容立即可见。结合 C1，首页热路径与其它页面同标准。
- **影响面**：开场仪式感降为每会话 1 次；新标签页/新会话仍完整播放。既有 cleanup 链（timeline kill、ScrollTrigger kill，:278-283）不变。
- **验证**：首页→文章→首页，第二次无开场动画且无 motion-pending 停留；新开标签页进首页仍有完整开场。

### C3 JS 导航入口改真实 `<a>`

- **修改文件与范围**（分 3 个 commit）：

| 批次 | 文件 | 现状 | 改法 |
|---|---|---|---|
| C3-1 | `src/components/layout/CategoryBar.astro:227` | button 下拉项 + `navigate()` | `<a role="menuitem">`，保留菜单键盘语义 |
| C3-1 | `src/components/controls/FloatingDock.astro:72`、`src/components/layout/MobileDock.astro` | button + `navigateToPage("/")` | `<a href="/">` 套用现有 `.dock-btn` 类 |
| C3-2 | `src/components/controls/SearchModal.svelte`、`src/components/pages/calendar/EventDetailPanel.svelte`、`EventOverview.svelte` | JS 导航 | 结果项/事件项改 `<a>` |
| C3-3 | `src/components/widget/TagBubble.astro`、`TagGraph.astro`、`TagWordcloud.astro`、`CategoryRose.astro` | JS 导航 | DOM/SVG 型节点包 `<a>`；canvas 命中区无法承载 `<a>` 的保留 JS 导航，记为已知局限 |

- **收益**：改造入口获得 hover / touchstart / 视口预载与浏览器原生语义（中键新标签、拖拽、无障碍树）。Swup 自动拦截 `<a>` 点击，`navigateToPage` 调用点随之删除。
- **影响面**：本方案样式回归面最大的一项。button → a 需核对 `.dock-btn` 等类在 `<a>` 上的 display、颜色、focus 态；menuitem 的 Enter/Space 行为需回归。每批过 CLAUDE.md 第十五章检查清单。
- **验证**：每批完成后，hover 对应入口在 Network 面板出现预取；Tab 遍历与 Enter 激活正常；移动端点按态无异常。

### D1 删除僵尸开关

- **修改文件**：`src/layouts/Layout.astro:383`、`:394-397`、`:428`、`:471-475`；`src/styles/variables.styl:14`
- **依据**：`--content-delay`（定义 + 置零，无任何消费者）与 `is-page-transitioning`（4 处设置，零消费者），2026-07-26 全仓 grep 确认。
- **收益**：移除每次点击的 4 次无效 DOM 操作；消除误导维护者的假接口。
- **影响面**：无，死代码。
- **验证**：删除前二次 grep 确认零引用；删除后导航行为无变化。

### D2 动画选择器减负

- **修改文件**：`src/layouts/MainGridLayout.astro:77-78`；`src/styles/transition.css:49、55`
- **改法**：两个 `display:none` 的侧栏容器摘除 `transition-swup-main`；删除全仓无使用者的 `.transition-swup-leaving` 选择器。
- **依据**：隐藏容器的动画从不真实播放，swup 依赖 `setTimeout(时长+1ms)` 兜底凑满等待（swup@4.8.2 源码）。当前主容器时长相同故不额外加时，但构成后续调整动画时的隐性约束。
- **收益**：出入场等待仅由主容器驱动；A1 的时长调整不再受隐藏容器牵制。
- **影响面**：无视觉变化。侧栏容器保留 id 与 Swup containers 协议不变。
- **验证**：导航正常，dev 控制台无新增 swup warning。

### D3 文档同步

- **修改文件**：`CLAUDE.md`
- **改法**：第十四节 `cssCodeSplit` 描述随 B3 恢复一致；第六章补充两条规范："Swup 过渡动画预算 ≤ 150ms，仅允许 opacity"、"新增站内导航入口必须使用 `<a href>`，禁止以 JS 导航替代"。
- **收益**：防止本方案消除的问题回潮。

---

## 4. 收益汇总

| 路径 | 改造前 | 改造后 | 依据 |
|---|---|---|---|
| 通用页面，预载/缓存命中 | 约 700–950ms | ≤ 150ms | A1 + A2 |
| 通用页面，冷路径 | max(RTT, 300ms) + 400–650ms | RTT + 150ms | A1；B1 使冷路径占比下降 |
| 页面类型首访的 CSS 等待 | 串行 1 次 RTT | 0 | B3 |
| 首页，会话内重复访问 | loader（≤ 8000ms）+ 开场秒级 | ≤ 150ms | C1 + C2 |
| 进站后立即点击 | 整页刷新 | Swup 接管 | B2 |
| 移动端通用页面 | 700ms，无 hover 预载 | ≤ 150ms，视口预载 | A1 + B1 |
| dock / 分类栏 / 搜索结果入口 | 无预载 | hover + 视口预载 | C3 |

数值为代码声明值推导，非现场实测。上线前后以 §7 同一把尺复核，实测结果回填本节。

---

## 5. 风险清单

**R1 [P1]** 风险：动画大幅缩短改变站点视觉气质。影响：若站长不接受，A1/A2/C2 返工。应对：A1 保留 150ms 淡入而非零动画；C2 保留每会话首次完整开场；批次 1 完成后录屏对比交站长确认，不满意则仅 revert A1/A2 两个 commit，其余项收益独立保留。

**R2 [P1]** 风险：B3 合并后单 CSS 文件过大。影响：首次进站 FCP/LCP 上升，违反 §2 守门指标。应对：构建实测 gzip 体积；超过 100KB 时回退为"保持 `cssCodeSplit: true`，将 12 处页面级 import 收编进 `main.css`"，等效消除导航期 CSS 等待，首包增量相同但可按需拆分。

**R3 [P2]** 风险：B2 提前加载 13.2KB gz JS。影响：Lighthouse 移动端 LCP 劣化。应对：前后对比，劣化 > 5% 时改回 `loadOnIdle: true`，接受冷窗口仅影响 `load` 前的点击。

**R4 [P2]** 风险：C3 button → a 引入样式或无障碍回归。影响：dock/菜单视觉错位、键盘路径失效。应对：分 3 个 commit 递进，每批过 CLAUDE.md 第十五章清单；canvas 型 widget 不强改。

**R5 [P2]** 风险：B1 增加静态托管请求量。影响：免费额度托管的请求数上升。应对：插件自带 saveData/2g 跳过与并发 5 上限；上线 1 周内观察托管平台请求统计，超出预算则回退 `visible: false`，保留 hover 预载。

---

## 6. 执行计划

| 批次 | 内容 | 性质 | 预估工时 |
|---|---|---|---|
| 1 | D1、D2、A1、A2、A3、B1 | 纯 CSS/配置/死代码，低风险 | 0.5 天 |
| 2 | B2、B3、C1、C2、D3 | 行为变更，需实测守门 | 0.5–1 天 |
| 3 | C3-1、C3-2、C3-3 | 入口改造，样式回归面大 | 每批 0.5 天 |

规则：

1. 每个编号项一个 commit，commit message 引用编号（如 `perf(swup): A1 出场动画归零`），回滚以单 commit revert 为单位。
2. 批次 1 内先做 D2 再做 A1，使动画等待仅由主容器驱动后再改时长。
3. 每批完成后执行：`pnpm build && pnpm preview`，跑 §7 测量，过 CLAUDE.md 第十五章清单（light/dark、移动端）。
4. 批次 2 的 B2、B3 分别单独 commit 并单独跑 Lighthouse，守门不过立即单项回退。
5. R1 的录屏确认安排在批次 1 之后、批次 2 之前。

---

## 7. 测量方法

基线与回归使用同一脚本。生产构建 drop console，脚本在 `pnpm preview` 环境的控制台手工注入，不进仓库：

```js
window.swup.hooks.on("visit:start", () => performance.mark("nav-start"));
window.swup.hooks.on("visit:end", () => {
	performance.mark("nav-end");
	const m = performance.measure("nav", "nav-start", "nav-end");
	console.log(`visit ${Math.round(m.duration)}ms`);
});
```

补充手段：

1. Performance 面板录制单次点击，读 `content:replace` 到首帧渲染的间隔与长任务分布。
2. Lighthouse 移动端预设，改造前后各跑 3 次取中位数，比较 LCP/TBT（B2、B3 守门）。
3. Network 面板核对预载行为（B1）与导航期零新增 CSS 请求（B3）。
4. 冷窗口测量（B2 前基线）：刷新首页后立即连点站内链接，记录首次被 Swup 接管的时刻。
