# 核心原则，先读

只做用户要求的修改，先读实现，再复用已有能力，最后验证结果。技术事实以当前代码和配置为准。

- **最小改动**：不附带重构、无关格式化或删除看似无用的代码，不覆盖用户已有改动。
- **授权范围**：下方受限操作必须获得明确指令，不以补全工作或保持一致为由扩大授权；不确定时先问。
- **复用优先**：修改前阅读实现及调用方，搜索 `src/utils/`、`src/config/`、`src/constants/`，不重复实现已有逻辑。
- **避免扩张**：不主动新增配置项、开关、抽象层或防御性兜底代码；范围外问题只在回复中指出。
- **停止条件**：同一方案连续失败 2 次就停下说明原因，不做第 3 次同类微调。
- **如实交付**：未读过的文件、未执行的检查，不得声称已验证。交付前完成文末自查。

# 项目定位与工具链

`firefly-mod` 是由 Firefly / fuwari 演进的个人博客：Astro 7 静态输出、Svelte 5 岛组件、Tailwind CSS 4、Swup 4 导航、Pagefind 搜索。

**只用 pnpm**，版本由 `package.json` 的 `packageManager` 指定；Astro 要求 Node ≥ 22.12.0。

# 操作授权边界

以下操作仅在用户明确要求对应动作后执行：

- **Git 写操作**：暂存、提交、推送，创建/切换/重命名/删除分支，合并、变基、重置、回退、清理、stash、tag，以及创建/合并 PR 或 MR。不得自行修改 `git config`、`.gitignore`、`.gitattributes`。允许 `git status`、`git diff`、`git log`、`git show` 等只读查询。
- **文档与测试体系**：新建 Markdown 文档、测试框架配置，批量补测试，引入 E2E、截图对比或视觉回归。不得自行安装或启动 Playwright（含 test、codegen、浏览器下载）。
- **依赖与工程配置**：修改依赖或 lockfile、升级框架主版本，修改 `astro.config.mjs`、`biome.json`、`tsconfig.json`、`vercel.json`、`wrangler.jsonc`、`.github/workflows/*` 等行为性配置。确有必要时，先说明原因与影响，等用户确认。
- **文件与静态资源**：批量删除文件/目录、递归删除、重命名或移动目录；修改 `public/` 下的站长验证文件和 Live2D 模型资源。
- **外部影响**：线上部署、清缓存、修改 DNS 或环境变量；执行 `pnpm indexnow` 等外部数据推送命令，`--dry-run` 也需确认。
- **敏感信息**：不得自行读取或回显 `.env`、密钥、Token 的具体值；密钥不得写入源码、配置、注释或回复。

# 架构与文件组织

- **静态优先**：默认静态渲染，仅在需要交互时使用 Svelte 岛，选择满足需求的最小 `client:*` 指令。
- **逻辑分层**：组件 frontmatter 负责数据准备，复杂逻辑下沉工具模块；工具函数不夹带副作用，控制器不承担数据获取。
- **客户端模块**：行为放在 `src/utils/*-controller.ts` / `*-lifecycle.ts`，由组件脚本导入，不把业务逻辑内联进组件。
- **组件归属**：沿用 `src/components/` 现有分类。组件用 `PascalCase.astro` / `PascalCase.svelte`，工具用 `kebab-case.ts`，配置沿用 `xxxConfig.ts`、既有具名导出与对象命名。
- **公共类型**：共享类型放 `src/types/`；组件本地 Props 可就地定义，并明确必填与可选。

# TypeScript、命名与导入

- **类型约束**：禁止 `any`；未知值用 `unknown` 后收窄。不以类型断言、`@ts-ignore` 或 `@ts-expect-error` 掩盖类型错误。导出函数写显式返回类型。
- **类型表达**：纯类型用 `import type`（Astro / Svelte 按现有规则）；优先判别联合，枚举显式赋初值。
- **命名规则**：变量/函数用 `camelCase`，类型用 `PascalCase`，常量用 `SCREAMING_SNAKE_CASE`；布尔量用 `is` / `has` / `should` / `enable` 前缀，避免无含义命名。
- **路径别名**：使用 `@/*`、`@components/*`、`@assets/*`、`@constants/*`、`@utils/*`、`@i18n/*`、`@layouts/*`，不新增深层相对导入或循环依赖。
- **格式规则**：Biome 使用制表符、双引号、自动整理 import；遵循 `biome.json`，不得扩大忽略范围来规避错误。CSS 与生成的 `icons.ts` 不在其检查范围内。

# 注释与文档

- **注释用途**：解释原因与权衡，避免复述代码；跟随所在文件语言，通常使用中文。
- **文档更新**：代码改动可同步更新已有且直接相关的注释或文档段落；排查过程和工作总结直接在对话中回复。
- **生成文件**：保留禁改注释，通过生成脚本更新产物。

# 配置与路由

- **配置入口**：站点配置位于 `src/config/`，统一从 `@/config` 导入，例如 `import { siteConfig, homeConfig } from "@/config"`；公共配置类型位于 `src/types/config.ts`。
- **页面开关**：新增受开关控制的页面时，同步检查 `siteConfig.pages`、`src/config/navBarConfig.ts`、页面自身及 sitemap 过滤逻辑。涉及受限工程配置时仍需明确授权。
- **链接生成**：`base: "/"`、`trailingSlash: "always"`。站内页面链接通过 `src/utils/url-utils.ts` 生成并带尾斜杠；文件、静态资源和 JSON/TXT 端点不套用页面尾斜杠规则。

# 内容集合与 Markdown

- **集合定义**：`src/content.config.ts` 中，`posts` 对应 `src/content/posts/**/*.{md,mdx}`；`spec` 承载关于页、许可证等文案，schema 为空对象。
- **文章查询**：统一走 `src/utils/content-utils.ts`，如 `getSortedPosts`、`getTagList`、`getCategoryList`、`getKnowledgeGraphData`。页面不要直接 `getCollection("posts")`，避免绕过草稿过滤、排序和上下篇关联；开发模式允许展示草稿。
- **标签链接**：优先使用查询结果的 `tag.url`，避免为未生成枢纽页的标签构造失效链接。
- **内容字段**：修改文章 schema 前先说明影响；新增 frontmatter 字段时检查文章模板、Wiki 输出和 sitemap 的 lastmod。日期格式化复用 `dayjs` 与 `src/utils/date-utils.ts`。
- **渲染管线**：Markdown 通过 `astro.config.mjs` 中的 `unified()` 配置，扩展位于 `src/plugins/`。新增语法需注册到 remark / rehype；代码块使用 `astro-expressive-code` 及既有扩展，不另建渲染链。
- **机器产物**：`src/utils/llm-wiki.ts` 经 `src/pages/llms.txt.ts` 和 `src/pages/wiki/` 输出 `llms.txt`、`wiki/index.json`、`wiki/articles/{slug}.{json,md}`。`isPublicWikiPost` 排除草稿、加密文章与 `wikiExclude: true` 的文章；不使用 Embedding、向量库或 Worker。

# Swup 导航与生命周期

修改客户端脚本前，先读 `src/utils/swup-lifecycle.ts`。布局外壳见 `src/layouts/Layout.astro` 与 `src/layouts/MainGridLayout.astro`，Swup 公共类型见 `src/types/swup.ts`。

Swup 只替换 `#swup-container`、`#left-sidebar-dynamic`、`#right-sidebar-dynamic`；导航栏、页脚、悬浮坞、Live2D 和音乐管理器在容器外，跨导航常驻。

- **页面组件**：容器内使用 `definePageIsland({ name, mount, unmount, match? })`，统一管理首次加载和每次导航。
- **常驻组件**：容器外使用 `definePersistentIsland(name, setup)`；导航后同步和替换前清理使用 `onNavigation` / `onBeforeSwap`。
- **实例与钩子**：使用 `onSwupHook` / `getSwup` / `preloadUrl`，不另写实例等待或预载逻辑。
- **首页各层**：使用 `src/utils/home-lifecycle.ts` 的 `bindHomeLayer(layer, { boot, teardown, media? })`，复用首页匹配、`home:` 命名及媒体条件切换；涉及布局就绪与滚动恢复时检查 `waitForHomeLayout`。
- **事件时序**：桥接的 `astro:before-swap`、`astro:after-swap`、`astro:page-load` 都是无 `detail` 的 `Event`，首次加载不派发；`onNavigation` 也不覆盖首次加载。不得自行拼 DOM 事件或依赖 `DOMContentLoaded` / `window.onload` 初始化页面。
- **脚本重执行**：外部 module 脚本再次进入页面通常不会重执行，`is:inline` 脚本会在每次导航重执行。解析期内联代码是例外：不能直接使用生命周期模块导出，沿用现有事件桥接，在交互时惰性访问 `window.swup`，不新增另一套页面生命周期。

# 清理与内存管理

- **卸载顺序**：生命周期入口先卸载旧组件，再递增导航代数，导航完成后补挂载。不要改变该顺序；ScrollTrigger 必须在旧 DOM 移除前 `kill()`。
- **资源释放**：`unmount` 必须清理监听、定时器、观察者、动画帧、GSAP 时间轴和 ScrollTrigger，并重置页面状态；挂载中途失败也应能清理。
- **组件通信**：跨常驻组件通信用 `CustomEvent`，不依赖临时全局变量。

# 样式、主题与国际化

- **样式归属**：复用样式按既有层级引入 `src/styles/main.css`；页面专属 CSS 只在对应页面或独占组件的 frontmatter 中导入，保持按页拆包。Swup 样式预取见 `src/utils/swup-css-prefetch.ts`。
- **设计变量**：优先 Tailwind，复杂选择器、伪元素和动画使用独立 CSS；沿用 BEM 类名与现有设计变量，不硬编码主题色或魔法数字。变量主要在 `src/styles/variables.styl`。
- **主题切换**：深浅色主要依赖根元素 `.dark`；`data-theme` 同步 Expressive Code 的主题名，不假设其值是 `dark` / `light`。
- **动画约束**：尊重 `prefers-reduced-motion`；修改导航时长与节奏前，先读 `docs/plans/` 中相关既有结论。
- **界面翻译**：文案与用户可见错误使用 `i18n(I18nKey.xxx)`。新增 key 时补齐 `src/i18n/languages/` 的 en、zh_CN、zh_TW、ja、ru；语言由 `siteConfig.lang` 决定。

# 图片与生成资源

- **封面入口**：文章封面由 `src/utils/cover-image.ts` 的 `buildCoverImage()` 在构建期解析，再交给 `src/components/common/CoverImage.astro` 渲染。相对本地图片经 Astro 优化且不放大；public 和远程图原样引用。
- **优化边界**：不在列表页或文章页重复 `import.meta.glob` 后直接取 `ImageMetadata.src`，也不使用裸 `<img>` 绕过封面管线；其他图片沿用已有 Astro 图片优化方式。
- **LQIP 数据**：`src/utils/lqip-utils.ts` 导入整份 `src/constants/lqips.json`，仅供构建期使用，不可导入客户端组件。数据由 `scripts/generate-lqips.ts` 增量生成。
- **图标生成**：`src/constants/icons.ts` 由 `scripts/generate-icons.js` 扫描源码生成，禁止手改。图标缺失时检查 `extractIconNames` 与 `ICON_SETS`，修正引用或脚本后跑 `pnpm icons`。

# 性能与错误处理

- **构建期计算**：列表和其他可静态计算的数据在构建期完成；客户端定位目标节点，不在导航回调里扫描全量 DOM 或遍历全量文章。
- **依赖加载**：重依赖优先按需动态加载；现有 KaTeX、Mermaid、Live2D、GSAP 分包规则见 `astro.config.mjs`，相关配置改动遵守授权边界。
- **失败路径**：异步操作、外部请求和文件读取要有明确失败路径；必要的构建期读取做存在性检查与异常处理。确需忽略错误时写明原因，不静默吞错。
- **服务降级**：Waline、Twikoo、Umami、Meting 等第三方服务失败时，不白屏、不阻塞页面。
- **生产日志**：客户端构建移除 `console.*` 和 `debugger`，不得依赖它们做线上排查。

# 安全与内容渲染

- **动态 HTML**：用户或第三方 HTML 经 `sanitize-html` 清理后才可进入 `set:html` / `innerHTML`；纯文本使用模板转义或 `textContent`，不拼接 HTML。
- **外链与邮箱**：Markdown 由 `rehype-external-links`、`rehype-email-protection` 处理；组件中的新窗口外链仍需设置 `rel="noopener noreferrer"`，Markdown 插件不会处理组件模板。
- **文章加密**：`src/utils/crypto-utils.ts` 提供访问门槛，修改时不得承诺真正的机密保护。
- **接口边界**：`src/pages/api/*` 当前输出静态 JSON，路径本身不提供鉴权；涉及敏感数据或新增写操作时须先说明鉴权与运行方式。

# 仓库特有注意事项

- **过时配置说明**：`README.md`、`src/config/README.md` 仍列出已删除的 `sidebarConfig.ts`；`src/types/config.ts` 也有过时的 `sidebarLayoutConfig` 注释。以实际目录为准，不据此恢复旧实现。
- **历史导入方式**：`src/pages/posts/[...slug].astro` 仍直连导入单个配置文件；新代码统一从 `@/config` 导入，不顺手扩大修复范围。
- **友链自动化**：Playwright 隔离在 `.github/scripts/package.json`，仅供友链 CI 使用，不属于站点根包依赖；本地使用遵守操作授权边界。
- **持续集成**：push / PR 到 `master` 时执行 `pnpm astro check` 和 `biome ci ./src`，见 `.github/workflows/ci.yml`。

# 常用命令

```bash
pnpm dev                 # Astro 开发服务器
pnpm check               # Astro 类型与组件诊断
pnpm type-check          # tsc --noEmit
pnpm build               # 图标 → LQIP → Astro 构建 → Pagefind 索引
pnpm preview             # 预览 dist/ 产物
pnpm icons               # 生成 src/constants/icons.ts
pnpm lqips               # 增量生成 src/constants/lqips.json
pnpm new-post <name>     # 创建文章
pnpm lint                # biome check --write ./src，会修改源码
pnpm format              # biome format --write ./src，会修改源码
```

# Git 提交规则（仅在用户明确要求后）

- **提交格式**：使用 Conventional Commits：`type(scope): 中文描述`，参考已有 `git log`；一个提交只做一件事。
- **提交检查**：完成文末检查后再提交；`pnpm lint` 会写入整个 `src/`，为限定修改范围，可用 `pnpm exec biome check --write <相关源码文件>` 完成 Biome 检查。
- **暂存范围**：只暂存明确涉及的文件，禁止 `git add .`；疑似含密钥的文件先提醒用户。
- **独立授权**：保留 hooks，禁止 `--no-verify`；提交授权不等于推送或创建 PR 的授权。

# 完成标准（交付前自查）

- [ ] **范围**：检查 diff，确认只包含本次任务修改，没有覆盖用户改动或执行未授权操作。
- [ ] **代码诊断**：代码改动必跑 `pnpm check`；提交前同样必跑。检查失败先定位，不擅自修复范围外问题，交付时如实说明。
- [ ] **格式检查**：需要检查格式或提交代码时，对相关源码执行 `pnpm exec biome check <相关文件>`，不为验证而对整个 `src/` 执行写入式格式化。
- [ ] **构建验证**：涉及构建产物或 Markdown 管线时跑 `pnpm build`。
- [ ] **界面验证**：样式改动覆盖深浅两种主题；动画改动检查 `prefers-reduced-motion`。
- [ ] **结果说明**：回复改了什么、为何修改、实际完成的验证及未解决的问题，不另建总结文件。
