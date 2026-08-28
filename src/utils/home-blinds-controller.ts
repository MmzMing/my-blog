import { requestScrollTriggerRefresh } from "@/utils/scroll-trigger-refresh";

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
	/**
	 * 入场标题的播放状态。setupReveal 比 setupHeadline 先建，但退场 scrub 需要
	 * 知道「标题是否已入场」才能决定回滚锚定的目标值，故由 initializeHomeBlinds
	 * 先建好这个共享对象，setupHeadline 在 play() 时置位。
	 */
	headlineState: { played: boolean };
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
	/** 三层的入场时刻（秒）；缺省即用默认节奏，首幕要等取景框播完故单独给 */
	veilAt?: number;
	markAt?: number;
	charsAt?: number;
	veilFrom: TweenVars;
	veilTo: TweenVars;
	markFrom: TweenVars;
	markTo: TweenVars;
	charFrom: TweenVars;
	charTo: TweenVars;
};

const CAPTION_VEIL_AT = 0.52;
const CAPTION_MARK_AT = 0.6;
const CAPTION_CHARS_AT = 0.64;

const CAPTION_MOTION: Record<string, CaptionMotion> = {
	// 序幕：取景框四角与快门先走完，右下角简介最后自右侧滑入
	camera: {
		veilAt: 1,
		markAt: 1.08,
		charsAt: 1.12,
		veilFrom: { autoAlpha: 0, clipPath: "inset(0% 0% 0% 100%)" },
		veilTo: {
			autoAlpha: 1,
			clipPath: "inset(0% 0% 0% 0%)",
			duration: 0.58,
			ease: "power3.inOut",
		},
		markFrom: { autoAlpha: 0, scaleX: 0 },
		markTo: { autoAlpha: 1, scaleX: 1, duration: 0.5, ease: "power3.out" },
		charFrom: { autoAlpha: 0, x: 20 },
		charTo: {
			autoAlpha: 1,
			x: 0,
			duration: 0.46,
			ease: "power3.out",
			stagger: { each: 0.022, from: "end" },
		},
	},
	// 第二幕：书签自图框上沿垂下，简介逐字落位（大字与落款见 CAPTION_DECOR）
	bookmark: {
		veilFrom: { autoAlpha: 0, scaleY: 0 },
		veilTo: { autoAlpha: 1, scaleY: 1, duration: 0.62, ease: "power3.inOut" },
		markFrom: { autoAlpha: 0, scaleY: 0 },
		markTo: { autoAlpha: 1, scaleY: 1, duration: 0.56, ease: "power3.inOut" },
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
	// 第三幕：圆角卡片自右向左展开，文字自末尾往前补齐（签名见 CAPTION_DECOR）
	card: {
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
	// 终幕：双线内框压入，文字按方块感一格格亮起（像素方块群见 CAPTION_DECOR）
	pixel: {
		veilFrom: { autoAlpha: 0, scale: 1.06 },
		veilTo: { autoAlpha: 1, scale: 1, duration: 0.7, ease: "power3.out" },
		markFrom: { autoAlpha: 0, scaleX: 0 },
		markTo: { autoAlpha: 1, scaleX: 1, duration: 0.6, ease: "power3.out" },
		charFrom: { autoAlpha: 0, scale: 0.42 },
		charTo: {
			autoAlpha: 1,
			scale: 1,
			duration: 0.36,
			ease: "steps(3)",
			stagger: { each: 0.026, from: "center" },
		},
	},
};

/**
 * 各幕版式专属的装饰层：取景框 / 书签大字与落款 / 日期签名 / 像素方块。
 * 元素在 collectDecor 里一次性收好，各幕只用到其中一部分，其余为空。
 */
type SceneDecor = {
	/** 取景框四角、终幕内框四角 */
	corners: Element[];
	ring: Element | null;
	core: Element | null;
	flash: Element | null;
	/** 相机参数行 / 书签落款行 */
	lines: Element[];
	leadChars: Element[];
	marks: Element[];
	sign: Element | null;
	signSweep: Element | null;
	signFlourish: Element | null;
	signDate: Element | null;
	signTime: Element | null;
	pixels: Element[];
	/** 第四幕的空心大序号 */
	numeral: Element | null;
	/** 第四幕右侧的双线 */
	rules: Element[];
};

/**
 * 文本行的入场方向按幕分：首幕自左推入（HUD 感），
 * 第二、四幕自上落下（题签感）
 */
const DECOR_LINE_FROM: Record<string, TweenVars> = {
	camera: { autoAlpha: 0, x: -14 },
	bookmark: { autoAlpha: 0, y: -18 },
	ribbon: { autoAlpha: 0, y: -14 },
};
const DECOR_LINE_TO: TweenVars = { autoAlpha: 1, x: 0, y: 0 };

type DecorPlayer = (
	gsap: Gsap,
	timeline: GsapTimeline,
	decor: SceneDecor,
) => void;

function formatSignatureDate(now: Date) {
	const month = String(now.getMonth() + 1).padStart(2, "0");
	const day = String(now.getDate()).padStart(2, "0");
	return `${now.getFullYear()} / ${month} / ${day}`;
}

function formatSignatureTime(now: Date) {
	const hour = String(now.getHours()).padStart(2, "0");
	const minute = String(now.getMinutes()).padStart(2, "0");
	return `${hour}:${minute} · LOCAL`;
}

const CAPTION_DECOR: Record<string, DecorPlayer> = {
	// 首幕：四角边框依次张开 → 快门圆落位 → 收一下并白闪一帧（快门声那一下）→ 左上参数补齐
	camera: (_gsap, timeline, decor) => {
		if (decor.corners.length > 0) {
			timeline.to(
				decor.corners,
				{
					autoAlpha: 1,
					scale: 1,
					duration: 0.42,
					ease: "power3.out",
					stagger: 0.05,
				},
				0.04,
			);
		}
		if (decor.ring) {
			timeline
				.to(
					decor.ring,
					{
						autoAlpha: 1,
						scale: 1,
						rotation: 0,
						duration: 0.62,
						ease: "power3.out",
					},
					0.16,
				)
				.to(decor.ring, { scale: 0.9, duration: 0.12, ease: "power2.in" }, 0.72)
				.to(decor.ring, { scale: 1, duration: 0.36, ease: "power2.out" }, 0.84);
		}
		if (decor.core) {
			timeline.to(
				decor.core,
				{ autoAlpha: 1, scale: 1, duration: 0.4, ease: "back.out(2.4)" },
				0.34,
			);
		}
		if (decor.flash) {
			timeline
				.to(decor.flash, { autoAlpha: 0.6, duration: 0.08, ease: "none" }, 0.74)
				.to(
					decor.flash,
					{ autoAlpha: 0, duration: 0.36, ease: "power2.out" },
					0.82,
				);
		}
		if (decor.lines.length > 0) {
			timeline.to(
				decor.lines,
				{
					...DECOR_LINE_TO,
					duration: 0.42,
					ease: "power2.out",
					stagger: 0.06,
				},
				0.88,
			);
		}
		return;
	},
	// 第二幕：大字逐字落位 → 落款行跟上 → 青色印章转正
	bookmark: (_gsap, timeline, decor) => {
		if (decor.leadChars.length > 0) {
			timeline.to(
				decor.leadChars,
				{
					autoAlpha: 1,
					y: 0,
					rotation: 0,
					duration: 0.58,
					ease: "back.out(1.5)",
					stagger: 0.055,
				},
				0.6,
			);
		}
		if (decor.lines.length > 0) {
			timeline.to(
				decor.lines,
				{
					...DECOR_LINE_TO,
					duration: 0.46,
					ease: "power2.out",
					stagger: 0.09,
				},
				0.9,
			);
		}
		if (decor.marks.length > 0) {
			timeline.to(
				decor.marks,
				{
					autoAlpha: 1,
					scale: 1,
					rotation: 0,
					duration: 0.5,
					ease: "back.out(2)",
					stagger: 0.08,
				},
				1,
			);
		}
		return;
	},
	// 第三幕：右下角日期签名，手写笔触扫开日期后补一道收笔弧线
	card: (_gsap, timeline, decor) => {
		const now = new Date();
		if (decor.signDate) decor.signDate.textContent = formatSignatureDate(now);
		if (decor.signTime) decor.signTime.textContent = formatSignatureTime(now);
		if (decor.sign) {
			timeline.to(decor.sign, { autoAlpha: 1, duration: 0.2 }, 0.84);
		}
		if (decor.signSweep) {
			timeline.to(
				decor.signSweep,
				{ strokeDashoffset: 0, duration: 1.05, ease: "power2.inOut" },
				0.88,
			);
		}
		if (decor.signFlourish) {
			timeline.to(
				decor.signFlourish,
				{ strokeDashoffset: 0, duration: 0.52, ease: "power2.out" },
				1.5,
			);
		}
		if (decor.signTime) {
			timeline.to(
				decor.signTime,
				{ autoAlpha: 1, y: 0, duration: 0.4, ease: "power2.out" },
				1.7,
			);
		}
		return;
	},
	// 第四幕：空心大序号缓推入位 → 右侧双线自上画下 → 竖排标识落下，全程不抢色带的戏
	ribbon: (_gsap, timeline, decor) => {
		if (decor.numeral) {
			timeline.to(
				decor.numeral,
				{
					autoAlpha: 1,
					scale: 1,
					x: 0,
					duration: 0.92,
					ease: "power3.out",
				},
				0.3,
			);
		}
		if (decor.rules.length > 0) {
			timeline.to(
				decor.rules,
				{
					autoAlpha: 1,
					scaleY: 1,
					duration: 0.6,
					ease: "power3.inOut",
					stagger: 0.1,
				},
				0.46,
			);
		}
		if (decor.lines.length > 0) {
			timeline.to(
				decor.lines,
				{ ...DECOR_LINE_TO, duration: 0.5, ease: "power2.out" },
				0.82,
			);
		}
		return;
	},
	// 终幕：底部像素方块随机亮起，内框四角方块最后压上
	pixel: (_gsap, timeline, decor) => {
		if (decor.pixels.length > 0) {
			timeline.to(
				decor.pixels,
				{
					autoAlpha: 1,
					scale: 1,
					duration: 0.34,
					ease: "power1.out",
					stagger: { each: 0.008, from: "random" },
				},
				0.28,
			);
		}
		if (decor.corners.length > 0) {
			timeline.to(
				decor.corners,
				{
					autoAlpha: 1,
					scale: 1,
					duration: 0.34,
					ease: "back.out(2.2)",
					stagger: 0.06,
				},
				0.72,
			);
		}
		return;
	},
};

/** 一幕之内需要分层显示的所有元素 */
type SceneRefs = {
	card: HTMLElement;
	swing: HTMLElement;
	variant: string;
	motion: CaptionMotion;
	decor: SceneDecor;
	decorPlay: DecorPlayer | null;
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
	// 先整层拆掉再重建：teardown 会作废仍在飞的异步初始化并复位 activeRoot，
	// 因此紧随其后的 boot 一定会走完整流程（越过 nextRoot === activeRoot 的短路）
	const restart = () => {
		teardownHomeBlinds();
		bootHomeBlinds();
	};

	desktopQuery.addEventListener("change", restart);
	reducedMotionQuery.addEventListener("change", restart);
}

/** 装饰层元素一次性收好；各幕只用到其中一部分，用不到的留空 */
function collectDecor(card: HTMLElement): SceneDecor {
	const all = (selector: string) => Array.from(card.querySelectorAll(selector));
	return {
		corners: all("[data-scene-decor-corner]"),
		ring: card.querySelector("[data-scene-decor-ring]"),
		core: card.querySelector("[data-scene-decor-core]"),
		flash: card.querySelector("[data-scene-decor-flash]"),
		lines: all("[data-scene-decor-line]"),
		leadChars: all("[data-scene-decor-lead-char]"),
		marks: all("[data-scene-decor-mark]"),
		sign: card.querySelector("[data-scene-decor-sign]"),
		signSweep: card.querySelector("[data-scene-decor-sign-sweep]"),
		signFlourish: card.querySelector("[data-scene-decor-sign-flourish]"),
		signDate: card.querySelector("[data-scene-decor-sign-date]"),
		signTime: card.querySelector("[data-scene-decor-sign-time]"),
		pixels: all("[data-scene-decor-pixel]"),
		numeral: card.querySelector("[data-scene-decor-numeral]"),
		rules: all("[data-scene-decor-rule]"),
	};
}

function collectScene(card: HTMLElement): SceneRefs {
	const variant = card.dataset.sceneVariant ?? "camera";
	const caption = selectRequired<HTMLElement>(card, "[data-scene-caption]");
	return {
		card,
		swing: selectRequired<HTMLElement>(card, "[data-scene-swing]"),
		variant,
		motion: CAPTION_MOTION[variant] ?? CAPTION_MOTION.camera,
		decor: collectDecor(card),
		decorPlay: CAPTION_DECOR[variant] ?? null,
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

/** 装饰层的初始（隐藏）状态：各幕只有自己那部分元素存在，其余分支自然跳过 */
function hideSceneDecor(gsap: Gsap, scene: SceneRefs) {
	const decor = scene.decor;
	if (decor.corners.length > 0) {
		gsap.set(decor.corners, { autoAlpha: 0, scale: 0.66 });
	}
	if (decor.ring) {
		gsap.set(decor.ring, { autoAlpha: 0, scale: 1.32, rotation: -20 });
	}
	if (decor.core) gsap.set(decor.core, { autoAlpha: 0, scale: 0.5 });
	if (decor.flash) gsap.set(decor.flash, { autoAlpha: 0 });
	if (decor.lines.length > 0) {
		gsap.set(
			decor.lines,
			DECOR_LINE_FROM[scene.variant] ?? { autoAlpha: 0, y: -14 },
		);
	}
	if (decor.leadChars.length > 0) {
		gsap.set(decor.leadChars, { autoAlpha: 0, y: -32, rotation: 7 });
	}
	if (decor.marks.length > 0) {
		gsap.set(decor.marks, { autoAlpha: 0, scale: 0, rotation: -32 });
	}
	if (decor.sign) gsap.set(decor.sign, { autoAlpha: 0 });
	if (decor.signSweep) gsap.set(decor.signSweep, { strokeDashoffset: 1 });
	if (decor.signFlourish) gsap.set(decor.signFlourish, { strokeDashoffset: 1 });
	if (decor.signTime) gsap.set(decor.signTime, { autoAlpha: 0, y: 6 });
	if (decor.pixels.length > 0) {
		gsap.set(decor.pixels, { autoAlpha: 0, scale: 0.34 });
	}
	if (decor.numeral) {
		gsap.set(decor.numeral, { autoAlpha: 0, scale: 1.08, x: -16 });
	}
	if (decor.rules.length > 0) {
		gsap.set(decor.rules, { autoAlpha: 0, scaleY: 0 });
	}
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
	hideSceneDecor(gsap, scene);
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

	// 字幕逐字节点每幕二十余个、五幕上百个，终幕像素方块更是近百个，
	// will-change 不在 CSS 里常驻：入场期间临时挂上（含代价最高的 filter），播完立刻清成 auto
	const boosted = [
		...scene.captionChars,
		...scene.decor.leadChars,
		...scene.decor.pixels,
	];
	const timeline = gsap.timeline({
		onStart: () =>
			gsap.set(boosted, {
				willChange: "transform, opacity, filter",
			}),
		onComplete: () => gsap.set(boosted, { willChange: "auto" }),
	});

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
		.to(
			scene.captionVeil,
			{ ...scene.motion.veilTo },
			scene.motion.veilAt ?? CAPTION_VEIL_AT,
		)
		.to(
			scene.captionMark,
			{ ...scene.motion.markTo },
			scene.motion.markAt ?? CAPTION_MARK_AT,
		)
		.to(
			scene.captionChars,
			{ ...scene.motion.charTo },
			scene.motion.charsAt ?? CAPTION_CHARS_AT,
		);

	// 版式专属的装饰层（取景框 / 大字与落款 / 日期签名 / 像素方块）挂在同一条时间线上，
	// 各自用绝对时刻定位，因此追加顺序无所谓
	scene.decorPlay?.(gsap, timeline, scene.decor);

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
	// 电池内是一排小方块，逐块点亮，不再是一条连续长条；
	// 序号与百分比文本已去掉，进度只靠方块表达，数值仅保留在 aria-valuenow 上
	const meterBlocks = Array.from(
		meter.querySelectorAll<HTMLElement>("[data-scenes-meter-block]"),
	);
	const portal = selectRequired<HTMLElement>(root, "[data-scenes-portal]");
	const portalImage = selectRequired<HTMLImageElement>(
		portal,
		"[data-scenes-portal-image]",
	);
	// 收缩终点的图框边框：独立一层，不参与缩放也不被 portal 的 clip-path 裁掉
	const portalEdge = selectRequired<HTMLElement>(
		root,
		"[data-scenes-portal-edge]",
	);
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
	// 木杆改成立牌的子元素：横位恒定、只随立牌图一起上下动，
	// 因此不再需要每帧按 getBoundingClientRect 重算两端坐标
	const standPole =
		stand?.querySelector<HTMLElement>("[data-scene-stand-pole]") ?? null;
	// 立牌图与木杆同步做跳跃位移，避免抬起时杆头与鞋底脱开
	const standJumpTargets = [standImage, standPole].filter(
		(element): element is HTMLElement => element !== null,
	);
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
	// 背景跑马灯：两份等长列表首尾相接，xPercent 从 0 走到 -50 正好换过一整轮，
	// 即画面持续左移；因为两份内容一致，接缝处画面完全重合，循环看不出跳帧。
	const cycleLoop = gsap.timeline({ repeat: -1, paused: true });
	cycleLoop.fromTo(
		cycleTrack,
		{ xPercent: 0 },
		{
			xPercent: -50,
			duration: Math.max(4, config.scenes.cycleDuration),
			ease: "none",
		},
	);

	// 图框尺寸完全由 CSS 变量决定；offset* 取的是不受 transform 影响的布局尺寸，
	// 所以可以直接当作全屏背景收缩的终点，无需和 CSS 重复一遍计算公式。
	// 这三个值只随视口变化，因此按 resize / refresh 缓存：横移的每一帧都要用它们，
	// 而逐帧读 offsetWidth 会在样式写入之后强制同步布局，是 pin 段掉帧的主因之一。
	let cachedSceneWidth = 0;
	let cachedSceneHeight = 0;
	let cachedSceneStep = 0;
	// 过渡层收缩的终点缩放比 = 图框 cover 缩放 / 视口 cover 缩放
	let cachedPortalScale = 1;
	/** 把图片按 cover 铺满给定框所需的缩放比 */
	const coverScale = (boxWidth: number, boxHeight: number) =>
		Math.max(
			boxWidth / portalImage.naturalWidth,
			boxHeight / portalImage.naturalHeight,
		);
	const measureScene = () => {
		cachedSceneWidth =
			cards[0]?.offsetWidth || Math.round(window.innerWidth * 0.44);
		cachedSceneHeight =
			cards[0]?.offsetHeight || Math.round(window.innerWidth * 0.33);
		// 画面放大后横向间距同步拉开：一幕宽度 + 至少 16vw 的留白
		cachedSceneStep =
			cachedSceneWidth + Math.max(150, window.innerWidth * 0.16);

		// 过渡层：给图片写死「视口 cover 的渲染尺寸」作为布局宽高，收缩全程只做等比
		// scale，object-fit 因此不再随尺寸重算裁切（那正是每帧重光栅的来源）。
		// 起点 scale=1 精确等于视口 cover，终点等于图框 cover，两端分别与 reveal 层
		// 背景、首幕图框重合。等比缩放对任意长宽比都成立，无边界条件。
		// 居中一律要写，自然尺寸没就绪时也得先摆正（此时尺寸走 CSS 的 100vw/100vh 兜底）
		gsap.set(portalImage, { xPercent: -50, yPercent: -50 });
		if (portalImage.naturalWidth > 0 && portalImage.naturalHeight > 0) {
			const viewportCover = coverScale(window.innerWidth, window.innerHeight);
			const frameCover = coverScale(cachedSceneWidth, cachedSceneHeight);
			cachedPortalScale = frameCover / viewportCover;
			gsap.set(portalImage, {
				width: portalImage.naturalWidth * viewportCover,
				height: portalImage.naturalHeight * viewportCover,
			});
		}
		// 边框只按图框布局尺寸定位，全程不参与缩放
		gsap.set(portalEdge, {
			xPercent: -50,
			yPercent: -50,
			width: cachedSceneWidth,
			height: cachedSceneHeight,
		});
	};
	measureScene();
	// 首次测量时图片可能尚未解码，naturalWidth 为 0、上面那个分支会被跳过；
	// 就绪后补量一次，并让 ScrollTrigger 按新几何重算收缩终点。
	if (!portalImage.complete || portalImage.naturalWidth === 0) {
		portalImage.addEventListener(
			"load",
			() => {
				measureScene();
				ScrollTrigger.refresh();
			},
			{ once: true, signal },
		);
	}

	const stopBounce = () => {
		bounceTimeline?.kill();
		bounceTimeline = null;
		if (standJumpTargets.length === 0) return;
		gsap.killTweensOf(standJumpTargets);
		gsap.set(standJumpTargets, { y: 0, scaleX: 1, scaleY: 1 });
	};

	/**
	 * 跳跃循环：只有单纯的上下位移，不带蓄力下蹲、拉伸压缩等形变。
	 */
	const startBounce = () => {
		if (!actVisible || standJumpTargets.length === 0) return;
		stopBounce();
		const timeline = gsap.timeline({ repeat: -1 });
		// 最高一跳 95px：CSS 里木杆的长度余量按这个值给，改这里要同步改
		// .home-blinds-scenes__stand-pole 的 height
		const jumpHeights = [-95, -78];

		for (let jump = 0; jump < 2; jump += 1) {
			timeline
				// 上升
				.to(standJumpTargets, {
					y: jumpHeights[jump],
					duration: 0.29,
					ease: "power2.out",
				})
				// 下落
				.to(standJumpTargets, {
					y: 0,
					duration: 0.29,
					ease: "power2.in",
				});
		}

		bounceTimeline = timeline;
	};

	/**
	 * 背景跑马灯与立牌同时入场，走同一套纸牌立起的姿态：
	 * 以底边为铰链从向后平躺（rotationX 正 88，顶边朝远离视线的方向倒）转到竖直，
	 * 配合 transformPerspective 造出「屏幕从后方地面立起来」的透视；
	 * 正号不可写成负号，负号会变成朝观众一侧倒、成了从前面立起来。
	 * 立牌收一点回弹，背景大面积不回弹免得晃。
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

		if (!stand) return;
		gsap.killTweensOf(stand);
		gsap.set(stand, { xPercent: -50, rotation: 0 });
		// 木杆是立牌的子元素，autoAlpha 与 rotationX 直接继承，无需单独补间
		gsap.to(stand, {
			autoAlpha: 1,
			rotationX: 0,
			duration: 0.72,
			ease: "back.out(1.4)",
			overwrite: "auto",
			onComplete: startBounce,
		});
	};

	/**
	 * 退场只做渐出，不再倒回平躺：整段淡出期间都保持竖直姿态，
	 * 淡完（此时已不可见）才把 rotationX 悄悄复位到 88，下次进场照样从后方立起。
	 * 淡出被 showAct 打断时 onComplete 不执行，元素保持竖直直接淡回来，不会突然摊平。
	 */
	const hideAct = () => {
		if (!actVisible) return;
		actVisible = false;
		stopBounce();

		gsap.killTweensOf(cycleStage);
		gsap.to(cycleStage, {
			autoAlpha: 0,
			duration: 0.5,
			ease: "power2.in",
			overwrite: "auto",
			onComplete: () => gsap.set(cycleStage, { rotationX: 88 }),
		});
		cycleLoop.pause();

		if (!stand) return;
		gsap.killTweensOf(stand);
		gsap.to(stand, {
			autoAlpha: 0,
			duration: 0.46,
			ease: "power2.in",
			overwrite: "auto",
			onComplete: () => gsap.set(stand, { rotationX: 88 }),
		});
	};

	const resetWind = () => {
		for (const setRotation of rotationSetters) setRotation(0);
	};

	// 上一帧已写入的取整值：百分比、点亮块数与显隐取整后大多数帧并无变化，
	// 按值短路可省掉每帧的 setAttribute / classList / autoAlpha 写入。
	let lastMeterPercentage = -1;
	let lastMeterLit = -1;
	let lastMeterVisible: boolean | null = null;

	/** 共用电池进度：按当前居中的连续幕索引逐块点亮，不播放额外入场动画。 */
	const renderMeter = (sceneProgress: number, isVisible: boolean) => {
		const boundedProgress = clamp(sceneProgress, 0, lastSceneIndex);
		const progressRatio =
			sceneCount <= 1 ? 1 : (boundedProgress + 1) / sceneCount;
		const percentage = Math.round(progressRatio * 100);

		// 至少点亮一块：首幕居中时进度已是 1/幕数，不该出现空条
		const litCount =
			meterBlocks.length > 0
				? clamp(
						Math.max(1, Math.round(progressRatio * meterBlocks.length)),
						1,
						meterBlocks.length,
					)
				: 0;
		if (litCount !== lastMeterLit) {
			for (let index = 0; index < meterBlocks.length; index += 1) {
				meterBlocks[index].classList.toggle("is-lit", index < litCount);
			}
			lastMeterLit = litCount;
		}
		// 数值本身不再显示，只同步给读屏
		if (percentage !== lastMeterPercentage) {
			meter.setAttribute("aria-valuenow", String(percentage));
			lastMeterPercentage = percentage;
		}
		if (isVisible !== lastMeterVisible) {
			gsap.set(meter, { autoAlpha: isVisible ? 1 : 0 });
			lastMeterVisible = isVisible;
		}
	};

	const renderScenes = (sceneProgress: number, isVisible: boolean) => {
		renderMeter(sceneProgress, isVisible);
		const step = cachedSceneStep;
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
	};

	function applyPhase() {
		gsap.set(stage, { autoAlpha: rootInView && phase !== "done" ? 1 : 0 });
		gsap.set([stageBackground, stageForegroundWindow, stageHeadlineWindow], {
			autoAlpha: phase === "reveal" ? 1 : 0,
		});
		gsap.set(portal, { autoAlpha: phase === "shrink" ? 1 : 0 });
		// 边框的 opacity 归 shrinkTimeline，这里只切 visibility，两处不抢同一属性
		gsap.set(portalEdge, {
			visibility: phase === "shrink" ? "visible" : "hidden",
		});
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

	// 尺寸恒为满屏，收缩由 clip-path 收窗完成，故这里不再写 width / height
	gsap.set(portal, {
		xPercent: -50,
		yPercent: -50,
		x: 0,
		y: 0,
		clipPath: "inset(0px 0px 0px 0px)",
		autoAlpha: 0,
	});
	gsap.set(portalEdge, { opacity: 0, visibility: "hidden" });
	gsap.set(cards, { autoAlpha: 0 });
	// 立牌与背景跑马灯的初始姿态：以底边为铰链向后（远离视线）几乎平躺，入场时朝观众立起来
	gsap.set(stands, {
		xPercent: -50,
		y: 0,
		rotationX: 88,
		transformPerspective: 1100,
		autoAlpha: 0,
	});
	gsap.set(cycleStage, {
		rotationX: 88,
		transformPerspective: 1400,
		autoAlpha: 0,
	});
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

	// 全屏背景 → 首幕 4:3 图框，全程不碰布局属性：portal 用 clip-path 把可视窗口
	// 从满屏收到图框（只触发 paint），内部图片同步做等比 scale（走合成），
	// 2px 边框在后段淡入，终点与 .home-blinds-scene__frame 完全重合。
	// 这条时间线开了 invalidateOnRefresh，用 fromTo 显式写出起始值，
	// 缩放窗口后重新记录的起点才不会被当前已渲染的终点状态污染。
	shrinkTimeline
		.fromTo(
			portal,
			{ clipPath: "inset(0px 0px 0px 0px)" },
			{
				clipPath: () => {
					const insetX = Math.max(
						0,
						(window.innerWidth - cachedSceneWidth) / 2,
					);
					const insetY = Math.max(
						0,
						(window.innerHeight - cachedSceneHeight) / 2,
					);
					return `inset(${insetY}px ${insetX}px ${insetY}px ${insetX}px)`;
				},
				duration: 1,
				ease: "power3.inOut",
				immediateRender: false,
			},
			0,
		)
		.fromTo(
			portalImage,
			{ scale: 1 },
			{
				scale: () => cachedPortalScale,
				duration: 1,
				ease: "power3.inOut",
				immediateRender: false,
			},
			0,
		)
		.fromTo(
			portalEdge,
			{ opacity: 0 },
			{
				opacity: 1,
				duration: 0.34,
				ease: "power2.out",
				immediateRender: false,
			},
			0.66,
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
	// 必须先按新视口量一遍图框尺寸，再按新尺寸同步各幕位置，顺序不能颠倒。
	const handleRefresh = () => {
		measureScene();
		syncStage();
	};
	ScrollTrigger.addEventListener("refresh", handleRefresh);

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

	syncStage();

	return () => {
		window.clearTimeout(resetWindTimer);
		window.clearTimeout(resizeTimer);
		ScrollTrigger.removeEventListener("refresh", handleRefresh);
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
			...standJumpTargets,
			portal,
			portalImage,
			portalEdge,
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
			// 从别的页面深处跳入首页时，标题退场补间的初次渲染就落在终点态，
			// 之后回滚到退场区间之下时 GSAP 不会再补渲染它的起点，常驻标题
			// 因此一直隐身；relayout()/fonts.ready 的 reset() 也可能把根节点
			// 打回隐藏。只要已入场且滚动位于退场区间之下，这里显式把标题锚回
			// 可见态，退场交给上面的 fromTo 在区间内正常接管。
			onUpdate: (self) => {
				if (self.progress < REVEAL_EXIT_START && context.headlineState.played) {
					gsap.set(headline, { yPercent: 0, autoAlpha: 1 });
				}
			},
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
	const core = selectRequired<HTMLElement>(headline, "[data-headline-core]");
	// 虚线圆与圆心准星同进同出，一并当作一组处理
	const reticle = [ring, core];
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
		const incoming = messages[current];
		// 只在翻页这段时间提升参与翻转的两句逐字节点，播完清成 auto；
		// CSS 里不再常驻 will-change，避免祝福语条数一多就长期占住合成层
		const flipping = [...outgoing, ...incoming];
		flip?.kill();
		flip = gsap
			.timeline({
				onStart: () => gsap.set(flipping, { willChange: "transform, opacity" }),
				onComplete: () => {
					gsap.set(flipping, { willChange: "auto" });
					scheduleNext();
				},
			})
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
				incoming,
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
		gsap.set(reticle, { autoAlpha: 0, rotation: -90, scale: 0.92 });
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
		gsap.set(reticle, { autoAlpha: 1, rotation: 0, scale: 1 });
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
		context.headlineState.played = true;
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
				reticle,
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
			...reticle,
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
		headlineState: { played: false },
	};

	/**
	 * 三层按序搭建，各自返回自己的 cleanup。
	 * 每层都用 selectRequired 取节点，缺一个就 throw，所以必须边搭边记：
	 * 若后面的层抛错而前面的层已经建好，那些 ScrollTrigger 再没有引用能清掉，
	 * 会一直挂在 ScrollTrigger 全局列表里对着游离节点更新（Swup 下每次导航都还在）。
	 * 逆序回滚，重复调用无副作用（栈已清空）。
	 */
	const cleanups: Array<() => void> = [];
	const teardown = () => {
		abortController.abort();
		while (cleanups.length > 0) cleanups.pop()?.();
	};

	try {
		cleanups.push(setupReveal(context));
		cleanups.push(setupHeadline(context));
		cleanups.push(setupScenes(context));
	} catch (error) {
		teardown();
		throw error;
	}

	root.dataset.homeBlindsReady = "ready";
	// 与 hero 的 refresh 合并到同一帧：hero 是同步建 pin，这一层要等
	// await import("gsap") 之后才建，各自 refresh 会让先跑的那次量到还缺一层 pin-spacer
	// 的文档高度，pin 起止点因此偏掉（进首页后第二幕与影像层的滚动进度对不上）
	requestScrollTriggerRefresh(ScrollTrigger);

	return () => {
		teardown();
		delete root.dataset.homeBlindsReady;
	};
}

/**
 * Swup 容器被替换之前拆掉整层。
 * 只挂 astro:page-load 的话，清理会推迟到 content:replace 之后 ——
 * 那时被 pin 的 section 和 ScrollTrigger 自己插的 .pin-spacer 已经随容器一起摘掉，
 * kill() 变成在游离节点上做 revert；而离场淡出期间跑马灯与跳跃这两条
 * repeat: -1 的时间线还在跑。递增 generation 同时作废仍在飞的异步初始化。
 * 复位 activeRoot 后，下一次 bootHomeBlinds 会照常重建（非首页时两者同为 null，直接短路）。
 */
export function teardownHomeBlinds() {
	bootGeneration += 1;
	activeCleanup?.();
	activeCleanup = null;
	activeRoot = null;
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
