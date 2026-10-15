/**
 * 首页各层的挂载闸门 —— `definePageIsland` 的首页专用预设。
 *
 * 「一次导航只挂载一次、容器替换前卸载」这套时序已经收敛到
 * [swup-lifecycle.ts](./swup-lifecycle.ts)（含为什么必须这么做的完整说明）。
 * 这里只补三件首页特有的事：
 *
 *   1. 用 `.home-page` 根节点是否存在来判断「本次导航到的是不是首页」，
 *      非首页导航直接跳过挂载；
 *   2. 把层名收敛成 `home:<layer>` 前缀，避免和其它页面级孤岛撞名；
 *   3. 用 `media` 声明该层生效的视口条件。桌面/移动两套首页各自只在匹配时挂载，
 *      条件翻转时先 teardown 再 boot —— 尺寸判断只发生在 boot 里的旧写法会在
 *      导航后跨断点遗留「已隐藏但从未初始化」或「已初始化但拆不掉」的层。
 *
 * `waitForHomeLayout` 给导航用：首页的 pin 由异步挂载建立，滚轮位置必须等各层
 * 报告就绪后再恢复，否则会落在尚未撑高的文档上。层就绪状态记在按首页根节点索引的
 * WeakMap 里，容器一换自然作废，不需要显式清理。
 */

import type { PageIslandContext } from "@/types/swup";
import { definePageIsland } from "@/utils/swup-lifecycle";

const HOME_ROOT_SELECTOR = ".home-page";
const HOME_LAYOUT_EVENT = "firefly:home-layout-ready";
/** 等待首页各层就绪的上限：异常时宁可停在当前位置，也不能让换入内容一直不显示 */
const HOME_LAYOUT_TIMEOUT = 2000;
const HOME_LAYER_SELECTORS = {
	hero: "[data-home-hero]",
	"data-layer": "#home-data-layer",
	blinds: "#home-blinds",
	mobile: "#home-mobile",
};
const readyLayers = new WeakMap<Element, Set<string>>();

export type HomeLayerHooks = {
	boot: (context: PageIslandContext) => void | Promise<void>;
	teardown?: () => void;
	media?: string;
};

export function waitForHomeLayout(signal: AbortSignal): Promise<void> {
	const root = document.querySelector(HOME_ROOT_SELECTOR);
	if (!root || signal.aborted) return Promise.resolve();
	const required = Object.entries(HOME_LAYER_SELECTORS)
		.filter(([, selector]) => root.querySelector(selector))
		.map(([layer]) => layer);
	const isReady = (): boolean =>
		required.every((layer) => readyLayers.get(root)?.has(layer));
	if (isReady()) return Promise.resolve();

	return new Promise((resolve) => {
		const finish = (): void => {
			window.clearTimeout(timer);
			document.removeEventListener(HOME_LAYOUT_EVENT, check);
			signal.removeEventListener("abort", finish);
			resolve();
		};
		const check = (): void => {
			if (!root.isConnected || isReady()) finish();
		};
		// 外部模块加载失败也不能让导航永久停在等待布局的阶段。
		const timer = window.setTimeout(finish, HOME_LAYOUT_TIMEOUT);
		document.addEventListener(HOME_LAYOUT_EVENT, check);
		signal.addEventListener("abort", finish, { once: true });
		check();
	});
}

export function bindHomeLayer(
	layer: string,
	{ boot, teardown, media }: HomeLayerHooks,
): void {
	let cleanup: (() => void) | undefined;
	definePageIsland({
		name: `home:${layer}`,
		match: () => document.querySelector(HOME_ROOT_SELECTOR) !== null,
		mount: (context) => {
			const root = document.querySelector(HOME_ROOT_SELECTOR);
			if (!root) return;
			let ready = readyLayers.get(root);
			if (!ready) {
				ready = new Set();
				readyLayers.set(root, ready);
			}
			const layers = ready;
			const controller = new AbortController();
			const mediaQuery = media ? window.matchMedia(media) : null;
			const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
			let mounted = false;
			let version = 0;
			const unmount = (): void => {
				version += 1;
				layers.delete(layer);
				if (!mounted) return;
				mounted = false;
				teardown?.();
			};
			const mount = (): void => {
				const current = ++version;
				const settle = (): void => {
					if (controller.signal.aborted || current !== version) return;
					layers.add(layer);
					document.dispatchEvent(new Event(HOME_LAYOUT_EVENT));
				};
				if (mediaQuery && !mediaQuery.matches) {
					settle();
					return;
				}
				mounted = true;
				try {
					void Promise.resolve(boot(context)).then(settle, (error: unknown) => {
						console.error(`[home:${layer}] 初始化失败`, error);
						settle();
					});
				} catch (error) {
					settle();
					throw error;
				}
			};
			const restart = (): void => {
				unmount();
				mount();
			};
			cleanup = () => {
				controller.abort();
				unmount();
			};
			mediaQuery?.addEventListener("change", restart, {
				signal: controller.signal,
			});
			motionQuery.addEventListener("change", restart, {
				signal: controller.signal,
			});
			mount();
		},
		unmount: () => {
			cleanup?.();
			cleanup = undefined;
		},
	});
}
