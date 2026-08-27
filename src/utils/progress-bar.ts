/**
 * 切页进度条：WAAPI 驱动 transform / opacity，动画跑在合成线程。
 *
 * 原实现是「切 CSS 类 + @keyframes」。问题在于同一个 `.loading` 类被反复摘挂时，
 * CSS 动画不会重新播放，只能在中间插一句 `void progressBar.offsetWidth` 强制同步重排
 * 把动画「重置」掉 —— 而这恰好发生在切页最忙的时刻，长文章 DOM 上会同步重算整棵布局树。
 *
 * 换成 WAAPI 后：
 *   - 重置改用 `getAnimations()` + `cancel()`，完全不碰布局；
 *   - 收尾不再需要 `.finishing` → `.done` 两层嵌套 setTimeout 去摘类名，
 *     一条带 offset 的关键帧就够，于是也不用再维护那两个 timer handle。
 *
 * 时长与曲线沿用原 CSS（8s 增长、200ms 补满、300ms 淡出），观感不变。
 */

/** 增长阶段时长，对应原 CSS 的 --progress-duration */
const GROW_DURATION = 8000;
/** 收尾总时长：补满 200ms + 淡出 300ms */
const FINISH_DURATION = 500;
/** 收尾动画里「补满」所占比例，0.4 × 500ms = 200ms，与原 .finishing 的 transition 一致 */
const FINISH_FILL_RATIO = 0.4;
/** 增长阶段的终点：留 5% 给收尾，避免进度条看起来已经走完却还在等 */
const GROW_TARGET = 0.95;

function getBar(): HTMLElement | null {
	return document.getElementById("progress-bar");
}

/**
 * 原 CSS 在 prefers-reduced-motion 下把动画整体关掉、直接跳到终态，
 * 这里用 duration 0 复现同样的语义。
 */
function resolveDuration(duration: number): number {
	return window.matchMedia("(prefers-reduced-motion: reduce)").matches
		? 0
		: duration;
}

/**
 * 清掉进度条上正在跑的动画。
 * @param commit 是否先把当前动画值固化进 inline style。收尾时必须固化：
 *   cancel() 会让元素立刻退回基础样式的 scaleX(0)，不固化的话进度条会先弹回 0 再补满。
 */
function clearAnimations(bar: HTMLElement, commit: boolean): void {
	for (const animation of bar.getAnimations()) {
		if (commit) {
			try {
				animation.commitStyles();
			} catch {
				// 动画已结束、或元素当前不可渲染时会抛 InvalidStateError。
				// 这两种情况都没有「跑到一半的值」需要保留，直接 cancel 即可
			}
		}
		animation.cancel();
	}
}

/** 开始一次切页：进度条从 0 增长到 95%。 */
export function startProgressBar(): void {
	const bar = getBar();
	if (!bar) return;

	clearAnimations(bar, false);
	// 上一轮收尾 commitStyles() 留下的 inline 值会盖掉新动画的起点，必须先清掉
	bar.style.removeProperty("transform");
	bar.style.removeProperty("opacity");

	bar.animate(
		[
			{ transform: "scaleX(0)", opacity: 1 },
			{ transform: `scaleX(${GROW_TARGET})`, opacity: 1 },
		],
		{
			duration: resolveDuration(GROW_DURATION),
			easing: "cubic-bezier(0.1, 0.05, 0.1, 1)",
			fill: "forwards",
		},
	);
}

/** 切页结束：把进度条补满再淡出。 */
export function finishProgressBar(): void {
	const bar = getBar();
	if (!bar) return;

	clearAnimations(bar, true);

	bar.animate(
		[
			// 首帧故意不写 transform：缺省时 WAAPI 取元素当前值，
			// 也就是上面固化下来的那个 scaleX，进度条从当前位置接着补满
			{ opacity: 1, offset: 0 },
			{ transform: "scaleX(1)", opacity: 1, offset: FINISH_FILL_RATIO },
			{ transform: "scaleX(1)", opacity: 0, offset: 1 },
		],
		{
			duration: resolveDuration(FINISH_DURATION),
			easing: "ease-out",
			fill: "forwards",
		},
	);
}
