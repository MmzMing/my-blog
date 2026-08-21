import sitemap from "@astrojs/sitemap";
import svelte from "@astrojs/svelte";
import tailwindcss from "@tailwindcss/vite";
import { setMaxListeners } from "node:events";
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { pluginCollapsibleSections } from "@expressive-code/plugin-collapsible-sections";
import { pluginLineNumbers } from "@expressive-code/plugin-line-numbers";
import swup from "@swup/astro";
import { defineConfig } from "astro/config";
import expressiveCode from "astro-expressive-code";
import icon from "astro-icon";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import rehypeComponents from "rehype-components"; /* Render the custom directive content */
import rehypeKatex from "rehype-katex";
import katex from "katex";
import "katex/dist/contrib/mhchem.mjs"; // 加载 mhchem 扩展
import rehypeSlug from "rehype-slug";
import remarkDirective from "remark-directive"; /* Handle directives */
import remarkMath from "remark-math";
import rehypeCallouts from "rehype-callouts";
import remarkSectionize from "remark-sectionize";
import {
	expressiveCodeConfig,
	mermaidConfig,
	plantumlConfig,
	siteConfig,
} from "./src/config";
import { i18n } from "./src/i18n/translation";
import I18nKey from "./src/i18n/i18nKey";
import { pluginLanguageBadge } from "expressive-code-language-badge"; /* Language Badge */
import { pluginCollapsible } from "expressive-code-collapsible"; /* Collapsible */
import { GithubCardComponent } from "./src/plugins/rehype-component-github-card.mjs";
import { pluginLazyCollapsibleCode } from "./src/plugins/expressive-code-lazy-collapsible.mjs";
import { rehypeDiagramPanZoom } from "./src/plugins/rehype-diagram-panzoom.mjs";
import { rehypeMermaid } from "./src/plugins/rehype-mermaid.mjs";
import { rehypePlantuml } from "./src/plugins/rehype-plantuml.mjs";
import { parseDirectiveNode } from "./src/plugins/remark-directive-rehype.js";
import { remarkExcerpt } from "./src/plugins/remark-excerpt.js";
import { remarkMermaid } from "./src/plugins/remark-mermaid.js";
import { remarkPlantuml } from "./src/plugins/remark-plantuml.js";
import { remarkReadingTime } from "./src/plugins/remark-reading-time.mjs";
import mdx from "@astrojs/mdx";
import rehypeEmailProtection from "./src/plugins/rehype-email-protection.mjs";
import rehypeExternalLinks from "./src/plugins/rehype-external-links.mjs";
import rehypeFigure from "./src/plugins/rehype-figure.mjs";
import { remarkImageGrid } from "./src/plugins/remark-image-grid.js";
import { unified } from "@astrojs/markdown-remark";

if (process.env.NODE_ENV === "development") {
	setMaxListeners(20);
}

// 读取文章 frontmatter 的 published/updated 字段，用于 sitemap lastmod
const postsDir = path.resolve("./src/content/posts");
const postLastmodCache = new Map();
function getPostLastmod(postId) {
	if (postLastmodCache.has(postId)) return postLastmodCache.get(postId);
	const filePath = path.join(postsDir, `${postId}.md`);
	let lastmod = null;
	if (fs.existsSync(filePath)) {
		try {
			const { data } = matter.read(filePath);
			lastmod = data.updated || data.published || null;
		} catch {
			// frontmatter 解析失败时返回 null
		}
	}
	postLastmodCache.set(postId, lastmod);
	return lastmod;
}

// https://astro.build/config
export default defineConfig({
	site: siteConfig.site_url,
	
	base: "/",
	trailingSlash: "always",

	// 图像优化配置
	image: {
		// 全局响应式布局
		layout: "constrained",
	},

	integrations: [
		swup({
			theme: false,
			animationClass: "transition-swup-",
			containers: [
				"#swup-container",
				"#left-sidebar-dynamic",
				"#right-sidebar-dynamic",
			],
			smoothScrolling: false,
			cache: true,
			preload: { hover: true, visible: false },
			loadOnIdle: false,
			accessibility: true,
			updateHead: true,
			updateBodyClass: false,
			globalInstance: true,
			resolveUrl: (url) => url,
			animateHistoryBrowsing: false,
			skipPopStateHandling: (event) => {
				return event.state?.url?.includes("#");
			},
		}),
		icon({
			// 不使用 include，让 astro-icon 自动从 Iconify 包加载图标
		}),
		expressiveCode({
			themes: [expressiveCodeConfig.darkTheme, expressiveCodeConfig.lightTheme],
			useDarkModeMediaQuery: false,
			themeCssSelector: (theme) => `[data-theme='${theme.name}']`,
			plugins: [
				// pluginLanguageBadge 配置 - 从expressiveCodeConfig读取设置
				...(expressiveCodeConfig.pluginLanguageBadge?.enable === true
					? [pluginLanguageBadge()]
					: []),
				pluginCollapsibleSections(),
				pluginLineNumbers(),
				// pluginCollapsible 配置 - 从expressiveCodeConfig读取设置，使用i18n文本
				...(expressiveCodeConfig.pluginCollapsible?.enable === true
					? [
							pluginCollapsible({
								lineThreshold:
									expressiveCodeConfig.pluginCollapsible.lineThreshold || 15,
								previewLines:
									expressiveCodeConfig.pluginCollapsible.previewLines || 8,
								defaultCollapsed:
									expressiveCodeConfig.pluginCollapsible.defaultCollapsed ??
									true,
								expandButtonText: i18n(I18nKey.codeCollapsibleShowMore),
								collapseButtonText: i18n(I18nKey.codeCollapsibleShowLess),
								expandedAnnouncement: i18n(I18nKey.codeCollapsibleExpanded),
								collapsedAnnouncement: i18n(I18nKey.codeCollapsibleCollapsed),
							}),
							pluginLazyCollapsibleCode({
								lineThreshold: 200,
								previewLines:
									expressiveCodeConfig.pluginCollapsible.previewLines || 8,
							}),
						]
					: []),
			],
			defaultProps: {
				wrap: false,
				overridesByLang: {
					shellsession: {
						showLineNumbers: false,
					},
				},
			},
			styleOverrides: {
				borderRadius: "0.75rem",
				codeFontSize: "0.875rem",
				codeFontFamily:
					"'JetBrains Mono Variable', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
				codeLineHeight: "1.5rem",
				frames: {},
				textMarkers: {
					delHue: 0,
					insHue: 180,
					markHue: 250,
				},
				languageBadge: {
					fontSize: "0.75rem",
					fontWeight: "bold",
					borderRadius: "0.25rem",
					opacity: "1",
					borderWidth: "0px",
					borderColor: "transparent",
				},
			},
			frames: {
				showCopyToClipboardButton: true,
			},
		}),
		svelte(),
		sitemap({
			customPages: [
				new URL("/llms.txt", siteConfig.site_url).toString(),
			],
			filter: (page) => {
				// 根据页面开关配置过滤sitemap
				const url = new URL(page);
				const pathname = url.pathname;

				// 搜索页不应被搜索引擎索引（Google 明确建议屏蔽搜索结果页）
				if (pathname === "/search/") {
					return false;
				}
				if (pathname === "/friends/" && !siteConfig.pages.friends) {
					return false;
				}
				if (pathname === "/sponsor/" && !siteConfig.pages.sponsor) {
					return false;
				}
				if (pathname === "/guestbook/" && !siteConfig.pages.guestbook) {
					return false;
				}
				if (pathname === "/bangumi/" && !siteConfig.pages.bangumi) {
					return false;
				}
				if (pathname === "/gallery/" && !siteConfig.pages.gallery) {
					return false;
				}

				return true;
			},
			serialize: (item) => {
				const pathname = new URL(item.url).pathname;

				if (pathname === "/") {
					// 首页：最高优先级，每周更新
					item.priority = 1.0;
					item.changefreq = "weekly";
				} else if (pathname.startsWith("/posts/")) {
					// 文章页：高优先级，基于 frontmatter 的 updated/published 设置 lastmod
					const postId = pathname
						.replace(/^\/posts\//, "")
						.replace(/\/$/, "");
					const lastmod = getPostLastmod(postId);
					if (lastmod) {
						item.lastmod = new Date(lastmod).toISOString();
					}
					item.priority = 0.8;
					item.changefreq = "monthly";
				} else if (
					["/archive/", "/categories/", "/tags/"].includes(pathname)
				) {
					// 归档/分类/标签列表页：中优先级，有新文章时会更新
					item.priority = 0.6;
					item.changefreq = "weekly";
				} else {
					// 其他功能页（about/friends/gallery 等）：低优先级
					item.priority = 0.5;
					item.changefreq = "monthly";
				}

				return item;
			},
		}),
		mdx(),
	],
	markdown: {
		processor: unified({
			remarkPlugins: [
				remarkMath,
				remarkReadingTime,
				remarkImageGrid,
				remarkExcerpt,
				remarkDirective,
				remarkSectionize,
				parseDirectiveNode,
				remarkMermaid,
				[remarkPlantuml, plantumlConfig],
			],
			rehypePlugins: [
				[rehypeKatex, { katex }],
				[rehypeCallouts, { theme: siteConfig.rehypeCallouts.theme }],
				rehypeSlug,
				[rehypeMermaid, mermaidConfig],
				rehypePlantuml,
				rehypeDiagramPanZoom,
				rehypeFigure,
				[rehypeExternalLinks, { siteUrl: siteConfig.site_url }],
				[rehypeEmailProtection, { method: "base64" }], // 邮箱保护插件，支持 'base64' 或 'rot13'
				[
					rehypeComponents,
					{
						components: {
							github: GithubCardComponent,
						},
					},
				],
				[
					rehypeAutolinkHeadings,
					{
						behavior: "append",
						properties: {
							className: ["anchor"],
						},
						content: {
							type: "element",
							tagName: "span",
							properties: {
								className: ["anchor-icon"],
								"data-pagefind-ignore": true,
							},
							children: [
								{
									type: "text",
									value: "#",
								},
							],
						},
					},
				],
			],
		}),
	},
	vite: {
		plugins: [tailwindcss()],
		server: {
			watch: {
				ignored: ["**/package/**", "**/Firefly-docs/**"],
			},
			proxy: {
				"^/api/(?!allPostMeta\\.json/?(?:$|\\?)|holidays\\.json/?(?:$|\\?))": {
					target: "http://localhost:8787",
					changeOrigin: true,
				},
			},
		},
		resolve: {
			alias: {
				"@rehype-callouts-theme": `rehype-callouts/theme/${siteConfig.rehypeCallouts.theme}`,
			},
		},
		build: {
			// 静态资源缓存策略（需在部署平台配置）：
			// /_astro/*  → Cache-Control: public, max-age=31536000, immutable（内容哈希，长期缓存）
			// /assets/*  → Cache-Control: public, max-age=31536000, immutable（静态资源，长期缓存）
			// /*.html    → Cache-Control: public, max-age=0, must-revalidate（HTML 文件，始终验证）
			// Cloudflare Pages: public/_headers 文件 | Vercel: vercel.json 的 headers 配置
			minify: "esbuild",
			esbuildOptions: {
				minify: true,
				// 移除 console.log 和 debugger
				drop: ["console", "debugger"],
			},
			rollupOptions: {
				output: {
					manualChunks(id) {
						if (id.includes("node_modules")) {
							if (id.includes("katex")) return "vendor-katex";
							if (id.includes("mermaid")) return "vendor-mermaid";
							if (id.includes("pixi") || id.includes("live2d")) return "vendor-live2d";
							if (id.includes("gsap")) return "vendor-gsap";
						}
						if (id.includes("AISearch")) return "vendor-ai";
						if (id.includes("Guestbook")) return "vendor-guestbook";
						if (id.includes("CalendarGrid")) return "vendor-calendar";
					},
				},
				onwarn(warning, warn) {
					// temporarily suppress this warning
					if (
						warning.message.includes("is dynamically imported by") &&
						warning.message.includes("but also statically imported by")
					) {
						return;
					}
					// gsap 在 Svelte 事件处理器中使用，Vite tree-shaking 误报
					if (
						warning.message.includes('"gsap"') &&
						warning.message.includes("but never used")
					) {
						return;
					}
					warn(warning);
				},
			},
			// CSS 优化
			cssCodeSplit: false,
			cssMinify: "esbuild",
			assetsInlineLimit: 4096,
		},
	},
});
