type Gsap = typeof import("gsap")["gsap"];
type GsapTimeline = ReturnType<Gsap["timeline"]>;

/** 滚动速度（px/s）换算成倍率的增益：正常滑动即可把胶带速度拉到数倍 */
const VELOCITY_GAIN = 0.0035;
/** 单向最大倍速，防止高速滚动把文字甩成糊带 */
const RATE_MAX = 7;
/** 停手后回落到基础速度的等待毫秒数（防抖） */
const RATE_SETTLE_DELAY = 160;
/** 入场时每条胶带的描线窗口在整体进度里的错峰偏移与跨度 */
const INTRO_STAGGER = 0.12;
const INTRO_SPAN = 0.7;
/** 退场各胶带的收线时长：故意取不同值，让线条依次不规则滑出 */
const EXIT_DURATIONS = [0.52, 0.4, 0.62];

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
	animation: Animation | null;
	hatchAnimations: Animation[];
};

export type BlindsMarquee = {
	/** 按滚动进度描线入场（0→1）：可随滚动推进，也可随反向滚动原路退回 */
	renderIntro: (progress: number) => void;
	/** 反向退场：文字先淡出，线条依次不规则滑走 */
	playExit: () => void;
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
 * 入场描线完全由滚动进度驱动（renderIntro），不是自动播放的时间线：
 * 往回滚线条会按来路退回，入场与退场因此天然互为反动作。
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
			animation: null,
			hatchAnimations: [],
		};
	});

	const rateState = { value: 1 };
	let paused = false;
	let settleTimer: number | undefined;
	let lastNudgeTime = 0;
	let exitTimeline: GsapTimeline | null = null;
	let layerVisible = false;

	const applyRate = () => {
		for (const tape of tapes) {
			if (tape.animation) tape.animation.playbackRate = rateState.value;
			for (const hatch of tape.hatchAnimations) {
				hatch.playbackRate = rateState.value;
			}
		}
	};

	const setLayerVisible = (visible: boolean) => {
		if (layerVisible === visible) return;
		layerVisible = visible;
		layer.style.visibility = visible ? "visible" : "hidden";
		layer.style.opacity = visible ? "1" : "0";
	};

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
			tape.animation?.cancel();
			tape.animation = tape.track.animate(
				[
					{ transform: "translate3d(0, 0, 0)" },
					{ transform: `translate3d(-${sequenceWidth}px, 0, 0)` },
				],
				{
					duration: (sequenceWidth / tape.speed) * 1000,
					iterations: Number.POSITIVE_INFINITY,
					easing: "linear",
				},
			);
			tape.animation.playbackRate = rateState.value;
			if (paused) tape.animation.pause();

			// 边缘斜纹按文字的一半速度平移：同一倍率叠加，滚动加速/反向时同步跟随
			for (const hatch of tape.hatchAnimations) hatch.cancel();
			tape.hatchAnimations = tape.hatches.map((element) =>
				element.animate(
					[
						{ transform: "translate3d(0, 0, 0)" },
						{ transform: `translate3d(-${tape.hatchShift}px, 0, 0)` },
					],
					{
						duration: (tape.hatchShift / (tape.speed * 0.5)) * 1000,
						iterations: Number.POSITIVE_INFINITY,
						easing: "linear",
					},
				),
			);
			for (const hatch of tape.hatchAnimations) {
				hatch.playbackRate = rateState.value;
				if (paused) hatch.pause();
			}
		}
	};

	/** 滚动进度驱动的描线：每条胶带错峰、交替从两端画起，文字比边框晚到 */
	const renderIntro = (progress: number) => {
		if (signal.aborted || tapes.length === 0) return;
		exitTimeline?.kill();
		exitTimeline = null;
		const overall = clamp(progress, 0, 1);
		setLayerVisible(overall > 0);
		tapes.forEach((tape, index) => {
			const local = clamp((overall - index * INTRO_STAGGER) / INTRO_SPAN, 0, 1);
			const eased = smoothstep(local);
			const inset = ((1 - eased) * 100).toFixed(2);
			tape.frame.style.clipPath =
				index % 2 === 0
					? `inset(0% ${inset}% 0% 0%)`
					: `inset(0% 0% 0% ${inset}%)`;
			// 边框连到三成以后文字才浮出来，描线阶段不抢镜。
			// 显式写 visibility：退场动画若用 autoAlpha 会留下 hidden，重入场时文字就永远藏着了
			const textProgress = clamp((local - 0.3) / 0.5, 0, 1);
			tape.track.style.visibility = "visible";
			tape.track.style.opacity = textProgress.toFixed(3);
		});
	};

	const playExit = () => {
		if (signal.aborted) return;
		exitTimeline?.kill();
		const timeline = gsap.timeline({
			onComplete: () => setLayerVisible(false),
		});
		// 先淡字再收线：字比线先走，线条最后依次滑回入场的那一侧。
		// 这里只动 opacity，不用 autoAlpha——它顺手写 visibility: hidden，
		// 会让下一次 renderIntro 恢复的轨道一直隐身
		timeline.to(
			tapes.map((tape) => tape.track),
			{ opacity: 0, duration: 0.22, ease: "power1.in", stagger: 0.03 },
			0,
		);
		tapes.forEach((tape, index) => {
			timeline.to(
				tape.frame,
				{
					clipPath:
						index % 2 === 0 ? "inset(0% 100% 0% 0%)" : "inset(0% 0% 0% 100%)",
					duration: EXIT_DURATIONS[index % EXIT_DURATIONS.length],
					ease: "power2.in",
				},
				0.12 + index * 0.09,
			);
		});
		exitTimeline = timeline;
	};

	const setPaused = (next: boolean) => {
		if (paused === next) return;
		paused = next;
		for (const tape of tapes) {
			const animations = [
				...(tape.animation ? [tape.animation] : []),
				...tape.hatchAnimations,
			];
			for (const animation of animations) {
				if (paused) animation.pause();
				else animation.play();
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
		exitTimeline?.kill();
		exitTimeline = null;
		gsap.killTweensOf(rateState);
		for (const tape of tapes) {
			tape.animation?.cancel();
			tape.animation = null;
			for (const hatch of tape.hatchAnimations) hatch.cancel();
			tape.hatchAnimations = [];
			gsap.killTweensOf([tape.frame, tape.track, ...tape.hatches]);
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

	return { renderIntro, playExit, setPaused, nudge, refresh, destroy };
}
