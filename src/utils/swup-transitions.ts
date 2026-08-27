/**
 * Swup 切页编排：进度条、回顶、主题校正、容器外组件的状态同步。
 *
 * 只放「跨页面共享、且必须绑在 swup 原生钩子上」的逻辑。页面级组件不要写在这里 ——
 * 它们各自用 [swup-lifecycle.ts](./swup-lifecycle.ts) 的 `definePageIsland` 登记。
 *
 * 由 [layout-init.ts](./layout-init.ts) 调用，全站只注册一次。
 */

import { expressiveCodeConfig, siteConfig } from "@/config";
import { finishProgressBar, startProgressBar } from "@/utils/progress-bar";
import { onSwupHook } from "@/utils/swup-lifecycle";

/** 移动端回顶会和换入动画打架，只在桌面宽度做即时回顶 */
const SMOOTH_SCROLL_MIN_WIDTH = 768;
/** 切页动画结束后再放开 TOC 内部导航标记的延时 */
const TOC_FLAG_RESET_DELAY = 400;

/** 快速连续导航时，上一趟的延时重置不能落到新一趟上 */
let tocFlagResetTimer: ReturnType<typeof setTimeout> | null = null;

function clearTocFlagResetTimer(): void {
	if (tocFlagResetTimer === null) return;
	clearTimeout(tocFlagResetTimer);
	tocFlagResetTimer = null;
}

/**
 * 侧边栏挂件在 Swup 容器之外，切页后要按新路径重算显隐。
 * 首次加载不必跑：服务端渲染出来的类名已经是对的。
 */
function updateSidebarWidgetVisibility(): void {
	const isPost = window.location.pathname.includes("/posts/");
	document.querySelectorAll(".widget-hide-on-post").forEach((element) => {
		element.classList.toggle("hidden", isPost);
	});
	document.querySelectorAll(".widget-hide-on-non-post").forEach((element) => {
		element.classList.toggle("hidden", !isPost);
	});
}

/**
 * 校正代码块主题。
 * expressive-code 的配色由 `data-theme` 选中，而该属性只在首屏的 inline 脚本里设过；
 * 切页后若与 localStorage 里的主题不一致，代码块会保持上一套配色。
 */
function syncExpressiveCodeTheme(): void {
	const storedTheme =
		localStorage.getItem("theme") ||
		siteConfig.themeColor.defaultMode ||
		"light";
	const expectedTheme =
		storedTheme === "dark"
			? expressiveCodeConfig.darkTheme
			: expressiveCodeConfig.lightTheme;
	if (document.documentElement.getAttribute("data-theme") !== expectedTheme) {
		document.documentElement.setAttribute("data-theme", expectedTheme);
	}
}

/** 注册 Swup 切页钩子。实例就绪时序由 `onSwupHook` 处理。 */
export function setupSwupTransitions(): void {
	// content:replace 时 URL 已更新，此刻同步显隐即可，page:view 不必再来一遍
	onSwupHook("content:replace", updateSidebarWidgetVisibility);

	onSwupHook("visit:start", () => {
		clearTocFlagResetTimer();
		startProgressBar();
		if (window.innerWidth >= SMOOTH_SCROLL_MIN_WIDTH) {
			window.scrollTo({ top: 0, behavior: "auto" });
		}
	});

	onSwupHook("page:view", syncExpressiveCodeTheme);

	onSwupHook("visit:end", () => {
		finishProgressBar();
		tocFlagResetTimer = setTimeout(() => {
			tocFlagResetTimer = null;
			window.tocInternalNavigation = false;
		}, TOC_FLAG_RESET_DELAY);
	});
}
