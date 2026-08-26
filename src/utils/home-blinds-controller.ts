type Gsap = typeof import("gsap")["gsap"];
type ScrollTriggerPlugin = typeof import("gsap/ScrollTrigger")["ScrollTrigger"];
type ScrollTriggerInstance = ReturnType<ScrollTriggerPlugin["create"]>;
type GsapTimeline = ReturnType<Gsap["timeline"]>;
type GsapTween = ReturnType<Gsap["to"]>;
/** 补间参数表：只作为数据表传给 gsap，不必对齐 gsap 内部类型 */
type TweenVars = Record<string, unknown>;

type HomeBlindsRuntimeConfig = {
	reveal: {
		foregroundOpacity: number;
		pointerTravel: number;
		headline: {
			enterDuration: number;
			messageHold: number;
			messageFlipDuration: number;
		};
	};
	scenes: {
		scrollDistance: number;
		sceneCount: number;
		standCount: number;
		cycleDuration: number;
	};
};

type SetupContext = {
	root: HTMLElement;
	gsap: Gsap;
	ScrollTrigger: ScrollTriggerPlugin;
	config: HomeBlindsRuntimeConfig;
	signal: AbortSignal;
};

/**
 * 固定舞台的可视阶段。
 * reveal = 全屏背景 + 透明前景；shrink = 全屏背景收缩成首幕图框；
 * scenes = 横向影像层；done = 影像层已滚过，舞台整体隐藏。
 * 视口缩放会触发 ScrollTrigger.refresh()，而 onEnter/onLeave 这类回调在
 * refresh 时不会补发，所以阶段必须能随时从滚动位置反推出来（见 resolvePhase）。
 */
type StagePhase = "reveal" | "shrink" | "scenes" | "done";

const DESKTOP_MEDIA_QUERY = "(min-width: 769px)";
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const REVEAL_ENTER_END = 1 / 3;
const REVEAL_EXIT_START = 2 / 3;
/**
 * 图框收缩到位后才开始逐层显示文字，居中容差内即视为「这一幕的正片」。
 * 每幕只播一次，播完不再复位，来回滚动也不会重播或隐藏。
 */
const SCENE_ENTER_DISTANCE = 0.42;

let activeRoot: HTMLElement | null = null;
let activeCleanup: (() => void) | null = null;
let bootGeneration = 0;
let mediaWatchersBound = false;

/**
 * 五幕介绍层各一套动效，与 CSS 里 [data-scene-variant] 的版式一一对应。
 * transform-origin 一律写在 CSS 中，这里只描述位移与节奏。
 */
type CaptionMotion = {
	veilFrom: TweenVars;
	veilTo: TweenVars;
	markFrom: TweenVars;
	markTo: TweenVars;
	charFrom: TweenVars;
	charTo: TweenVars;
};

const CAPTION_MOTION: Record<string, CaptionMotion> = {
	// 序幕：字幕条自底部拉起，文字逐字上浮
	curtain: {
		veilFrom: { autoAlpha: 0, scaleY: 0 },
		veilTo: { autoAlpha: 1, scaleY: 1, duration: 0.52, ease: "power3.out" },
		markFrom: { autoAlpha: 0, scaleX: 0 },
		markTo: { autoAlpha: 1, scaleX: 1, duration: 0.56, ease: "power2.out" },
		charFrom: { autoAlpha: 0, y: 18 },
		charTo: {
			autoAlpha: 1,
			y: 0,
			duration: 0.5,
			ease: "power3.out",
			stagger: 0.026,
		},
	},
	// 第二幕：竖排题签自上而下展开，文字带回弹落位
	column: {
		veilFrom: { autoAlpha: 0, scaleY: 0 },
		veilTo: { autoAlpha: 1, scaleY: 1, duration: 0.58, ease: "power3.inOut" },
		markFrom: { autoAlpha: 0, scaleY: 0 },
		markTo: { autoAlpha: 1, scaleY: 1, duration: 0.54, ease: "power3.inOut" },
		charFrom: { autoAlpha: 0, y: -16, rotation: 8 },
		charTo: {
			autoAlpha: 1,
			y: 0,
			rotation: 0,
			duration: 0.46,
			ease: "back.out(1.7)",
			stagger: 0.032,
		},
	},
	// 第三幕：标签块自右向左展开，文字自末尾往前补齐
	tag: {
		veilFrom: { autoAlpha: 0, scaleX: 0 },
		veilTo: { autoAlpha: 1, scaleX: 1, duration: 0.46, ease: "power4.out" },
		markFrom: { autoAlpha: 0, scale: 0 },
		markTo: {
			autoAlpha: 1,
			scale: 1,
			duration: 0.42,
			ease: "back.out(2.6)",
		},
		charFrom: { autoAlpha: 0, x: 14 },
		charTo: {
			autoAlpha: 1,
			x: 0,
			duration: 0.42,
			ease: "power2.out",
			stagger: { each: 0.018, from: "end" },
		},
	},
	// 第四幕：斜切色带横向擦除，文字带模糊推入
	ribbon: {
		veilFrom: { autoAlpha: 0, clipPath: "inset(0% 100% 0% 0%)" },
		veilTo: {
			autoAlpha: 1,
			clipPath: "inset(0% 0% 0% 0%)",
			duration: 0.62,
			ease: "power4.inOut",
		},
		markFrom: { autoAlpha: 0, scaleX: 0 },
		markTo: { autoAlpha: 1, scaleX: 1, duration: 0.5, ease: "power3.out" },
		charFrom: { autoAlpha: 0, x: -12, filter: "blur(9px)" },
		charTo: {
			autoAlpha: 1,
			x: 0,
			filter: "blur(0px)",
			duration: 0.5,
			ease: "power2.out",
			stagger: 0.022,
		},
	},
	// 终幕：内框整体压入，文字自中心向两端补齐
	inset: {
		veilFrom: { autoAlpha: 0, scale: 1.08 },
		veilTo: { autoAlpha: 1, scale: 1, duration: 0.7, ease: "power3.out" },
		markFrom: { autoAlpha: 0, scaleX: 0 },
		markTo: { autoAlpha: 1, scaleX: 1, duration: 0.6, ease: "power3.out" },
		charFrom: { autoAlpha: 0, scale: 1.55, y: 8 },
		charTo: {
			autoAlpha: 1,
			scale: 1,
			y: 0,
			duration: 0.5,
			ease: "power2.out",
			stagger: { each: 0.02, from: "center" },
		},
	},
};

/** 一幕之内需要分层显示的所有元素 */
type SceneRefs = {
	card: HTMLElement;
	swing: HTMLElement;
	motion: CaptionMotion;
	railDot: HTMLElement;
	railEyebrow: HTMLElement;
	railLine: HTMLElement;
	railTitle: HTMLElement;
	headCode: HTMLElement;
	headTitle: HTMLElement;
	headCue: HTMLElement;
	captionVeil: HTMLElement;
	captionMark: HTMLElement;
	captionChars: HTMLElement[];
	intro: GsapTimeline | null;
	active: boolean;
};

function clamp(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value));
}

function selectRequired<T extends Element>(
	root: ParentNode,
	selector: string,
): T {
	const element = root.querySelector<T>(selector);
	if (!element) throw new Error(`缺少首页影像交互节点：${selector}`);
	return element;
}

function parseRuntimeConfig(root: HTMLElement): HomeBlindsRuntimeConfig {
	const configNode = selectRequired<HTMLScriptElement>(
		root,
		"[data-home-blinds-config]",
	);
	return JSON.parse(configNode.textContent ?? "{}") as HomeBlindsRuntimeConfig;
}

function canInitialize(root: HTMLElement) {
	return (
		root.dataset.homeBlindsEnabled === "true" &&
		window.matchMedia(DESKTOP_MEDIA_QUERY).matches &&
		!window.matchMedia(REDUCED_MOTION_QUERY).matches
	);
}

function bindMediaWatchers() {
	if (mediaWatchersBound) return;
	mediaWatchersBound = true;

	const desktopQuery = window.matchMedia(DESKTOP_MEDIA_QUERY);
	const reducedMotionQuery = window.matchMedia(REDUCED_MOTION_QUERY);
	const restart = () => {
		activeRoot = null;
		bootHomeBlinds();
	};

	desktopQuery.addEventListener("change", restart);
	reducedMotionQuery.addEventListener("change", restart);
}

function collectScene(card: HTMLElement): SceneRefs {
	const variant = card.dataset.sceneVariant ?? "curtain";
	const caption = selectRequired<HTMLElement>(card, "[data-scene-caption]");
	return {
		card,
		swing: selectRequired<HTMLElement>(card, "[data-scene-swing]"),
		motion: CAPTION_MOTION[variant] ?? CAPTION_MOTION.curtain,
		railDot: selectRequired<HTMLElement>(card, "[data-scene-rail-dot]"),
		railEyebrow: selectRequired<HTMLElement>(card, "[data-scene-rail-eyebrow]"),
		railLine: selectRequired<HTMLElement>(card, "[data-scene-rail-line]"),
		railTitle: selectRequired<HTMLElement>(card, "[data-scene-rail-title]"),
		headCode: selectRequired<HTMLElement>(card, "[data-scene-head-code]"),
		headTitle: selectRequired<HTMLElement>(card, "[data-scene-head-title]"),
		headCue: selectRequired<HTMLElement>(card, "[data-scene-head-cue]"),
		captionVeil: selectRequired<HTMLElement>(
			caption,
			"[data-scene-caption-veil]",
		),
		captionMark: selectRequired<HTMLElement>(
			caption,
			"[data-scene-caption-mark]",
		),
		captionChars: Array.from(
			caption.querySelectorAll<HTMLElement>("[data-scene-caption-char]"),
		),
		intro: null,
		active: false,
	};
}

/** 该幕所有文字与 UI 的初始（隐藏）状态，也是离场后的复位状态 */
function hideSceneChrome(gsap: Gsap, scene: SceneRefs) {
	gsap.set(scene.railDot, { autoAlpha: 0, scale: 0 });
	gsap.set(scene.railEyebrow, { autoAlpha: 0, y: -12 });
	gsap.set(scene.railLine, { autoAlpha: 0, scaleY: 0 });
	gsap.set(scene.railTitle, {
		autoAlpha: 0,
		y: -18,
		clipPath: "inset(0% 0% 100% 0%)",
	});
	gsap.set(scene.headCode, { autoAlpha: 0, x: -16 });
	gsap.set(scene.headTitle, { autoAlpha: 0, y: 10 });
	gsap.set(scene.headCue, { autoAlpha: 0, x: 16 });
	gsap.set(scene.captionVeil, scene.motion.veilFrom);
	gsap.set(scene.captionMark, scene.motion.markFrom);
	gsap.set(scene.captionChars, scene.motion.charFrom);
}

/**
 * 分层显示：竖排题名 → 顶栏 → 图内介绍层。
 * 只在图框收缩到位（阶段已进入 scenes）且该幕居中时调用，
 * 因此文字永远不会与背景收缩动画抢镜。
 */
function playSceneIntro(gsap: Gsap, scene: SceneRefs) {
	if (scene.active) return;
	scene.active = true;
	scene.intro?.kill();
	hideSceneChrome(gsap, scene);

	const timeline = gsap.timeline();

	timeline
		.to(
			scene.railDot,
			{ autoAlpha: 1, scale: 1, duration: 0.32, ease: "back.out(2.8)" },
			0,
		)
		.to(
			scene.railEyebrow,
			{ autoAlpha: 1, y: 0, duration: 0.44, ease: "power2.out" },
			0.06,
		)
		.to(
			scene.railLine,
			{ autoAlpha: 1, scaleY: 1, duration: 0.46, ease: "power3.inOut" },
			0.14,
		)
		.to(
			scene.railTitle,
			{
				autoAlpha: 1,
				y: 0,
				clipPath: "inset(0% 0% 0% 0%)",
				duration: 0.66,
				ease: "power3.out",
			},
			0.2,
		)
		.to(
			scene.headCode,
			{ autoAlpha: 1, x: 0, duration: 0.44, ease: "power2.out" },
			0.16,
		)
		.to(
			scene.headTitle,
			{ autoAlpha: 1, y: 0, duration: 0.48, ease: "power2.out" },
			0.24,
		)
		.to(
			scene.headCue,
			{ autoAlpha: 1, x: 0, duration: 0.44, ease: "power2.out" },
			0.32,
		)
		.to(scene.captionVeil, { ...scene.motion.veilTo }, 0.52)
		.to(scene.captionMark, { ...scene.motion.markTo }, 0.6)
		.to(scene.captionChars, { ...scene.motion.charTo }, 0.64);

	scene.intro = timeline;
}

/**
 * 影像层 + 固定舞台的可见性。
 * 舞台各层的显隐只由这里的 applyPhase 写入，reveal 层只负责前景图自身的
 * 透明度/位移，避免两套逻辑抢同一个属性。
 */
function setupScenes(context: SetupContext) {
	const { root, gsap, ScrollTrigger, config, signal } = context;
	const section = selectRequired<HTMLElement>(
		root,
		"[data-home-blinds-scenes]",
	);
	const viewport = selectRequired<HTMLElement>(
		section,
		"[data-scenes-viewport]",
	);
	const meter = selectRequired<HTMLElement>(section, "[data-scenes-meter]");
	const meterOrdinal = selectRequired<HTMLElement>(
		meter,
		"[data-scenes-meter-ordinal]",
	);
	const meterFill = selectRequired<HTMLElement>(
		meter,
		"[data-scenes-meter-fill]",
	);
	const meterValue = selectRequired<HTMLElement>(
		meter,
		"[data-scenes-meter-value]",
	);
	const portal = selectRequired<HTMLElement>(root, "[data-scenes-portal]");
	const stage = selectRequired<HTMLElement>(root, "[data-blinds-stage]");
	const stageBackground = selectRequired<HTMLImageElement>(
		stage,
		"[data-blinds-background]",
	);
	// 前景图自身的 autoAlpha 由 setupReveal 的时间线独占，这里只切外层窗口的显隐。
	const stageForegroundWindow = selectRequired<HTMLElement>(
		stage,
		"[data-reveal-window]",
	);
	// 入场标题同理：根节点的 autoAlpha 归 setupHeadline / setupReveal，这里只切窗口。
	const stageHeadlineWindow = selectRequired<HTMLElement>(
		stage,
		"[data-headline-window]",
	);
	const strings = selectRequired<SVGSVGElement>(
		section,
		"[data-scene-strings]",
	);
	const scenes = Array.from(
		section.querySelectorAll<HTMLElement>("[data-home-blinds-scene]"),
	).map(collectScene);
	const cards = scenes.map((scene) => scene.card);
	const swings = scenes.map((scene) => scene.swing);
	const stands = Array.from(
		section.querySelectorAll<HTMLElement>("[data-scene-stand]"),
	);
	const stand = stands[0] ?? null;
	const standImage =
		stand?.querySelector<HTMLElement>("[data-scene-stand-image]") ?? null;
	const lines = Array.from(
		section.querySelectorAll<SVGLineElement>("[data-scene-string]"),
	);
	const line = lines[0] ?? null;
	const cycleStage = selectRequired<HTMLElement>(
		section,
		"[data-scenes-cycle]",
	);
	const cycleTrack = selectRequired<HTMLElement>(
		cycleStage,
		"[data-scenes-cycle-track]",
	);
	const sceneCount = Math.min(
		scenes.length,
		Math.max(1, config.scenes.sceneCount),
	);
	const lastSceneIndex = Math.max(0, sceneCount - 1);
	const previousSceneX = Array.from({ length: sceneCount }, () => Number.NaN);
	const rotationSetters = swings.slice(0, sceneCount).map((swing) =>
		gsap.quickTo(swing, "rotation", {
			duration: 0.2,
			ease: "power2.out",
		}),
	);
	let resetWindTimer: number | undefined;
	let resizeTimer: number | undefined;
	let horizontalEnabled = false;
	let phase: StagePhase = "reveal";
	let rootInView = false;
	let shrinkTrigger: ScrollTriggerInstance | null = null;
	let pinTrigger: ScrollTriggerInstance | null = null;
	let actVisible = false;
	let bounceTimeline: GsapTimeline | null = null;
	// 背景跑马灯：两份等长列表首尾相接，xPercent 从 -50 走到 0 正好换过一整轮，
	// 因为两份内容一致，接缝处画面完全重合，循环看不出跳帧。
	const cycleLoop = gsap.timeline({ repeat: -1, paused: true });
	cycleLoop.fromTo(
		cycleTrack,
		{ xPercent: -50 },
		{
			xPercent: 0,
			duration: Math.max(4, config.scenes.cycleDuration),
			ease: "none",
		},
	);

	// 图框尺寸完全由 CSS 变量决定；offset* 取的是不受 transform 影响的布局尺寸，
	// 所以可以直接当作全屏背景收缩的终点，无需和 CSS 重复一遍计算公式。
	const sceneWidth = () =>
		cards[0]?.offsetWidth || Math.round(window.innerWidth * 0.44);
	const sceneHeight = () =>
		cards[0]?.offsetHeight || Math.round(window.innerWidth * 0.33);
	// 画面放大后横向间距同步拉开：一幕宽度 + 至少 16vw 的留白
	const sceneStep = () =>
		sceneWidth() + Math.max(150, window.innerWidth * 0.16);

	const stopBounce = () => {
		bounceTimeline?.kill();
		bounceTimeline = null;
		if (!standImage) return;
		gsap.killTweensOf(standImage);
		gsap.set(standImage, { y: 0, scaleX: 1, scaleY: 1 });
	};

	/**
	 * 跳跃循环：只有单纯的上下位移，不带蓄力下蹲、拉伸压缩等形变。
	 */
	const startBounce = () => {
		if (!actVisible || !standImage) return;
		stopBounce();
		const timeline = gsap.timeline({ repeat: -1 });
		const jumpHeights = [-95, -78];

		for (let jump = 0; jump < 2; jump += 1) {
			timeline
				// 上升
				.to(standImage, {
					y: jumpHeights[jump],
					duration: 0.29,
					ease: "power2.out",
				})
				// 下落
				.to(standImage, {
					y: 0,
					duration: 0.29,
					ease: "power2.in",
				});
		}

		bounceTimeline = timeline;
	};

	/**
	 * 背景跑马灯与立牌同时入场，走同一套纸牌立起的姿态：
	 * 以底边为铰链从近乎平躺（rotationX -88）转到竖直，配合 transformPerspective
	 * 造出「屏幕从地面立起来」的透视。立牌收一点回弹，背景大面积不回弹免得晃。
	 */
	const showAct = () => {
		if (actVisible) return;
		actVisible = true;

		gsap.killTweensOf(cycleStage);
		gsap.to(cycleStage, {
			autoAlpha: 1,
			rotationX: 0,
			duration: 0.78,
			ease: "power4.out",
			overwrite: "auto",
		});
		cycleLoop.play();

		if (!stand || !line) return;
		gsap.killTweensOf(stand);
		gsap.set(stand, { xPercent: -50, rotation: 0 });
		gsap.to(line, {
			opacity: 1,
			duration: 0.24,
			ease: "power2.out",
			overwrite: "auto",
		});
		gsap.to(stand, {
			autoAlpha: 1,
			rotationX: 0,
			duration: 0.72,
			ease: "back.out(1.4)",
			overwrite: "auto",
			onComplete: startBounce,
		});
	};

	const hideAct = () => {
		if (!actVisible) return;
		actVisible = false;
		stopBounce();

		gsap.killTweensOf(cycleStage);
		gsap.to(cycleStage, {
			autoAlpha: 0,
			rotationX: -88,
			duration: 0.5,
			ease: "power3.in",
			overwrite: "auto",
		});
		cycleLoop.pause();

		if (!stand || !line) return;
		gsap.killTweensOf(stand);
		gsap.to(line, {
			opacity: 0,
			duration: 0.18,
			ease: "power2.in",
			overwrite: "auto",
		});
		gsap.to(stand, {
			autoAlpha: 0,
			rotationX: -88,
			duration: 0.46,
			ease: "power3.in",
			overwrite: "auto",
		});
	};

	const updateStrings = () => {
		if (!actVisible || !standImage || !line) return;
		const viewportRect = viewport.getBoundingClientRect();
		strings.setAttribute(
			"viewBox",
			`0 0 ${viewportRect.width} ${viewportRect.height}`,
		);

		const standRect = standImage.getBoundingClientRect();
		const standCenterX =
			standRect.left + standRect.width / 2 - viewportRect.left;
		line.setAttribute("x1", String(standCenterX));
		line.setAttribute("y1", String(standRect.bottom - viewportRect.top));
		line.setAttribute("x2", String(standCenterX));
		line.setAttribute("y2", String(viewportRect.height));
	};

	const resetWind = () => {
		for (const setRotation of rotationSetters) setRotation(0);
	};

	/** 共用长条进度：按当前居中的连续幕索引更新，不播放额外入场动画。 */
	const renderMeter = (sceneProgress: number, isVisible: boolean) => {
		const boundedProgress = clamp(sceneProgress, 0, lastSceneIndex);
		const progressRatio =
			sceneCount <= 1 ? 1 : (boundedProgress + 1) / sceneCount;
		const percentage = Math.round(progressRatio * 100);
		const currentIndex = clamp(Math.round(boundedProgress) + 1, 1, sceneCount);

		meterFill.style.setProperty(
			"--home-blinds-scenes-meter",
			String(progressRatio),
		);
		meterFill.style.setProperty(
			"--home-blinds-scenes-meter-percent",
			`${progressRatio * 100}%`,
		);
		meterOrdinal.textContent = String(currentIndex).padStart(2, "0");
		meterValue.textContent = `${percentage}%`;
		meter.setAttribute("aria-valuenow", String(percentage));
		gsap.set(meter, { autoAlpha: isVisible ? 1 : 0 });
	};

	const renderScenes = (sceneProgress: number, isVisible: boolean) => {
		renderMeter(sceneProgress, isVisible);
		const step = sceneStep();
		let moving = false;

		for (let index = 0; index < sceneCount; index += 1) {
			const scene = scenes[index];
			const distance = Math.abs(index - sceneProgress);
			const x = (index - sceneProgress) * step;
			const scale = 1 - Math.min(distance, 1) * 0.06;
			const depthOpacity =
				distance > 1.55 ? 0 : Math.max(0.14, 1 - distance * 0.6);
			const previousX = previousSceneX[index];

			gsap.set(scene.card, {
				xPercent: -50,
				yPercent: -50,
				x,
				y: 0,
				scale,
				autoAlpha: isVisible ? depthOpacity : 0,
				zIndex: Math.round(20 - distance * 3),
			});

			// 图片就位（isVisible）且该幕居中后，文字与 UI 才开始分层显示；
			// playSceneIntro 内部有 active 短路，所以每幕只播一次，之后一直留在画面上
			if (isVisible && distance < SCENE_ENTER_DISTANCE) {
				playSceneIntro(gsap, scene);
			}

			if (Number.isFinite(previousX)) {
				const deltaX = x - previousX;
				if (Math.abs(deltaX) > 0.08) {
					rotationSetters[index](clamp(deltaX * 0.05, -2.6, 2.6));
					moving = true;
				}
			}
			previousSceneX[index] = x;
		}

		if (moving) {
			window.clearTimeout(resetWindTimer);
			resetWindTimer = window.setTimeout(resetWind, 110);
		}

		// 背景跑马灯与立牌同进同出；立牌钉在起始横位不再随横移滑动
		if (isVisible) showAct();
		else hideAct();
		updateStrings();
	};

	function applyPhase() {
		gsap.set(stage, { autoAlpha: rootInView && phase !== "done" ? 1 : 0 });
		gsap.set([stageBackground, stageForegroundWindow, stageHeadlineWindow], {
			autoAlpha: phase === "reveal" ? 1 : 0,
		});
		gsap.set(portal, { autoAlpha: phase === "shrink" ? 1 : 0 });
	}

	/** 只依赖滚动位置，因此 refresh 之后也能得到正确阶段 */
	function resolvePhase(): StagePhase {
		if (!pinTrigger || !shrinkTrigger) return "reveal";
		const scroll = window.scrollY;
		if (scroll >= pinTrigger.end) return "done";
		if (scroll >= pinTrigger.start) return "scenes";
		if (scroll >= shrinkTrigger.start) return "shrink";
		return "reveal";
	}

	/** 舞台显隐与各幕位置的唯一入口 */
	function syncStage() {
		phase = resolvePhase();
		applyPhase();

		if (phase === "scenes") {
			const progress = pinTrigger?.progress ?? 0;
			horizontalEnabled = progress < 0.999;
			renderScenes(progress * Math.max(0, sceneCount - 1), true);
			return;
		}

		horizontalEnabled = false;
		// 影像层滚过后保留最后一幕，随 section 一起离场
		renderScenes(
			phase === "done" ? Math.max(0, sceneCount - 1) : 0,
			phase === "done",
		);
	}

	gsap.set(portal, {
		xPercent: -50,
		yPercent: -50,
		x: 0,
		y: 0,
		width: () => window.innerWidth,
		height: () => window.innerHeight,
		borderWidth: "0px",
		autoAlpha: 0,
	});
	gsap.set(cards, { autoAlpha: 0 });
	// 立牌与背景跑马灯的初始姿态：以底边为铰链几乎平躺，入场时立起来
	gsap.set(stands, {
		xPercent: -50,
		y: 0,
		rotationX: -88,
		transformPerspective: 1100,
		autoAlpha: 0,
	});
	gsap.set(cycleStage, {
		rotationX: -88,
		transformPerspective: 1400,
		autoAlpha: 0,
	});
	gsap.set(lines, { opacity: 0 });
	renderMeter(0, false);
	for (const scene of scenes) hideSceneChrome(gsap, scene);

	const shrinkTimeline = gsap.timeline({
		scrollTrigger: {
			id: "home-blinds-scenes-shrink",
			trigger: section,
			start: "top 66.666%",
			end: "top top",
			scrub: 0.4,
			invalidateOnRefresh: true,
			onToggle: syncStage,
		},
	});
	shrinkTrigger = shrinkTimeline.scrollTrigger ?? null;

	// 全屏背景 → 首幕 4:3 图框：尺寸与 1.5px 黑白边框一起补到位，
	// 终点与 .home-blinds-scene__frame 完全重合，交接瞬间看不出换层。
	// 这条时间线开了 invalidateOnRefresh，用 fromTo 显式写出起始值，
	// 缩放窗口后重新记录的起点才不会被当前已渲染的终点状态污染。
	shrinkTimeline.fromTo(
		portal,
		{
			width: () => window.innerWidth,
			height: () => window.innerHeight,
			borderWidth: "0px",
		},
		{
			width: sceneWidth,
			height: sceneHeight,
			borderWidth: "1.5px",
			duration: 1,
			ease: "power3.inOut",
			immediateRender: false,
		},
		0,
	);

	pinTrigger = ScrollTrigger.create({
		id: "home-blinds-scenes-pin",
		trigger: section,
		// 相比原来的 5.5 屏缩短到 3.4 屏：同样的滚动量能推进更长的横向距离
		start: "top top",
		end: () =>
			`+=${Math.max(config.scenes.scrollDistance, window.innerHeight * 3.4)}`,
		pin: true,
		pinSpacing: true,
		anticipatePin: 1,
		invalidateOnRefresh: true,
		onToggle: syncStage,
		onUpdate: (self) => {
			if (!self.isActive) return;
			phase = "scenes";
			applyPhase();
			horizontalEnabled = self.progress < 0.999;
			viewport.classList.toggle("is-horizontal", horizontalEnabled);
			renderScenes(self.progress * Math.max(0, sceneCount - 1), true);
		},
	});

	const rootTrigger = ScrollTrigger.create({
		id: "home-blinds-fixed-stage",
		trigger: root,
		start: "top bottom",
		end: "bottom top",
		invalidateOnRefresh: true,
		onToggle: (self) => {
			rootInView = self.isActive;
			applyPhase();
		},
	});
	rootInView = rootTrigger.isActive;

	// refresh 事件在所有触发器重新测量之后触发，是缩放后唯一可靠的补偿时机。
	ScrollTrigger.addEventListener("refresh", syncStage);

	// 不支持鼠标拖拽横移：横向推进只跟随滚轮/触控板，避免与页面滚动抢手感
	viewport.addEventListener(
		"wheel",
		(event) => {
			if (
				!horizontalEnabled ||
				!pinTrigger ||
				Math.abs(event.deltaX) <= Math.abs(event.deltaY)
			)
				return;
			event.preventDefault();
			window.scrollTo({
				top: clamp(
					// 触控板横滑按 1.8 倍换算成滚动量，横移更快
					window.scrollY + event.deltaX * 1.8,
					pinTrigger.start,
					pinTrigger.end,
				),
				behavior: "auto",
			});
		},
		{ passive: false, signal },
	);
	window.addEventListener(
		"resize",
		() => {
			window.clearTimeout(resizeTimer);
			resizeTimer = window.setTimeout(() => ScrollTrigger.refresh(), 160);
		},
		{ signal },
	);

	gsap.ticker.add(updateStrings);
	syncStage();

	return () => {
		window.clearTimeout(resetWindTimer);
		window.clearTimeout(resizeTimer);
		gsap.ticker.remove(updateStrings);
		ScrollTrigger.removeEventListener("refresh", syncStage);
		stopBounce();
		cycleLoop.kill();
		for (const scene of scenes) {
			scene.intro?.kill();
			scene.intro = null;
			scene.active = false;
		}
		renderMeter(0, false);
		gsap.killTweensOf([
			...cards,
			...swings,
			...stands,
			...lines,
			portal,
			stageBackground,
			stageForegroundWindow,
			stageHeadlineWindow,
		]);
		rootTrigger.kill();
		pinTrigger?.kill();
		shrinkTrigger?.kill();
		shrinkTimeline.kill();
		gsap.set(stage, { autoAlpha: 0 });
	};
}

/**
 * 揭示层：透明前景图的进出场与跟随鼠标的位移，
 * 顺带把入场标题挂进同一条 scrub 时间线的退场段（「和透明图层一起滑出」）。
 */
function setupReveal(context: SetupContext) {
	const { root, gsap, config, signal } = context;
	const section = selectRequired<HTMLElement>(
		root,
		"[data-home-blinds-reveal]",
	);
	const viewport = selectRequired<HTMLElement>(
		section,
		"[data-reveal-viewport]",
	);
	const foreground = selectRequired<HTMLElement>(
		root,
		"[data-reveal-foreground]",
	);
	const headline = selectRequired<HTMLElement>(root, "[data-blinds-headline]");

	const foregroundOpacity = clamp(config.reveal.foregroundOpacity, 0, 1);
	gsap.set(foreground, {
		xPercent: -50,
		yPercent: 34,
		x: 0,
		y: 0,
		autoAlpha: 0,
	});
	const revealTimeline = gsap.timeline({
		scrollTrigger: {
			id: "home-blinds-reveal",
			trigger: section,
			start: "top 66.666%",
			end: "bottom 66.666%",
			scrub: 0.35,
			invalidateOnRefresh: true,
		},
	});

	// 前景图的 autoAlpha 只由这条 scrub 时间线写入，refresh 时会按进度重新渲染，
	// 因此滚过揭示层后缩放窗口不会让它重新出现。
	revealTimeline
		.fromTo(
			foreground,
			{ yPercent: 34, autoAlpha: 0 },
			{
				yPercent: 0,
				autoAlpha: foregroundOpacity,
				duration: REVEAL_ENTER_END,
				ease: "power3.out",
				immediateRender: false,
			},
			0,
		)
		.fromTo(
			foreground,
			{ yPercent: 0, autoAlpha: foregroundOpacity },
			{
				yPercent: -38,
				autoAlpha: 0,
				duration: 1 - REVEAL_EXIT_START,
				ease: "power3.in",
				immediateRender: false,
			},
			REVEAL_EXIT_START,
		)
		// 入场标题不做 scrub 进场（它有自己的 0.5s 时间线），只在这里跟着前景图一起滑出
		.fromTo(
			headline,
			{ yPercent: 0, autoAlpha: 1 },
			{
				yPercent: -38,
				autoAlpha: 0,
				duration: 1 - REVEAL_EXIT_START,
				ease: "power3.in",
				immediateRender: false,
			},
			REVEAL_EXIT_START,
		);

	const travel = Math.max(0, config.reveal.pointerTravel);
	const setPointerX = gsap.quickTo(foreground, "x", {
		duration: 0.58,
		ease: "power3.out",
	});
	const setPointerY = gsap.quickTo(foreground, "y", {
		duration: 0.58,
		ease: "power3.out",
	});
	viewport.addEventListener(
		"pointermove",
		(event) => {
			const bounds = viewport.getBoundingClientRect();
			const normalizedX =
				((event.clientX - bounds.left) / Math.max(bounds.width, 1) - 0.5) * 2;
			const normalizedY =
				((event.clientY - bounds.top) / Math.max(bounds.height, 1) - 0.5) * 2;
			setPointerX(normalizedX * travel);
			setPointerY(normalizedY * travel * 0.58);
		},
		{ signal },
	);
	viewport.addEventListener(
		"pointerleave",
		() => {
			setPointerX(0);
			setPointerY(0);
		},
		{ signal },
	);

	return () => {
		gsap.killTweensOf([foreground, headline]);
		revealTimeline.scrollTrigger?.kill();
		revealTimeline.kill();
	};
}

/**
 * 第一层入场标题，整段入场压在 enterDuration（默认 0.5s）内：
 * 长条整体横移 → 内缘往两侧退开、标题从缝里显露 → 两侧竖线与中缝横线跟随滑动 →
 * 长条钉在两侧后往外缩放消失，中央虚线圆同时显露并转 90°；
 * 落定后标题上移，第二层祝福语逐字翻入并循环。退场交给 setupReveal 的 scrub 时间线。
 */
function setupHeadline(context: SetupContext) {
	const { root, gsap, ScrollTrigger, config, signal } = context;
	const section = selectRequired<HTMLElement>(
		root,
		"[data-home-blinds-reveal]",
	);
	const headline = selectRequired<HTMLElement>(root, "[data-blinds-headline]");
	const stack = selectRequired<HTMLElement>(headline, "[data-headline-stack]");
	const title = selectRequired<HTMLElement>(headline, "[data-headline-title]");
	const ring = selectRequired<HTMLElement>(headline, "[data-headline-ring]");
	const axisLeft = selectRequired<HTMLElement>(
		headline,
		'[data-headline-axis="left"]',
	);
	const axisRight = selectRequired<HTMLElement>(
		headline,
		'[data-headline-axis="right"]',
	);
	const edges = Array.from(
		headline.querySelectorAll<HTMLElement>("[data-headline-edge]"),
	);
	const bands = Array.from(
		headline.querySelectorAll<HTMLElement>("[data-headline-band]"),
	);
	// 每条祝福语拆成逐字节点，换页时旧句翻出、新句翻入
	const messages = Array.from(
		headline.querySelectorAll<HTMLElement>("[data-headline-message]"),
	).map((message) =>
		Array.from(
			message.querySelectorAll<HTMLElement>("[data-headline-message-char]"),
		),
	);
	const { enterDuration, messageHold, messageFlipDuration } =
		config.reveal.headline;
	const enterSpan = Math.max(0.24, enterDuration);
	const holdSpan = Math.max(0.6, messageHold);
	const flipSpan = Math.max(0.24, messageFlipDuration);
	/**
	 * 换页节奏按配置总时长反算：逐字延迟累积出的尾巴也算进预算里，
	 * 这样「旧句翻出 → 新句最后一字落位」的实际耗时正好等于 messageFlipDuration。
	 */
	const flipChars = messages.reduce(
		(most, chars) => Math.max(most, chars.length),
		1,
	);
	const flipStagger = Math.min(
		0.03,
		(flipSpan * 0.4) / Math.max(1, flipChars - 1),
	);
	const flipBudget = flipSpan - flipStagger * (flipChars - 1);
	const flipOutSpan = flipBudget * 0.5;
	const flipInDelay = flipBudget * 0.38;
	const flipInSpan = flipBudget * 0.62;

	let enter: GsapTimeline | null = null;
	let flip: GsapTimeline | null = null;
	let cycleCall: GsapTween | null = null;
	let current = 0;
	let played = false;
	let awake = false;
	let relayoutTimer: number | undefined;

	/**
	 * 长条只做 scaleX：外缘钉死在 CSS 的 band-inset 上，内缘往两侧退。
	 * 退开的宽度取标题半宽再加一点留白，标题才刚好从缝里露全。
	 */
	const measure = () => {
		const bandWidth = bands[0]?.offsetWidth ?? 0;
		const gapHalf = title.offsetWidth / 2 + window.innerWidth * 0.012;
		return {
			openScale:
				bandWidth > 0 ? clamp(1 - gapHalf / bandWidth, 0.06, 0.98) : 0.76,
			// 入场时标题独占中线，落定后整栈上移让出第二层祝福语
			titleY: -title.offsetHeight / 2,
			stackY: -stack.offsetHeight / 2,
			slide: window.innerWidth * 0.045,
		};
	};

	const stopCycle = () => {
		cycleCall?.kill();
		cycleCall = null;
		flip?.kill();
		flip = null;
	};

	const scheduleNext = () => {
		if (messages.length < 2) return;
		cycleCall?.kill();
		cycleCall = gsap.delayedCall(holdSpan, advance);
		if (!awake) cycleCall.pause();
	};

	/** 祝福语换页：旧句逐字翻出，新句逐字翻入，循环到底再回第一条 */
	function advance() {
		const outgoing = messages[current];
		current = (current + 1) % messages.length;
		flip?.kill();
		flip = gsap
			.timeline({ onComplete: scheduleNext })
			.to(
				outgoing,
				{
					rotationX: -92,
					autoAlpha: 0,
					duration: flipOutSpan,
					ease: "power2.in",
					stagger: flipStagger,
				},
				0,
			)
			.fromTo(
				messages[current],
				{ rotationX: 92, autoAlpha: 0 },
				{
					rotationX: 0,
					autoAlpha: 1,
					duration: flipInSpan,
					ease: "power3.out",
					stagger: flipStagger,
				},
				flipInDelay,
			);
		if (!awake) flip.pause();
	}

	/** 入场前的初始态：两半长条贴合成一整条，整体偏左待滑入 */
	const reset = () => {
		const { titleY, slide } = measure();
		stopCycle();
		enter?.kill();
		enter = null;
		played = false;
		current = 0;
		gsap.set(headline, { yPercent: 0, autoAlpha: 0 });
		gsap.set(bands, { x: -slide, scaleX: 1 });
		gsap.set(edges, { x: -slide, scaleY: 0, autoAlpha: 0 });
		gsap.set(axisLeft, {
			x: -slide,
			autoAlpha: 0,
			clipPath: "inset(0% 0% 0% 100%)",
		});
		gsap.set(axisRight, {
			x: -slide,
			autoAlpha: 0,
			clipPath: "inset(0% 100% 0% 0%)",
		});
		gsap.set(ring, { autoAlpha: 0, rotation: -90, scale: 0.92 });
		gsap.set(stack, { y: titleY });
		for (const chars of messages) {
			gsap.set(chars, { rotationX: 92, autoAlpha: 0 });
		}
	};

	/**
	 * 播完后遇到视口变化时直接落到终态重新对齐。
	 * 根节点的 autoAlpha / yPercent 归入场时间线与 setupReveal 的退场段所有，
	 * 这里一律不碰，否则滚过退场段再缩放窗口会把标题重新亮出来。
	 */
	const settle = () => {
		const { stackY } = measure();
		enter?.kill();
		enter = null;
		stopCycle();
		gsap.set(bands, { x: 0, scaleX: 0 });
		gsap.set(edges, { x: 0, scaleY: 1, autoAlpha: 1 });
		gsap.set([axisLeft, axisRight], {
			x: 0,
			autoAlpha: 1,
			clipPath: "inset(0% 0% 0% 0%)",
		});
		gsap.set(ring, { autoAlpha: 1, rotation: 0, scale: 1 });
		gsap.set(stack, { y: stackY });
		for (let index = 0; index < messages.length; index += 1) {
			gsap.set(
				messages[index],
				index === current
					? { rotationX: 0, autoAlpha: 1 }
					: { rotationX: 92, autoAlpha: 0 },
			);
		}
		scheduleNext();
	};

	/** 入场只播一次；比例全部挂在 enterSpan 上，改配置即整体等比缩放 */
	const play = () => {
		if (played) return;
		played = true;
		const { openScale, titleY, stackY, slide } = measure();
		const span = enterSpan;
		gsap.set(stack, { y: titleY });
		gsap.set(bands, { x: -slide, scaleX: 1 });

		enter = gsap
			.timeline({ onComplete: scheduleNext })
			.set(headline, { yPercent: 0, autoAlpha: 1 }, 0)
			// 整条长条先横移到位，此时看上去仍是一根完整长条
			.to(bands, { x: 0, duration: span * 0.46, ease: "power3.out" }, 0)
			// 内缘往两侧退开，标题从中缝里显露
			.to(
				bands,
				{ scaleX: openScale, duration: span * 0.52, ease: "power2.inOut" },
				0,
			)
			// 露出两字左右时补上两侧竖线与中缝横线，二者跟着长条一起滑、一起定
			.to(
				edges,
				{
					x: 0,
					scaleY: 1,
					autoAlpha: 1,
					duration: span * 0.34,
					ease: "power2.out",
				},
				span * 0.3,
			)
			.to(
				[axisLeft, axisRight],
				{
					x: 0,
					autoAlpha: 1,
					clipPath: "inset(0% 0% 0% 0%)",
					duration: span * 0.36,
					ease: "power3.out",
				},
				span * 0.34,
			)
			// 长条钉在两侧后往外缩放消失，中央虚线圆同时显露并转 90°
			.to(
				bands,
				{ scaleX: 0, duration: span * 0.48, ease: "power2.inOut" },
				span * 0.52,
			)
			.to(
				ring,
				{
					autoAlpha: 1,
					rotation: 0,
					scale: 1,
					duration: span * 0.44,
					ease: "power2.out",
				},
				span * 0.56,
			)
			// 入场落定后标题上移，第二层第一条祝福语逐字翻入
			.to(stack, { y: stackY, duration: 0.46, ease: "power3.out" }, span + 0.06)
			.fromTo(
				messages[0] ?? [],
				{ rotationX: 92, autoAlpha: 0 },
				{
					rotationX: 0,
					autoAlpha: 1,
					duration: flipInSpan,
					ease: "power3.out",
					stagger: flipStagger,
				},
				span + 0.18,
			);
	};

	const setAwake = (next: boolean) => {
		if (awake === next) return;
		awake = next;
		if (next) {
			cycleCall?.play();
			flip?.play();
			return;
		}
		cycleCall?.pause();
		flip?.pause();
	};

	reset();

	const trigger = ScrollTrigger.create({
		id: "home-blinds-headline",
		trigger: section,
		start: "top 66.666%",
		end: "bottom top",
		invalidateOnRefresh: true,
		onToggle: (self) => {
			setAwake(self.isActive);
			if (self.isActive) play();
		},
	});

	// onToggle 在 refresh 时不补发，所以缩放视口后要按当前滚动位置补一次
	const syncFromScroll = () => {
		setAwake(trigger.isActive);
		if (trigger.isActive) play();
	};
	ScrollTrigger.addEventListener("refresh", syncFromScroll);
	syncFromScroll();

	// 视口变化后重新量标题宽度：未播则复位起点，播完则直接落到终态重新对齐
	const relayout = () => {
		if (!played) {
			reset();
			return;
		}
		if (enter?.isActive()) return;
		settle();
	};
	window.addEventListener(
		"resize",
		() => {
			window.clearTimeout(relayoutTimer);
			relayoutTimer = window.setTimeout(relayout, 200);
		},
		{ signal },
	);
	// 自定义字体晚于首帧就绪，标题宽度会变，中缝宽度需要重新量
	void document.fonts.ready.then(() => {
		if (headline.isConnected) relayout();
	});

	return () => {
		window.clearTimeout(relayoutTimer);
		ScrollTrigger.removeEventListener("refresh", syncFromScroll);
		trigger.kill();
		stopCycle();
		enter?.kill();
		enter = null;
		gsap.killTweensOf([
			headline,
			stack,
			ring,
			axisLeft,
			axisRight,
			...edges,
			...bands,
			...messages.flat(),
		]);
		gsap.set(headline, { autoAlpha: 0 });
	};
}

async function initializeHomeBlinds(root: HTMLElement, generation: number) {
	const config = parseRuntimeConfig(root);
	const [{ gsap }, { ScrollTrigger }] = await Promise.all([
		import("gsap"),
		import("gsap/ScrollTrigger"),
	]);

	if (generation !== bootGeneration || !root.isConnected || activeRoot !== root)
		return null;
	gsap.registerPlugin(ScrollTrigger);

	const abortController = new AbortController();
	const context: SetupContext = {
		root,
		gsap,
		ScrollTrigger,
		config,
		signal: abortController.signal,
	};
	const revealCleanup = setupReveal(context);
	const headlineCleanup = setupHeadline(context);
	const scenesCleanup = setupScenes(context);

	root.dataset.homeBlindsReady = "ready";
	ScrollTrigger.refresh();

	return () => {
		abortController.abort();
		revealCleanup();
		headlineCleanup();
		scenesCleanup();
		delete root.dataset.homeBlindsReady;
	};
}

export function bootHomeBlinds() {
	bindMediaWatchers();
	const nextRoot = document.getElementById("home-blinds");
	if (nextRoot === activeRoot) return;

	bootGeneration += 1;
	activeCleanup?.();
	activeCleanup = null;
	activeRoot = nextRoot;

	if (!nextRoot || !canInitialize(nextRoot)) {
		if (nextRoot) nextRoot.dataset.homeBlindsReady = "inactive";
		return;
	}

	const generation = bootGeneration;
	void initializeHomeBlinds(nextRoot, generation)
		.then((cleanup) => {
			if (!cleanup) return;
			if (generation !== bootGeneration || activeRoot !== nextRoot) {
				cleanup();
				return;
			}
			activeCleanup = cleanup;
		})
		.catch(() => {
			if (generation === bootGeneration && nextRoot.isConnected) {
				nextRoot.dataset.homeBlindsReady = "fallback";
			}
		});
}
