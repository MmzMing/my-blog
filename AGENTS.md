# AGENTS.md


---

## 一、硬性约束：未经我明确指示，一律不得执行

以下动作**必须**由我明确下达指令后才可执行。禁止以「顺手做了」「觉得应该做」「为了完整性补上」「保持一致性」为理由自行执行。违反其中任何一条，即使结果正确也算错误交付。

### 1. Git 操作

- **禁止**提交：`git add`、`git commit`、`git commit --amend`
- **禁止**推送：`git push`（任何分支、任何形式）
- **禁止**动分支：`git branch`、`git checkout -b`、`git switch -c`，以及切换、重命名、删除分支
- **禁止**改历史与工作区：`git merge`、`git rebase`、`git reset --hard`、`git revert`、`git clean -f`、`git stash`、`git tag`
- **禁止**创建 PR / MR：`gh pr create`、`gh pr merge` 等
- **禁止**改动 `git config`、`.gitignore`、`.gitattributes`
- **允许**：`git status`、`git diff`、`git log`、`git show` 等只读查询

### 2. 文档编写

- **禁止**主动新建任何 Markdown 文档：README、设计文档、方案文档、总结报告、变更日志、`docs/plans/*`、`*-说明.md` 等
- **禁止**把工作总结、排查过程、改动清单写成文件。总结直接在对话里回答我
- **允许**：我明确要求写文档时；改动代码时同步更新**已存在且直接相关**的注释或文档段落

### 3. 测试与浏览器自动化

- **禁止**主动引入或启动 Playwright：`playwright test`、`playwright codegen`、`npx playwright install`（会下载数百 MB 浏览器）
- **禁止**主动新建测试框架配置（如 `vitest.config.*`）或成批补写测试用例
- **禁止**主动引入 E2E、截图对比、视觉回归体系
- **允许**：我明确要求时；用 `pnpm check`、`pnpm type-check`、`pnpm lint`、`pnpm build` 做改动验证

### 4. 依赖与工程配置

- **禁止**主动变更依赖与 lockfile：`pnpm add`、`pnpm remove`、`pnpm update`
- **禁止**主动升级 Astro / Svelte / Tailwind / Biome 等主版本
- **禁止**主动改动行为性配置：`astro.config.mjs`、`biome.json`、`tsconfig.json`、`vercel.json`、`wrangler.jsonc`、`.github/workflows/*`
- 确有必要时：先说明原因和影响面，等我确认

### 5. 破坏性与外部影响操作

- **禁止**批量删除文件/目录、递归删除、重命名或移动目录
- **禁止**改动 `public/` 下的站长验证文件（百度 / 头条 / Bing）与 Live2D 模型资源
- **禁止**操作线上部署：Cloudflare Pages / Vercel 发布、清缓存、改 DNS、改环境变量
- **禁止**执行 `pnpm indexnow` 等会向外部服务真实推送数据的命令（`--dry-run` 也需先确认）
- **禁止**读取或回显 `.env`、密钥、Token 的具体值

### 6. 范围纪律

- 只改我要求的范围。不顺手重构、不顺手格式化无关文件、不顺手删「看起来没用」的代码
- 不主动新增配置项、开关、抽象层、防御性兜底代码
- 发现范围外的问题：在回答里指出，等我决定，不自行动手
- 同一方案连续两次失败就停下来说明原因，不做第三次同类微调

不确定是否在允许范围内时，先问，不要先做。

---

## 二、项目概况

`firefly-mod`，个人博客，基于 Astro 7 静态输出，Fork 自 Firefly / fuwari 后独立演进。Svelte 5 孤岛组件、Tailwind CSS 4、Swup 4 负责类 SPA 导航、Pagefind 负责站内搜索。要求 Node >= 22，**只能用 pnpm**（`preinstall` 用 `only-allow` 强制）。

## 三、常用命令

```bash
pnpm dev                  # 开发服务器（astro dev）
pnpm build                # 生成图标 → 生成 LQIP 占位数据 → astro build → pagefind 建索引
pnpm preview              # 预览 dist/ 产物
pnpm check                # astro check（类型 + .astro 诊断），改完代码必跑
pnpm type-check           # tsc --noEmit
pnpm lint                 # biome check --write ./src
pnpm format               # biome format --write ./src
pnpm icons                # 重新生成 src/constants/icons.ts
pnpm lqips                # 重新生成 src/constants/lqips.json（增量执行，build 会自动跑）
pnpm new-post <name>      # 在 src/content/posts 下生成带 frontmatter 的文章
```

CI（`.github/workflows/ci.yml`）在 push / PR 到 `master` 时跑 `pnpm astro check` 和 `biome ci ./src`。

`playwright` 是 devDependency，但只被友链 CI 使用：[friend-link-checker.yml](.github/workflows/friend-link-checker.yml) 经 [.github/scripts/process-friend-request.cjs](.github/scripts/process-friend-request.cjs) 用无头 chromium 实际访问友链申请页做可达性校验（CI 里的 `pnpm exec playwright install --with-deps chromium` 依赖它）。本地开发用不到，**不要主动**去启动它或拿它搭测试框架（见第一节第 3 条）。

预览用的开发服务器配置在 [.claude/launch.json](.claude/launch.json)（`blog-dev`，端口 4399）。

---

## 四、架构要点

### 导航外壳（改任何客户端脚本前必读）

Swup 在 [astro.config.mjs](astro.config.mjs) 里只替换三个容器：`#swup-container`（即 `<main>`）、`#left-sidebar-dynamic`、`#right-sidebar-dynamic`。其余部分（导航栏、页脚、悬浮坞、Live2D、音乐管理器）都在容器之外，定义于 [Layout.astro](src/layouts/Layout.astro) 与 [MainGridLayout.astro](src/layouts/MainGridLayout.astro)，**跨导航持久存在**。

Swup 导航下有两个底层事实，全站生命周期管理都是为解决它们而生的（完整说明见 [swup-lifecycle.ts](src/utils/swup-lifecycle.ts) 顶部注释）：

- `@swup/astro` 桥接的三个 DOM 事件（`astro:before-swap` / `astro:after-swap` / `astro:page-load`）都是裸 `Event`，且**首次加载一个都不会派发**；
- 容器内组件的 `<script>` 由 `SwupScriptsPlugin` 重新注入，执行时机不确定：module 脚本第二次及以后进入同一页不再执行（module map 命中），`is:inline` 内联脚本反而每次导航都重新执行。

**初始化与清理一律通过 [swup-lifecycle.ts](src/utils/swup-lifecycle.ts) 注册，不要自己监听上述 DOM 事件拼时序**：

- `definePageIsland({ name, mount, unmount, match? })`：页面级组件（容器内）。内部用「导航代数」去重——`astro:before-swap` 先统一卸载再把代数 +1（此刻被 pin 的节点和 ScrollTrigger 自插的 `.pin-spacer` 还在文档里，`unmount` 里的 ScrollTrigger `kill()` 才不会落在游离节点上），`astro:page-load` 再补扫挂载，保证一代只挂一次且一定挂得上。
- `definePersistentIsland(name, setup)`：常驻组件（容器外），整个文档生命周期只执行一次。
- `onNavigation` / `onBeforeSwap` / `onSwupHook`：语义化订阅，仅用于常驻组件导航后同步状态、或需要 swup 原生钩子的场景。
- `is:inline` 脚本拿不到本模块的导出（解析期就执行，早于任何 module 脚本），只能直接监听三个 DOM 事件，并在交互时点惰性读 `window.swup`。
- swup 相关类型集中在 [src/types/swup.ts](src/types/swup.ts)；`window.swup` 实例经 `getSwup()` 获取，预载用 `preloadUrl()`。

首页专用预设是 [home-lifecycle.ts](src/utils/home-lifecycle.ts) 的 `bindHomeLayer(layer, { boot, teardown })`：按 `.home-page` 根节点判断本次导航是否首页，层名自动加 `home:` 前缀防撞名。首页各层（hero / blinds / data-layer / mobile）全部走它，新增首页层也照此办理。

- `trailingSlash: "always"`、`base: "/"`，站内链接必须带尾斜杠，统一用 [url-utils.ts](src/utils/url-utils.ts) 的辅助函数生成。

客户端行为写在 `src/utils/` 下的纯 TS 模块，命名为 `*-controller.ts` / `*-lifecycle.ts`，由组件 `<script>` 导入，不要把逻辑内联进组件。生产构建 esbuild 会 drop `console.*` 和 `debugger`，因此不要依赖 `console` 做线上排查。

### 配置系统

所有站点配置在 `src/config/`，由 barrel 文件 [index.ts](src/config/index.ts) 统一导出，一律通过 `@/config` 导入：

```ts
import { siteConfig, homeConfig } from "@/config";
```

类型定义在 [src/types/config.ts](src/types/config.ts)。`siteConfig.pages.*` 是页面开关，同时驱动 [navBarConfig.ts](src/config/navBarConfig.ts) 和 `astro.config.mjs` 里的 sitemap 过滤器——新增页面时这三处要一起改。

### 内容集合

[content.config.ts](src/content.config.ts) 用 glob loader 定义两个集合：`posts`（`src/content/posts/**/*.{md,mdx}`）和 `spec`（无 schema，承载关于页 / 许可证等文案）。文章 schema 含 `draft`、`pinned`、`password` / `passwordHint`（客户端加密文章）、`wikiExclude`，以及排序时回填的 `prev*` / `next*` 内部字段。

查询统一走 [content-utils.ts](src/utils/content-utils.ts)（`getSortedPosts`、`getTagList`、`getCategoryList`、`getTagGraphData`），**不要**在页面里直接调 `getCollection`，否则草稿过滤和上下篇串联会不一致。

### Markdown 渲染管线

`astro.config.mjs` 显式构造 `unified()` processor，而非依赖 Astro 默认配置，串接了 `src/plugins/` 下十余个本地插件：wiki 链接、图片网格、摘要提取、阅读时长、Mermaid、PlantUML、图表缩放拖拽、图注、外链处理、邮箱混淆、GitHub 卡片。新增 Markdown 语法 = 在 `src/plugins/` 加插件并注册进 remark / rehype 数组。代码块走 `astro-expressive-code`（语言徽章、折叠区块、行号，以及本地的 `expressive-code-lazy-collapsible.mjs` 处理超长代码块）。

### 封面图与 LQIP

文章封面统一走 [cover-image.ts](src/utils/cover-image.ts) 的 `buildCoverImage()`：构建期把 frontmatter 的 `image` 解析成 `{ src, srcset, sources, width, height, lqipStyle }`（本地相对路径经 Astro 图片服务转码出多格式 `srcset` 且不做放大，public / 远程图原样引用），再交给 [CoverImage.astro](src/components/common/CoverImage.astro) 渲染。**不要**在列表页 / 文章页各自 `import.meta.glob` 取 `ImageMetadata.src`——那会拿到未经优化的源资产直接塞进页面。

LQIP 占位数据由 [scripts/generate-lqips.ts](scripts/generate-lqips.ts) 在构建前生成到 `src/constants/lqips.json`（每张图缩到 2x2 取角点色压成 18 字符，增量执行并清理失效条目），[lqip-utils.ts](src/utils/lqip-utils.ts) 解码成 CSS 斜向渐变当占位背景。`lqip-utils` 整包 import 这份 json，**只能被 .astro frontmatter 或构建期工具引用**，一旦被 .svelte 客户端组件导入会把整份 json 打进客户端 bundle。

### 机器可读产物（LLM Wiki / GEO）

构建输出 `llms.txt`、`wiki/index.json` 以及每篇文章的 `wiki/articles/{slug}.{json,md}`，全部由 [llm-wiki.ts](src/utils/llm-wiki.ts) 从文章集合静态生成，经 `src/pages/wiki/` 下的预渲染端点输出。**不涉及** Embedding、向量库、Worker。草稿、加密文章、`wikiExclude: true` 的文章由 `isPublicWikiPost` 过滤掉。

### 图标

`src/constants/icons.ts` 是**自动生成**文件：[scripts/generate-icons.js](scripts/generate-icons.js) 用正则扫描 `src/**/*.{svelte,astro,ts}` 收集图标名，再从 `@iconify-json/*` 包内联 SVG。该文件已被 Biome 忽略，**禁止手改**。图标渲染为空时，要么写法没被 `extractIconNames` 的正则匹配到，要么图标集不在 `ICON_SETS` 里；修好引用或脚本后跑 `pnpm icons`。

### 样式

`src/styles/main.css` 是全局样式的 import 清单（布局层 → 组件层 → 侧边栏层）。Vite 配了 `cssCodeSplit: true`：**全局清单里的 CSS 进共享 chunk，页面/组件 frontmatter 里 import 的 CSS 按页拆包**。因此页面专属样式（如 `pages/*.css`、`about-*.css`、`guestbook-chat.css`）**不要**登记进 main.css，直接在对应页面或独占它的组件 frontmatter 里 import（见 [index.astro](src/pages/index.astro)、[about.astro](src/pages/about.astro)）。Swup 换页时新样式表的串行等待由 [swup-css-prefetch.ts](src/utils/swup-css-prefetch.ts) 在 hover 预载阶段消除。两个 Stylus 文件（`variables.styl`、`markdown-extend.styl`）由 `Layout.astro` 引入。

### 国际化

`siteConfig.lang` 经 `getTranslation` 选中 `src/i18n/languages/` 下的翻译表（en、zh_CN、zh_TW、ja、ru），组件调用 `i18n(I18nKey.someKey)`。新增文案 = 在 [i18nKey.ts](src/i18n/i18nKey.ts) 加 key，并补齐**所有**语言文件——`Translation` 类型会让漏补变成类型错误。

---

## 五、代码规范

### 5.1 通用原则

- **最小改动**：解决被问到的那个问题。不附带清理、不附带抽象、不附带「以后可能有用」的配置项。
- **先读再写**：改任何文件前先读它，以及它的调用方。风格、命名、依赖跟随现有代码，不引入新的库或新的写法习惯。
- **复用优先**：动手前先搜 `src/utils/`、`src/config/`、`src/constants/` 有没有现成实现。禁止复制粘贴同一段逻辑到第二处。
- **单一职责**：一个模块只做一件事。工具函数不夹带副作用，控制器不承担数据获取。
- **改完必验**：`pnpm check` 必跑；涉及构建产物或 Markdown 管线的再跑 `pnpm build`。跑不通就修到通，不要交付红灯代码。
- **禁止无根据断言**：没读过的文件、没跑过的命令，不要在回答里当成已验证的事实陈述。

### 5.2 命名

- 文件：Astro / Svelte 组件用 `PascalCase.astro` / `PascalCase.svelte`；工具模块用 `kebab-case.ts`；客户端运行时模块保持 `*-controller.ts`、`*-lifecycle.ts` 后缀语义。
- 配置：`xxxConfig.ts`，默认导出对象名与文件名一致（`homeConfig.ts` → `homeConfig`）。
- 变量与函数：`camelCase`；类型与接口：`PascalCase`；常量：`SCREAMING_SNAKE_CASE`（放 `src/constants/`）。
- 布尔量用 `is` / `has` / `should` / `enable` 前缀。禁止 `flag`、`temp`、`data2`、`newFn` 这类无信息量命名。
- CSS 类名沿用现有 BEM 风格（`home-page--motion-pending`、`article-outline-rail`），不要临时另起一套。

### 5.3 TypeScript

- `strictNullChecks` 已开启，`allowJs: false`。**禁止** `any`；确实未知用 `unknown` 再收窄。
- **禁止**用 `as` 强转绕过类型错误，**禁止**加 `@ts-ignore` / `@ts-expect-error` 掩盖问题——修类型，不是关告警。
- 导出的函数必须有显式返回类型；对外类型定义集中在 `src/types/`，不要在组件里就地重复声明。
- 用 `import type` 导入纯类型（Astro / Svelte 文件除外，Biome 在那里关掉了该规则）。
- 联合类型 + 判别字段优于可选字段堆叠；枚举必须显式赋初值（`useEnumInitializers`）。

### 5.4 格式与静态检查

- Biome 统一格式化：**制表符缩进**、双引号、自动整理 import。提交前跑 `pnpm lint`。
- Biome 已排除 `src/**/*.css` 和 `src/constants/icons.ts`；Svelte / Astro 文件关闭了 `useConst`、`useImportType` 和未使用变量检查——不要因此在这些文件里放任死代码。
- 已开为 error 的规则要留意：`noParameterAssign`（不改形参）、`useDefaultParameterLast`、`useSelfClosingElements`、`useSingleVarDeclarator`、`noUselessElse`、`noInferrableTypes`、`useNumberNamespace`（用 `Number.parseInt` 而非全局 `parseInt`）。
- **禁止**为了让 lint 通过而扩大 `biome.json` 的忽略范围。

### 5.5 路径与导入

- 一律用别名，禁止 `../../..` 形式的深层相对路径：`@/*`、`@components/*`、`@assets/*`、`@constants/*`、`@utils/*`、`@i18n/*`、`@layouts/*`。
- 配置从 barrel 导入（`@/config`），不要绕过 barrel 直接 import 单个配置文件（`src/pages/posts/[...slug].astro` 里有历史遗留的直连写法，属于待收敛项，不要照抄扩散）。
- 禁止组件之间互相反向依赖形成环；共用逻辑下沉到 `src/utils/`。

### 5.6 Astro / Svelte 组件

- 默认零 JS。只有确实需要交互才用 Svelte 岛，并选最小的 `client:*` 指令（能 `client:visible` 就不要 `client:load`）。
- Astro 组件的 frontmatter 只做数据准备，不塞业务逻辑；重逻辑放 `src/utils/`。
- Props 必须有 TypeScript 接口，必填与可选分清，不用 `any` 兜。
- 组件放置遵循 `src/components/` 既有分类：`layout/`、`controls/`、`common/`、`widget/`、`features/`、`pages/`、`comment/`、`analytics/`、`about/`、`seo/`、`misc/`，别新建平行分类。
- 渲染用户或第三方内容必须走 `sanitize-html`，禁止裸 `set:html` / `innerHTML` 拼接。

### 5.7 客户端脚本与生命周期

- 页面级组件用 `definePageIsland` 注册：初始化放 `mount`，清理放 `unmount`；常驻组件用 `definePersistentIsland`。不要自己监听 `astro:page-load` / `astro:before-swap` 拼时序（语义化封装 `onNavigation` / `onBeforeSwap` / `onSwupHook` 仅限常驻组件或需要 swup 原生钩子的场景）。
- `unmount` 清理要覆盖事件监听、定时器、`IntersectionObserver` / `ResizeObserver`、GSAP 时间轴与 ScrollTrigger、动画帧；swup-lifecycle 已约定「先记代数再 mount」，保证挂载中途抛异常也能拆干净。
- 禁止裸用 `DOMContentLoaded` / `window.onload` 作为页面级初始化时机——Swup 导航不会再触发。
- 禁止把状态挂在模块顶层单例上却不在清理阶段重置，否则二次进入页面会串状态。
- 新增首页层复用 `bindHomeLayer`，不要自己另写一套去重逻辑。
- 跨常驻组件通信用 `CustomEvent`（参考 `MusicManager` 的单例 + 事件同步模式），不要靠全局变量。

### 5.8 样式

- 优先 Tailwind 原子类；只有复用性强或涉及动画、伪元素、复杂选择器时才写独立 CSS 文件。
- 主题色、间距等设计变量取自 `siteConfig.themeColor` 与 `variables.styl`，**禁止**硬编码色值和魔法数字。
- 跨页面复用的 CSS 登记到 `src/styles/main.css` 清单，放对层级（布局 / 组件 / 侧边栏）；页面专属 CSS 在该页面（或独占它的组件）frontmatter 里 import，按页拆包。
- 深浅色都要覆盖：主题通过 `[data-theme='...']` 选择器切换，改样式时两套都验。
- 动画尊重 `prefers-reduced-motion`；导航相关的时长与节奏改动先看 `docs/plans/` 里的既有设计结论，不要凭感觉调。

### 5.9 数据与内容

- 文章 frontmatter 必须符合 `content.config.ts` 的 schema；改 schema 属于影响全站构建的动作，先说明再动。
- 新增 frontmatter 字段要同步考虑：schema、`_frontmatter.json`、LLM Wiki 输出、sitemap 的 lastmod 逻辑。
- 日期统一用 `dayjs` 和 [date-utils.ts](src/utils/date-utils.ts) 处理，不要自己拼字符串或直接 `new Date()` 做格式化。
- 构建期读文件必须做存在性判断和异常兜底（参考 `astro.config.mjs` 里 `getPostLastmod` 的写法），不能让单篇文章的坏数据炸掉整个构建。

### 5.10 安全

- 用户输入、评论内容、外部 API 返回，一律先 `sanitize-html` 再渲染。
- 外链统一走 `rehype-external-links` 插件加 `rel="noopener noreferrer"`，不要手写。
- 邮箱在正文里由 `rehype-email-protection` 混淆，不要明文输出。
- 密钥只从环境变量读（见 `.env.example`），禁止写进源码、配置文件或注释，禁止在回答里回显具体值。
- 客户端加密文章（`password` 字段）的实现在 [crypto-utils.ts](src/utils/crypto-utils.ts)，改动前明确它只是访问门槛而非真正的机密保护，不要给它加上「安全」承诺。
- 新增对外接口（`src/pages/api/*`）默认没有鉴权，涉及写操作或敏感数据时必须显式指出这一点。

### 5.11 性能

- 站点是纯静态输出，尽量把计算放在构建期，不要挪到客户端。
- 重依赖（katex、mermaid、live2d、gsap）已在 `astro.config.mjs` 的 `manualChunks` 里单独分包；新增重依赖要同步考虑分包和按需动态 `import()`。
- 图片走 `CoverImage` 组件（封面）与 Astro 图像优化，封面数据用 `buildCoverImage()` 构建期解析，不要裸 `<img>`，也不要绕过封面管线直接取源资产（见「封面图与 LQIP」）。
- 列表页数据在构建期算好，避免客户端二次遍历全量文章。
- 不要在 `astro:page-load` 回调里做全量 DOM 扫描；用选择器精确定位。

### 5.12 错误处理与日志

- 异步操作、外部请求、文件读写必须有明确的失败路径，不要静默 `catch {}`。真的要忽略就写注释说明为什么（参考 `getPostLastmod`）。
- 第三方服务（Waline、Twikoo、Umami、Meting）不可用时页面要能降级，不能白屏或阻塞渲染。
- 生产构建会移除 `console.*`，因此日志只用于开发期调试，不作为线上可观测手段；不要留下依赖 `console` 的逻辑。
- 错误信息面向用户时走 i18n，不要硬编码中英文字符串。

### 5.13 注释与文档

- 仓库现有注释以**中文**为主，编辑文件时跟随该文件的语言，不要中英混写。
- 注释解释「为什么」，不重复「做了什么」。像 [home-lifecycle.ts](src/utils/home-lifecycle.ts) 顶部那种记录坑位与权衡的注释是本仓库鼓励的风格。
- 生成类文件（`src/constants/icons.ts`）保留「请勿手动编辑」头部注释。
- **不要**主动新建文档文件（见第一节第 2 条）。功能说明写进代码注释或直接在对话里告诉我。

### 5.14 提交规范（仅在我下达指令后执行）

- 遵循 Conventional Commits：`feat` / `fix` / `refactor` / `docs` / `chore` / `perf` / `style` / `test`，格式 `type(scope): 描述`，描述用中文，参考现有 git log。
- 一个提交只做一件事，不要把无关改动混在一起。
- 提交前必须先跑 `pnpm check` 和 `pnpm lint`。
- 只 `git add` 明确涉及的文件，禁止 `git add .`。
- 疑似含密钥的文件（`.env` 等）在纳入提交前必须先提醒我。
- 保留 hooks，禁止 `--no-verify`。

---

## 六、已知不一致（不要照着错的文档改代码）

- [README.md](README.md) 和 [src/config/README.md](src/config/README.md) 都还列着 `sidebarConfig.ts`，但该文件已随首页侧边栏移除而不存在，[src/types/config.ts](src/types/config.ts) 里也只剩一行提及 `sidebarLayoutConfig` 的过时注释。以目录实际内容为准。
- `src/pages/posts/[...slug].astro` 直连 import 单个配置文件（`@/config/coverImageConfig` 等）而非走 `@/config` barrel，属于历史遗留的待收敛项，新代码统一用 barrel。

