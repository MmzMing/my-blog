type Gsap = typeof import("gsap")["gsap"];

/** 滚动速度（px/s）换算成倍率的增益：正常滑动即可把胶带速度拉到数倍 */
const VELOCITY_GAIN = 0.0035;
const RATE_MAX = 3.2;
/** 停手后回落到基础速度的等待毫秒数（防抖） */
const RATE_SETTLE_DELAY = 160;
/** 入场时每条胶带的描线窗口在整体进度里的错峰偏移与跨度 */
const INTRO_STAGGER = 0.12;
const INTRO_SPAN = 0.7;
type TapeLoop = { animation: Animation; period: number };

type TapeRuntime = {
	/** 承载边缘描线与裁切的框架层 */
	frame: HTMLElement;
	/** 文字轨道：位移全程交给 WAAPI，不逐帧写样式 */
	track: HTMLElement;
	/** 两段等宽文字序列，轨道平移一份序列宽即无缝回环 */
	sequences: HTMLElement[];
	/** 上下两条边缘斜纹：按文字半速平移，波纹也跟着跑起来 */
	hatches: HTMLElement[];
	/** 斜纹的水平重复周期（px），与 CSS 变量 --marquee-hatch-shift 同源 */
	hatchShift: number;
	/** 基础滚动速度（px/s），由组件按配置写在 --marquee-speed 上 */
	speed: number;
	textLoop: TapeLoop | null;
	hatchLoops: TapeLoop[];
};

export type BlindsMarquee = {
	render: (progress: number) => void;
	/** 离屏与后台标签页停表 */
	setPaused: (paused: boolean) => void;
	/** 横滑耦合：传本次滚动跨过的像素量，正值加速向前、负值反向跑 */
	nudge: (deltaPx: number) => void;
	/** 视口或字体变化后重铺文字、重建循环 */
	refresh: () => void;
	destroy: () => void;
};

function clamp(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value));
}

function selectRequired<T extends Element>(
	root: ParentNode,
	selector: string,
): T {
	const element = root.querySelector<T>(selector);
	if (!element) throw new Error(`缺少首页跑马灯节点：${selector}`);
	return element;
}

/** 平滑收边：两端缓、中段快，描线行程不直来直去 */
function smoothstep(value: number) {
	return value * value * (3 - 2 * value);
}

/**
 * 背景跑马灯胶带：每条胶带的文字轨道用 Web Animations API 做线性无限循环，
 * 基准速度就是配置里的 px/s；横向滚动时按滚动速度叠加播放倍率，反向横滑
 * 直接把 playbackRate 打到负值，轨道原地掉头，没有重新起播的跳变。
 * 速度变化全部落在 playbackRate 一个标量上，动画本体始终只跑在合成层。
 * 描线的入退场共用同一进度，文字循环独立推进。
 */
export function startBlindsMarquee(options: {
	layer: HTMLElement;
	gsap: Gsap;
	signal: AbortSignal;
}): BlindsMarquee {
	const { layer, gsap, signal } = options;
	const tapeRoots = Array.from(
		layer.querySelectorAll<HTMLElement>("[data-marquee-tape]"),
	);
	const tapes: TapeRuntime[] = tapeRoots.map((root) => {
		const hatches = Array.from(
			root.querySelectorAll<HTMLElement>("[data-marquee-hatch]"),
		);
		const hatchShift =
			Number.parseFloat(
				getComputedStyle(hatches[0]?.parentElement ?? root).getPropertyValue(
					"--marquee-hatch-shift",
				),
			) || 19.9;
		return {
			frame: selectRequired<HTMLElement>(root, "[data-marquee-frame]"),
			track: selectRequired<HTMLElement>(root, "[data-marquee-track]"),
			sequences: Array.from(
				root.querySelectorAll<HTMLElement>("[data-marquee-seq]"),
			),
			hatches,
			hatchShift,
			speed:
				Number.parseFloat(
					getComputedStyle(root).getPropertyValue("--marquee-speed"),
				) || 40,
			textLoop: null,
			hatchLoops: [],
		};
	});

	const rateState = { value: 1 };
	let paused = true;
	let settleTimer: number | undefined;
	let lastNudgeTime = 0;
	let renderedProgress = Number.NaN;

	const applyRate = () => {
		for (const tape of tapes) {
			if (tape.textLoop) setLoopRate(tape.textLoop);
			for (const hatch of tape.hatchLoops) setLoopRate(hatch);
		}
	};

	function setLoopRate({ animation, period }: TapeLoop): void {
		const time = animation.currentTime;
		// 无限迭代向前有效，倒放仍会在 0 停住。前移整圈保持当前画面。
		if (rateState.value < 0 && typeof time === "number" && time < period) {
			animation.currentTime = time + period;
		}
		animation.updatePlaybackRate(rateState.value);
	}

	function createLoop(
		element: HTMLElement,
		distance: number,
		speed: number,
		previous: TapeLoop | null,
	): TapeLoop {
		const period = (distance / speed) * 1000;
		if (previous?.period === period) return previous;
		const time = previous?.animation.currentTime;
		const phase =
			previous && typeof time === "number"
				? (time % previous.period) / previous.period
				: 0;
		previous?.animation.cancel();
		const animation = element.animate(
			[
				{ transform: "translate3d(0, 0, 0)" },
				{ transform: `translate3d(-${distance}px, 0, 0)` },
			],
			{ duration: period, iterations: Number.POSITIVE_INFINITY },
		);
		animation.currentTime = (1 + phase) * period;
		animation.onfinish = () => {
			if (!paused && !signal.aborted && animation.playbackRate < 0) {
				animation.currentTime = period;
				animation.play();
			}
		};
		if (paused) animation.pause();
		const loop = { animation, period };
		setLoopRate(loop);
		return loop;
	}

	/** 每条序列至少铺满胶带宽度：平移一份序列宽时右缘仍有内容接上 */
	const ensureSequences = (tape: TapeRuntime) => {
		const template =
			tape.sequences[0]?.querySelector<HTMLElement>(
				".home-blinds-marquee__text",
			) ?? null;
		if (!template) return;
		const minWidth = Math.max(1, tape.frame.clientWidth);
		for (const sequence of tape.sequences) {
			let guard = 0;
			while (sequence.offsetWidth < minWidth && guard < 64) {
				sequence.append(template.cloneNode(true));
				guard += 1;
			}
		}
	};

	const rebuildAnimations = () => {
		for (const tape of tapes) {
			const sequence = tape.sequences[0];
			if (!sequence) continue;
			ensureSequences(tape);
			const sequenceWidth = sequence.offsetWidth;
			if (sequenceWidth <= 0) continue;
			tape.textLoop = createLoop(
				tape.track,
				sequenceWidth,
				tape.speed,
				tape.textLoop,
			);
			tape.hatchLoops = tape.hatches.map((element, index) =>
				createLoop(
					element,
					tape.hatchShift,
					tape.speed * 0.5,
					tape.hatchLoops[index] ?? null,
				),
			);
		}
	};

	/** 滚动进度驱动的描线：每条胶带错峰、交替从两端画起，文字比边框晚到 */
	const render = (overall: number): void => {
		if (signal.aborted || overall === renderedProgress || tapes.length === 0)
			return;
		renderedProgress = overall;
		layer.style.visibility = overall > 0 ? "visible" : "hidden";
		tapes.forEach((tape, index) => {
			const local = clamp((overall - index * INTRO_STAGGER) / INTRO_SPAN, 0, 1);
			const eased = smoothstep(local);
			const inset = ((1 - eased) * 100).toFixed(2);
			tape.frame.style.clipPath =
				index % 2 === 0
					? `inset(0% ${inset}% 0% 0%)`
					: `inset(0% 0% 0% ${inset}%)`;
			const textProgress = smoothstep(clamp((local - 0.27) / 0.55, 0, 1));
			tape.track.style.opacity = textProgress.toFixed(3);
		});
	};

	const setPaused = (next: boolean) => {
		if (paused === next) return;
		paused = next;
		for (const tape of tapes) {
			const loops = tape.textLoop
				? [tape.textLoop, ...tape.hatchLoops]
				: tape.hatchLoops;
			for (const loop of loops) {
				const { animation } = loop;
				if (paused) animation.pause();
				else {
					setLoopRate(loop);
					animation.play();
				}
			}
		}
	};

	const nudge = (deltaPx: number) => {
		if (signal.aborted || paused || Math.abs(deltaPx) < 1) return;
		// 用相邻两次滚动的像素速度（px/s）算倍率：慢慢划是轻微加速，
		// 快速甩动立刻拉到高倍速，反向滑动直接负倍速掉头
		const now = performance.now();
		const elapsed = Math.max(16, now - lastNudgeTime);
		lastNudgeTime = now;
		const velocity = (deltaPx / elapsed) * 1000;
		const direction = velocity > 0 ? 1 : -1;
		const magnitude = clamp(
			1 + Math.abs(velocity) * VELOCITY_GAIN,
			1,
			RATE_MAX,
		);
		gsap.to(rateState, {
			value: direction * magnitude,
			duration: 0.18,
			ease: "power2.out",
			overwrite: true,
			onUpdate: applyRate,
		});
		window.clearTimeout(settleTimer);
		settleTimer = window.setTimeout(() => {
			gsap.to(rateState, {
				value: 1,
				duration: 0.6,
				ease: "power2.out",
				overwrite: true,
				onUpdate: applyRate,
			});
		}, RATE_SETTLE_DELAY);
	};

	const refresh = () => {
		if (signal.aborted) return;
		rebuildAnimations();
	};

	const destroy = () => {
		window.clearTimeout(settleTimer);
		gsap.killTweensOf(rateState);
		for (const tape of tapes) {
			tape.textLoop?.animation.cancel();
			for (const hatch of tape.hatchLoops) hatch.animation.cancel();
		}
	};

	rebuildAnimations();
	// 字体加载会改变文字宽度，换字体后重铺一次保证回环无缝
	document.fonts?.ready
		.then(() => {
			if (!signal.aborted) rebuildAnimations();
		})
		.catch(() => {
			// 字体加载失败时维持初始度量，没必要把整层跑马灯拖下水
		});

	return { render, setPaused, nudge, refresh, destroy };
}
