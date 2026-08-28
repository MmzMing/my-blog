/**
 * Swup hover 预载时顺带预取目标页的样式表。
 *
 * ── 为什么需要它 ──
 * `build.cssCodeSplit` 已回到 `true`（按页拆包后首访渲染阻塞 CSS 见
 * docs/plans/2026-07-26-instant-navigation-design.md B3 的实测）。代价是
 * SwupHeadPlugin（`awaitAssets: true`）在首次导航到某类页面时，要等新样式表
 * 下载完才播入场动画 —— 这正是 B3 当初把全站合并成单文件 CSS 的原因。
 *
 * 本模块把这个串行等待藏进 hover 预载：swup 的普通 `on` 处理器排在钩子默认
 * 处理器之后，所以 `page:preload` 触发时 `args.page` 已是抓回来的目标页 HTML。
 * 解析出其中 head 里的样式表，以 `media="print"` 的链接插进当前文档 —— 照常
 * 下载进 `/_astro/*` 的 immutable 缓存，但不作用于当前页渲染。真正点击导航时，
 * SwupHeadPlugin 插入正式样式表直接命中缓存，awaitAssets 几乎零等待。
 *
 * ── 为什么 `media="print"` 是安全的 ──
 * SwupHeadPlugin 用 `outerHTML` 精确相等做 head 去重（@swup/head-plugin 2.3）：
 * 预取链接（media="print" + data 属性）与正式链接（无 media）永远不相等，
 * 换页时前者必然被移除、后者必然被插入，不存在"保留了 print 副本导致新页
 * 样式失效"的路径。
 *
 * ── 防御 ──
 * - 只处理同源绝对路径（Astro 产物全在 `/_astro/`），外链与 data: 不碰；
 * - 同一 href 只插一次（Set + 当前 DOM 双重去重）；
 * - 预取是加速不是正确性依赖：解析失败、钩子不存在都静默跳过。
 */

import type { SwupPageData } from "@/types/swup";
import { onSwupReady } from "@/utils/swup-lifecycle";

const PREFETCHED_HREFS = new Set<string>();

function prefetchStylesheetsFromHtml(html: string): void {
	let doc: Document;
	try {
		doc = new DOMParser().parseFromString(html, "text/html");
	} catch {
		return;
	}

	doc
		.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"][href]')
		.forEach((link) => {
			const href = link.getAttribute("href");
			if (!href?.startsWith("/") || PREFETCHED_HREFS.has(href)) return;
			PREFETCHED_HREFS.add(href);

			// 当前文档已加载（共享 chunk）或已预取过同一样式表时无需再插
			if (document.head.querySelector(`link[rel="stylesheet"][href="${href}"]`))
				return;

			const prefetchLink = document.createElement("link");
			prefetchLink.rel = "stylesheet";
			prefetchLink.href = href;
			// media="print"：低优先级下载进缓存，对当前页的屏幕渲染零影响
			prefetchLink.media = "print";
			prefetchLink.dataset.swupCssPrefetch = "";
			document.head.appendChild(prefetchLink);
		});
}

/** 常驻安装一次。preload 插件未启用时什么都不做。 */
export function installSwupCssPrefetch(): void {
	onSwupReady((swup) => {
		// swup.preload 由 @swup/preload-plugin 提供；未启用时 page:preload 钩子不存在
		if (typeof swup.preload !== "function") return;
		swup.hooks.on("page:preload", (_visit, args) => {
			const page = (args as { page?: SwupPageData } | undefined)?.page;
			if (page?.html) prefetchStylesheetsFromHtml(page.html);
		});
	});
}
