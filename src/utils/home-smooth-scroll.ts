/**
 * 首页平滑滚动（Lenis）。
 *
 * 拦截桌面端滚轮，每帧用 lerp 向目标位置逼近后写回原生滚动：
 * 滚动条、pin-spacer、sticky 仍是浏览器原生行为，不引入额外合成层。
 * 与 GSAP 用官方同帧方案集成 —— lenis.raf 挂在 gsap.ticker 上、滚动事件
 * 转发 ScrollTrigger.update，hero / blinds 的 pin+scrub 与滚动位置同帧更新，
 * 避免「平滑滚动插值」与「scrub 自带缓动」叠加成双重平滑。
 *
 * 只随首页挂载（index.astro 里经 bindHomeLayer 接入 swup 生命周期）：
 * 触屏保持原生惯性不接管；prefers-reduced-motion 直接不启用；
 * 窗口宽度跨过移动断点时实时拆装，不等下一次导航。
 */
import Lenis from "lenis";

const DESKTOP_QUERY = "(min-width: 769px)";
const FINE_POINTER_QUERY = "(hover: hover) and (pointer: fine)";

let teardownFn: (() => void) | null = null;

function deactivate(): void {
	teardownFn?.();
	teardownFn = null;
}

export function bootHomeSmoothScroll(): void {
	// dev 期 HMR 可能重新求值本模块，先拆旧实例防 rAF 叠加
	deactivate();

	if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
	if (!window.matchMedia(FINE_POINTER_QUERY).matches) return;

	const desktopQuery = window.matchMedia(DESKTOP_QUERY);
	if (!desktopQuery.matches) return;

	let cancelled = false;
	let dispose: (() => void) | null = null;

	void (async () => {
		const [{ gsap }, { ScrollTrigger }] = await Promise.all([
			import("gsap"),
			import("gsap/ScrollTrigger"),
		]);
		if (cancelled) return;

		gsap.registerPlugin(ScrollTrigger);
		const lenis = new Lenis({
			// 比默认 0.1 略收紧：保留“轻微向前滑”的余韵，跟手性更好
			lerp: 0.12,
		});

		const updateScrollTrigger = () => ScrollTrigger.update();
		lenis.on("scroll", updateScrollTrigger);
		const raf = (time: number) => lenis.raf(time * 1000);
		gsap.ticker.add(raf);
		// 关掉 GSAP 的丢帧补偿：时间跳变会被 lerp 放大成一次滚动跳跃
		gsap.ticker.lagSmoothing(0);

		dispose = () => {
			gsap.ticker.remove(raf);
			lenis.destroy();
		};
	})();

	const onBreakpointChange = () => {
		deactivate();
		bootHomeSmoothScroll();
	};
	desktopQuery.addEventListener("change", onBreakpointChange);

	teardownFn = () => {
		cancelled = true;
		desktopQuery.removeEventListener("change", onBreakpointChange);
		dispose?.();
		dispose = null;
	};
}

export function teardownHomeSmoothScroll(): void {
	deactivate();
}
