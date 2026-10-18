/**
 * Swup 切页编排：进度条、回顶、主题校正、容器外组件的状态同步。
 *
 * 只放「跨页面共享、且必须绑在 swup 原生钩子上」的逻辑。页面级组件不要写在这里 ——
 * 它们各自用 [swup-lifecycle.ts](./swup-lifecycle.ts) 的 `definePageIsland` 登记。
 *
 * 由 [layout-init.ts](./layout-init.ts) 调用，全站只注册一次。
 */

import { expressiveCodeConfig, siteConfig } from "@/config";
import type { NavigationScrollPosition } from "@/types/swup";
import { waitForHomeLayout } from "@/utils/home-lifecycle";
import { finishProgressBar, startProgressBar } from "@/utils/progress-bar";
import { flushScrollTriggerRefresh } from "@/utils/scroll-trigger-refresh";
import { getSwup, onSwupHook, onSwupReady } from "@/utils/swup-lifecycle";

function getHistoryIndex(): number | null {
	const state: unknown = history.state;
	return state &&
		typeof state === "object" &&
		"index" in state &&
		typeof state.index === "number"
		? state.index
		: null;
}
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
	const positions = new Map<number, NavigationScrollPosition>();
	let activeIndex = getHistoryIndex();
	onSwupReady(() => {
		activeIndex = getHistoryIndex();
	});
	let pendingPosition: NavigationScrollPosition | undefined;
	let pendingAnchor = "";
	let restoration = new AbortController();
	const root = document.documentElement;
	const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
	history.scrollRestoration = "auto";

	const restorePosition = async (): Promise<void> => {
		const signal = restoration.signal;
		const position = pendingPosition;
		const anchor = pendingAnchor;
		if (!position && !anchor) return;
		await waitForHomeLayout(signal);
		if (signal.aborted) return;
		flushScrollTriggerRefresh();
		if (position) {
			window.scrollTo({ ...position, behavior: "instant" });
		} else {
			getSwup()?.getAnchorElement(anchor)?.scrollIntoView({
				behavior: "instant",
				block: "start",
			});
		}
		pendingPosition = undefined;
		pendingAnchor = "";
		root.classList.remove("is-content-pending");
		releaseManualRestoration();
	};

	/**
	 * 刷新时浏览器在 load 之后还会按 `scrollRestoration` 恢复一次滚动位置。
	 * 提前改回 auto 会让这次恢复盖掉我们刚设好的位置（表现为刷新首页仍停在原处），
	 * 因此等 load 之后再交还给浏览器。SPA 内导航不涉及原生恢复，直接交还。
	 */
	const releaseManualRestoration = (): void => {
		if (document.readyState === "complete") {
			history.scrollRestoration = "auto";
			return;
		}
		window.addEventListener(
			"load",
			() => {
				history.scrollRestoration = "auto";
			},
			{ once: true },
		);
	};

	// 刷新首页时从第一帧重播入场编排，由持有 ScrollTrigger 的 hero 层负责复位：
	// ScrollTrigger 会记住加载时的滚动位置并在首帧后回灌，导航层不引 gsap 就压不住它。

	// Head 插件会先撤掉旧 CSS 再等新 CSS，必须比它更早遮住内容；
	// 减少动画模式没有退场动画遮挡，也需要经过这道准备闸门。
	onSwupHook(
		"content:replace",
		() => {
			root.classList.add("is-content-pending");
		},
		{ before: true, priority: -1 },
	);

	onSwupHook("content:replace", () => {
		updateSidebarWidgetVisibility();
		root.classList.toggle(
			"is-content-pending",
			Boolean(pendingPosition || pendingAnchor),
		);
	});

	onSwupHook("visit:start", (visit) => {
		// @swup/astro 不透传 animateHistoryBrowsing，在本次导航上启用现有过渡；
		// 不开启 Swup 的滚动重置，历史位置仍由下方的恢复逻辑负责。
		if (visit.history.popstate) {
			visit.animation.animate = !reducedMotion.matches;
		}
		restoration.abort();
		restoration = new AbortController();
		clearTocFlagResetTimer();
		startProgressBar();
		if (activeIndex !== null) {
			positions.set(activeIndex, { left: window.scrollX, top: window.scrollY });
		}
		const targetIndex = getHistoryIndex();
		pendingPosition =
			visit.history.popstate && targetIndex !== null
				? positions.get(targetIndex)
				: undefined;
		pendingAnchor = !visit.history.popstate ? (visit.to.hash ?? "") : "";
		const restoring = Boolean(pendingPosition || pendingAnchor);
		root.classList.remove("is-content-pending");
		history.scrollRestoration = restoring ? "manual" : "auto";
		// 锚点要等首页 pin 建好再定位，不能在临时文档高度上计算目标。
		if (pendingAnchor) visit.scroll.target = false;
	});

	onSwupHook(
		"scroll:top",
		(visit, args) => {
			args.options.behavior =
				getSwup()?.visit !== visit && !reducedMotion.matches
					? "smooth"
					: "instant";
		},
		{ before: true },
	);
	onSwupHook(
		"scroll:anchor",
		(visit, args) => {
			args.options.behavior =
				getSwup()?.visit !== visit && !reducedMotion.matches
					? "smooth"
					: "instant";
		},
		{ before: true },
	);

	onSwupHook("page:view", async (visit) => {
		activeIndex = getHistoryIndex();
		if (!visit.history.popstate && activeIndex !== null)
			positions.delete(activeIndex);
		syncExpressiveCodeTheme();
		await restorePosition();
	});

	onSwupHook("visit:abort", () => {
		restoration.abort();
		pendingPosition = undefined;
		pendingAnchor = "";
		root.classList.remove("is-content-pending");
		history.scrollRestoration = "auto";
	});

	onSwupHook("visit:end", () => {
		history.scrollRestoration = "auto";
		finishProgressBar();
		tocFlagResetTimer = setTimeout(() => {
			tocFlagResetTimer = null;
			window.tocInternalNavigation = false;
		}, TOC_FLAG_RESET_DELAY);
	});
}
