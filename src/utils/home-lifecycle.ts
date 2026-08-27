/**
 * 首页各层的挂载闸门 —— `definePageIsland` 的首页专用预设。
 *
 * 「一次导航只挂载一次、容器替换前卸载」这套时序已经收敛到
 * [swup-lifecycle.ts](./swup-lifecycle.ts)（含为什么必须这么做的完整说明）。
 * 这里只补两件首页特有的事：
 *
 *   1. 用 `.home-page` 根节点是否存在来判断「本次导航到的是不是首页」，
 *      非首页导航直接跳过挂载；
 *   2. 把层名收敛成 `home:<layer>` 前缀，避免和其它页面级孤岛撞名。
 *
 * 新增首页层照此调用即可，不要自己去挂 `astro:page-load` / `astro:before-swap`。
 */

import type { PageIslandContext } from "@/types/swup";
import { definePageIsland } from "@/utils/swup-lifecycle";

const HOME_ROOT_SELECTOR = ".home-page";

export type HomeLayerHooks = {
	/** 挂载：一次导航只会被调用一次 */
	boot: (context: PageIslandContext) => void;
	/**
	 * 卸载：在容器被替换之前调用。
	 * 此时被 pin 的节点与 ScrollTrigger 自插的 `.pin-spacer` 还在文档里，
	 * kill() 才不会落在游离节点上做 revert。
	 */
	teardown?: () => void;
};

/**
 * 绑定一个首页层。
 * @param layer 层名，只需在首页内唯一（如 `hero`、`blinds`）
 */
export function bindHomeLayer(
	layer: string,
	{ boot, teardown }: HomeLayerHooks,
): void {
	definePageIsland({
		name: `home:${layer}`,
		match: () => document.querySelector(HOME_ROOT_SELECTOR) !== null,
		mount: boot,
		unmount: teardown,
	});
}
