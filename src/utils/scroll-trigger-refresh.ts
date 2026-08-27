/**
 * 合并同一帧内的多次 `ScrollTrigger.refresh()`。
 *
 * 首页有两处独立建 pin：hero 在 `mountHomeHero()` 里同步建完立刻 refresh，
 * 影像层要等 `await import("gsap")` 之后才建。两次 refresh 各自量一遍文档高度，
 * 先跑的那次看不到后跑的那层插进来的 `.pin-spacer`，算出来的 pin 起止点是错的
 * （表现为进首页后 hero 第二幕与影像层的滚动进度对不上）。
 *
 * 攒到下一帧再统一 refresh 一次，各层的 pin 都已插好；refresh 本身是幂等的，
 * 合并只会少做无用功，不会漏掉任何一次。
 */

type ScrollTriggerLike = {
	refresh: (safe?: boolean) => void;
};

let frame = 0;
let pending: ScrollTriggerLike | null = null;

export function requestScrollTriggerRefresh(
	ScrollTrigger: ScrollTriggerLike,
): void {
	// hero 与影像层拿到的是同一个 ScrollTrigger 单例，后写覆盖前写没有副作用
	pending = ScrollTrigger;
	if (frame) return;
	frame = requestAnimationFrame(() => {
		frame = 0;
		const target = pending;
		pending = null;
		target?.refresh();
	});
}

/** 首页整层被拆掉时调用，避免 refresh 落在已经没有 pin 的文档上白跑一次 */
export function cancelScrollTriggerRefresh(): void {
	if (!frame) return;
	cancelAnimationFrame(frame);
	frame = 0;
	pending = null;
}
