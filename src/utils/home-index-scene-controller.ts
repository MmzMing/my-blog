/**
 * 内容索引卡的「提示词 → 分支虚线 → 分类卡」循环小剧场。
 *
 * 节奏与相位完全照搬参考实现（Agent Team）：打字 → 按下发送 → 虚线自上而下揭示
 * → 三张分类卡错峰弹出 → 停留 → 淡出 → 重来。这里只搬状态机，不搬 React：
 * JS 全程只做两件事——写 `data-phase`、切文字片段，位移 / 缩放 / 错峰 / 描线
 * 全部在 home-data-layer.css 里由 [data-phase] 选择器驱动。
 *
 * 相位：typing → sent → team → reset，然后回到 typing。
 * SSR 出来的标记直接是 team 终态，所以脚本没跑起来（或关掉 JS）时看到的是一幅
 * 完成的画，而不是空框；脚本一接管就先清成 typing。
 */

/** 每个字符的打字间隔 */
const TYPE_MS = 22;
/** 打完字到按下发送 */
const SEND_MS = 420;
/** 虚线往下画的时间 */
const SPREAD_MS = 700;
/** 三张分类卡之间的错峰 */
const STAGGER_MS = 160;
/** 成图停留 */
const HOLD_MS = 2600;
/** 淡出回场 */
const RESET_MS = 600;
/** 起手前的那点留白，别让第一帧就在打字 */
const LEAD_IN_MS = 500;
/** 最后一张卡弹完的收尾时长，与 CSS 的 node 过渡对齐 */
const SETTLE_MS = 500;

type Phase = "typing" | "sent" | "team" | "reset";

/** 一轮的总时长：决定下一轮什么时候开始 */
function cycleLength(promptLength: number): number {
	const typedAt = LEAD_IN_MS + promptLength * TYPE_MS;
	return typedAt + SEND_MS + SPREAD_MS + STAGGER_MS * 3 + SETTLE_MS;
}

/**
 * 挂载循环剧场，返回清理函数。由 HomeDataLayer 的 boot 调用，
 * 与 bootHomeGuide 并列——一个模块只管一张卡的动效。
 */
export function bootHomeIndexScene(root: HTMLElement): () => void {
	const scene = root.querySelector<HTMLElement>("[data-index-scene]");
	const text = scene?.querySelector<HTMLElement>("[data-scene-text]");
	if (!scene || !text) return () => {};

	// 构建期就把全文渲染在标记里，这里读一次当作脚本文本
	const prompt = (text.textContent ?? "").trim();
	const isReduced = window.matchMedia(
		"(prefers-reduced-motion: reduce)",
	).matches;

	let timers: number[] = [];
	let observer: IntersectionObserver | null = null;

	const clearTimers = (): void => {
		timers.forEach((id) => {
			window.clearTimeout(id);
		});
		timers = [];
	};

	const setPhase = (phase: Phase): void => {
		// 相位单独一个属性，data-index-scene 只做「这是剧场」的标记
		scene.dataset.scenePhase = phase;
	};

	const run = (): void => {
		// run 自己也是被定时器叫起来的，那一条已经触发过，清空不会误伤
		clearTimers();
		const later = (fn: () => void, ms: number): void => {
			timers.push(window.setTimeout(fn, ms));
		};

		setPhase("typing");
		text.textContent = "";
		for (let i = 1; i <= prompt.length; i += 1) {
			later(
				() => {
					text.textContent = prompt.slice(0, i);
				},
				LEAD_IN_MS + i * TYPE_MS,
			);
		}

		const typedAt = LEAD_IN_MS + prompt.length * TYPE_MS;
		later(() => setPhase("sent"), typedAt + SEND_MS);
		later(() => setPhase("team"), typedAt + SEND_MS + SPREAD_MS * 0.55);

		const doneAt = cycleLength(prompt.length);
		later(() => setPhase("reset"), doneAt + HOLD_MS);
		later(run, doneAt + HOLD_MS + RESET_MS);
	};

	if (isReduced) {
		// 降级：直接停在成图，不循环（CSS 那边也把过渡全关了）
		text.textContent = prompt;
		setPhase("team");
		return () => {};
	}

	// 整层在首屏之下，滚到了才开演；滚走就拆表，不留一组空转的定时器
	observer = new IntersectionObserver(
		(entries) => {
			if (entries.some((entry) => entry.isIntersecting)) {
				if (timers.length === 0) run();
			} else {
				clearTimers();
			}
		},
		{ rootMargin: "0px" },
	);
	observer.observe(scene);

	return () => {
		observer?.disconnect();
		observer = null;
		clearTimers();
		text.textContent = prompt;
		delete scene.dataset.scenePhase;
	};
}
