import { requestScrollTriggerRefresh } from "@/utils/scroll-trigger-refresh";

type Gsap = typeof import("gsap")["gsap"];
type ScrollTriggerPlugin = typeof import("gsap/ScrollTrigger")["ScrollTrigger"];
type ScrollTriggerInstance = ReturnType<ScrollTriggerPlugin["create"]>;
type GsapTimeline = ReturnType<Gsap["timeline"]>;
type GsapTween = ReturnType<Gsap["to"]>;

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

/** 一幕之内需要分层显示的所有元素 */
type SceneRefs = {
	card: HTMLElement;
	swing: HTMLElement;
	railDot: HTMLElement;
	railEyebrow: HTMLElement;
	railLine: HTMLElement;
	railTitle: HTMLElement;
	sticker: HTMLElement;
	/** 底栏：左列（中文年 + 月日）与竖杠只在配置写了 date 时渲染，故可空 */
	band: HTMLElement | null;
	bandDivider: HTMLElement | null;
	bandNote: HTMLElement;
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

function collectScene(card: HTMLElement): SceneRefs {
	return {
		card,
		swing: selectRequired<HTMLElement>(card, "[data-scene-swing]"),
		railDot: selectRequired<HTMLElement>(card, "[data-scene-rail-dot]"),
		railEyebrow: selectRequired<HTMLElement>(card, "[data-scene-rail-eyebrow]"),
		railLine: selectRequired<HTMLElement>(card, "[data-scene-rail-line]"),
		railTitle: selectRequired<HTMLElement>(card, "[data-scene-rail-title]"),
		sticker: selectRequired<HTMLElement>(card, "[data-scene-sticker]"),
		band: card.querySelector<HTMLElement>("[data-scene-band]"),
		bandDivider: card.querySelector<HTMLElement>("[data-scene-band-divider]"),
		bandNote: selectRequired<HTMLElement>(card, "[data-scene-note]"),
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
	gsap.set(scene.sticker, { autoAlpha: 0, scale: 0, rotation: -26 });
	if (scene.band) gsap.set(scene.band, { autoAlpha: 0, x: -10 });
	if (scene.bandDivider)
		gsap.set(scene.bandDivider, { autoAlpha: 0, scaleY: 0 });
	gsap.set(scene.bandNote, { autoAlpha: 0, y: 8 });
}

/**
 * 分层显示：竖排题名 → 左上角序号贴纸 → 底栏（左列标题与日期、竖杠、右栏说明）。
 * 只在图框收缩到位（阶段已进入 scenes）且该幕居中时调用，
 * 因此文字永远不会与背景收缩动画抢镜。
 */
function playSceneIntro(gsap: Gsap, scene: SceneRefs) {
	if (scene.active) return;
	scene.active = true;
	scene.intro?.kill();
	hideSceneChrome(gsap, scene);

	// 底栏三件不在 CSS 里常驻 will-change：入场期间临时挂上，播完立刻清成 auto。
	// 左列与竖杠只在配置写了 date 时存在，这里按实际渲染结果收集
	const boosted = [scene.band, scene.bandDivider, scene.bandNote].filter(
		(element): element is HTMLElement => element !== null,
	);
	const timeline = gsap.timeline({
		onStart: () =>
			gsap.set(boosted, {
				willChange: "transform, opacity",
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
			scene.sticker,
			{
				autoAlpha: 1,
				scale: 1,
				rotation: -8,
				duration: 0.5,
				ease: "back.out(2.4)",
			},
			0.42,
		);

	// 左列与竖杠只在配置写了 date 的幕里存在，缺了就直接播右栏说明
	if (scene.band) {
		timeline.to(
			scene.band,
			{ autoAlpha: 1, x: 0, duration: 0.46, ease: "power2.out" },
			0.55,
		);
	}
	if (scene.bandDivider) {
		timeline.to(
			scene.bandDivider,
			{ autoAlpha: 1, scaleY: 1, duration: 0.34, ease: "power2.inOut" },
			0.62,
		);
	}
	timeline.to(
		scene.bandNote,
		{ autoAlpha: 1, y: 0, duration: 0.5, ease: "power2.out" },
		0.66,
	);

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
	// 电池上方的状态字：未满写「正在充电」，满格写「充电完毕」
	const meterLabel = selectRequired<HTMLElement>(
		meter,
		"[data-scenes-meter-label]",
	);
	const portal = selectRequired<HTMLElement>(root, "[data-scenes-portal]");
	const portalImage = selectRequired<HTMLImageElement>(
		portal,
		"[data-scenes-portal-image]",
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
	// 待机的压扁只作用在立牌图上：容器留给入场（rotationX）与横位（xPercent），
	// 图片底边即脚底，压扁以它为锚点，脚不会离地。
	const standImage =
		stand?.querySelector<HTMLElement>("[data-scene-stand-image]") ?? null;
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
			duration: 0.28,
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
	let squashTimeline: GsapTimeline | null = null;
	let cycleTransition: GsapTween | null = null;
	let standTransition: GsapTween | null = null;
	/**
	 * 三组判据各管各的，混用会做出「退场段动画被掐掉」这类怪事：
	 * - `isStageInView`：固定舞台（全屏背景与收缩门）该不该露出，滚过影像层就隐藏。
	 * - `isLayerLive`：影像层本身还在屏幕上，**含横移结束后的退场段** —— 跑马灯、立牌
	 *   跳动、字幕入场与横移姿态都要继续跟着 section 一起离场，不能在 done 阶段停下。
	 * - `loopsShouldRun`：在 `isLayerLive` 之上再让开后台标签页，只用于暂停无限循环。
	 * 文档可见性不得参与显隐判断，否则页面被判定不可见时整块舞台会消失。
	 */
	const isStageInView = () => !signal.aborted && rootInView && phase !== "done";
	const isLayerLive = () =>
		!signal.aborted && rootInView && (phase === "scenes" || phase === "done");
	const isScrubActive = () =>
		!signal.aborted && rootInView && phase === "scenes";
	const loopsShouldRun = () =>
		isLayerLive() && document.visibilityState === "visible";
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
	// 图框中心相对整卡中心的垂直布局偏移（图框在明信片上半部，通常为负）；
	// 过渡层的收缩终点整体平移这个偏移，才能与首幕图框严丝合缝
	let cachedPhotoOffsetY = 0;
	// 过渡层收缩的终点缩放比 = 图框 cover 缩放 / 视口 cover 缩放
	let cachedPortalScale = 1;
	/** 把图片按 cover 铺满给定框所需的缩放比 */
	const coverScale = (boxWidth: number, boxHeight: number) =>
		Math.max(
			boxWidth / portalImage.naturalWidth,
			boxHeight / portalImage.naturalHeight,
		);
	const measureScene = () => {
		const firstCard = cards[0] ?? null;
		const firstPhoto =
			firstCard?.querySelector<HTMLElement>("[data-scene-frame]") ?? null;
		// 量的是卡内 4:3 图框而不是整张明信片；节点未就绪时按旧比例兜底
		cachedSceneWidth =
			firstPhoto?.offsetWidth || Math.round(window.innerWidth * 0.44);
		cachedSceneHeight =
			firstPhoto?.offsetHeight || Math.round(window.innerWidth * 0.33);
		const cardHeight = firstCard?.offsetHeight ?? cachedSceneHeight;
		cachedPhotoOffsetY = firstPhoto
			? firstPhoto.offsetTop + cachedSceneHeight / 2 - cardHeight / 2
			: 0;
		// 画面放大后横向间距同步拉开：一幕宽度 + 至少 16vw 的留白
		cachedSceneStep =
			cachedSceneWidth + Math.max(150, window.innerWidth * 0.16);

		// 过渡层：给图片写死「视口 cover 的渲染尺寸」作为布局宽高，收缩全程只做等比
		// scale，object-fit 因此不再随尺寸重算裁切（那正是每帧重光栅的来源）。
		// 起点 scale=1 精确等于视口 cover，终点等于图框 cover，两端分别与 reveal 层
		// 背景、首幕图框重合。等比缩放对任意长宽比都成立，无边界条件。
		// 注意 y 不在此处写：终点偏移 cachedPhotoOffsetY 交给收缩时间线按进度插值，
		// 起点必须与 reveal 背景完全重合（居中、y=0），否则收缩一开始图片就先上移，
		// 底部露出 portal 底色裂隙，交接瞬间也会跳变。
		// 尺寸量的是舞台内容盒：window.innerWidth 含纵向滚动条，会算出偏宽的 cover。
		gsap.set(portalImage, { xPercent: -50, yPercent: -50 });
		if (portalImage.naturalWidth > 0 && portalImage.naturalHeight > 0) {
			const viewportCover = coverScale(stage.clientWidth, stage.clientHeight);
			const frameCover = coverScale(cachedSceneWidth, cachedSceneHeight);
			cachedPortalScale = frameCover / viewportCover;
			gsap.set(portalImage, {
				width: portalImage.naturalWidth * viewportCover,
				height: portalImage.naturalHeight * viewportCover,
			});
		}
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

	/** 压扁峰值：纵向压下的同时横向反向鼓起，保持体积感 */
	const SQUASH_SCALE_Y = 0.86;
	const SQUASH_SCALE_X = 1.06;
	const REBOUND_SCALE_Y = 1.04;
	const REBOUND_SCALE_X = 0.97;

	const stopSquash = () => {
		squashTimeline?.kill();
		squashTimeline = null;
		if (!standImage) return;
		gsap.killTweensOf(standImage);
		gsap.set(standImage, { scale: 1 });
	};

	/**
	 * 待机压扁：以脚底为锚点把立牌图压扁、回弹、归位，一轮约 1s 且中间不停。
	 * 三段都用 sine.inOut，首尾同为原始比例，衔接处速度归零，循环看不出接缝。
	 */
	const startSquash = () => {
		if (signal.aborted || !actVisible || !standImage) return;
		stopSquash();
		const timeline = gsap.timeline({ repeat: -1, paused: !loopsShouldRun() });
		timeline
			.to(standImage, {
				scaleY: SQUASH_SCALE_Y,
				scaleX: SQUASH_SCALE_X,
				duration: 0.34,
				ease: "sine.inOut",
			})
			.to(standImage, {
				scaleY: REBOUND_SCALE_Y,
				scaleX: REBOUND_SCALE_X,
				duration: 0.28,
				ease: "sine.inOut",
			})
			.to(standImage, {
				scaleY: 1,
				scaleX: 1,
				duration: 0.34,
				ease: "sine.inOut",
			});
		squashTimeline = timeline;
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

		cycleTransition?.kill();
		cycleTransition = gsap.to(cycleStage, {
			autoAlpha: 1,
			rotationX: 0,
			duration: 0.78,
			ease: "power4.out",
			overwrite: "auto",
		});

		if (!stand) return;
		standTransition?.kill();
		gsap.set(stand, { xPercent: -50, rotation: 0 });
		// 木杆是立牌的子元素，autoAlpha 与 rotationX 直接继承，无需单独补间
		standTransition = gsap.to(stand, {
			autoAlpha: 1,
			rotationX: 0,
			duration: 0.72,
			ease: "back.out(1.4)",
			overwrite: "auto",
			onComplete: startSquash,
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
		stopSquash();

		cycleTransition?.kill();
		cycleTransition = gsap.to(cycleStage, {
			autoAlpha: 0,
			duration: 0.5,
			ease: "power2.in",
			overwrite: "auto",
			onComplete: () => gsap.set(cycleStage, { rotationX: 88 }),
		});
		cycleLoop.pause();

		if (!stand) return;
		standTransition?.kill();
		standTransition = gsap.to(stand, {
			autoAlpha: 0,
			duration: 0.46,
			ease: "power2.in",
			overwrite: "auto",
			onComplete: () => gsap.set(stand, { rotationX: 88 }),
		});
	};

	// 不用 hideAct 处理离屏：它会杀掉并复位跳跃，回来就不再是离开时的那一帧。
	const syncAnimationPlayback = () => {
		const layerLive = isLayerLive();
		const loopsRun = loopsShouldRun();
		// 立牌与跑马灯的进离场补间不在这里暂停：它们的 onComplete 负责把姿态复位到
		// rotationX 88，暂停会让复位永不发生，下次进场就只剩淡入而不再从后方立起。
		// 两条无限循环额外让开后台标签页；退场段（done）仍属影像层，照常跑。
		cycleLoop.paused(!loopsRun || !actVisible);
		squashTimeline?.paused(!loopsRun || !actVisible);
		for (const scene of scenes) {
			if (scene.intro && scene.intro.progress() < 1) {
				scene.intro.paused(!layerLive);
			}
		}
		for (const setRotation of rotationSetters) {
			if (setRotation.tween.progress() < 1) {
				setRotation.tween.paused(!layerLive);
			}
		}
	};

	const resetWind = () => {
		if (signal.aborted) return;
		for (const setRotation of rotationSetters) setRotation(0);
		syncAnimationPlayback();
	};

	// 上一帧已写入的取整值：百分比、点亮块数与显隐取整后大多数帧并无变化，
	// 按值短路可省掉每帧的 setAttribute / classList / autoAlpha 写入。
	let lastMeterPercentage = -1;
	let lastMeterLit = -1;
	let lastMeterVisible: boolean | null = null;
	let lastMeterFull: boolean | null = null;

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
		// 电池上方的状态字只在满格与否翻转时写一次，不在每帧碰 DOM
		const full = meterBlocks.length > 0 && litCount === meterBlocks.length;
		if (full !== lastMeterFull) {
			const stateText = full ? "充电完毕" : "正在充电";
			meterLabel.textContent = stateText;
			meter.setAttribute("aria-valuetext", stateText);
			lastMeterFull = full;
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
		const layerLive = isLayerLive();
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
			if (isVisible && layerLive && distance < SCENE_ENTER_DISTANCE) {
				playSceneIntro(gsap, scene);
			}

			if (layerLive && Number.isFinite(previousX)) {
				const deltaX = x - previousX;
				if (Math.abs(deltaX) > 0.08) {
					rotationSetters[index](clamp(deltaX * 0.16, -9, 9));
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
		gsap.set(stage, { autoAlpha: isStageInView() ? 1 : 0 });
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
		if (signal.aborted) return;
		phase = resolvePhase();
		applyPhase();

		const progress = pinTrigger?.progress ?? 0;
		horizontalEnabled = isScrubActive() && progress < 0.999;
		viewport.classList.toggle("is-horizontal", horizontalEnabled);
		// done 保留最后一幕随 section 离场，但不再启动或继续任何循环。
		renderScenes(
			phase === "scenes"
				? progress * lastSceneIndex
				: phase === "done"
					? lastSceneIndex
					: 0,
			phase === "scenes" || phase === "done",
		);
		syncAnimationPlayback();
	}

	// 尺寸恒等于视口（inset:0），收缩由 clip-path 收窗完成，故这里不再写 width / height，
	// 也无需任何居中 transform
	gsap.set(portal, {
		x: 0,
		y: 0,
		clipPath: "inset(0px 0px 0px 0px)",
		autoAlpha: 0,
	});
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
	// 终点与 .home-blinds-scene__frame 完全重合。
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
						(stage.clientWidth - cachedSceneWidth) / 2,
					);
					const centerGap = (stage.clientHeight - cachedSceneHeight) / 2;
					// 图框在卡内偏上，收窗终点随之上移，上下 inset 不再对称
					const insetTop = Math.max(0, centerGap + cachedPhotoOffsetY);
					const insetBottom = Math.max(0, centerGap - cachedPhotoOffsetY);
					return `inset(${insetTop}px ${insetX}px ${insetBottom}px ${insetX}px)`;
				},
				duration: 1,
				ease: "power3.inOut",
				immediateRender: false,
			},
			0,
		)
		.fromTo(
			portalImage,
			{ y: 0 },
			{
				// 与收窗同步上移：起点 y=0 与 reveal 背景严丝合缝，终点落在首幕图框中心
				y: () => cachedPhotoOffsetY,
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
			if (self.isActive) syncStage();
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
			syncStage();
		},
	});
	rootInView = rootTrigger.isActive;

	// refresh 事件在所有触发器重新测量之后触发，是缩放后唯一可靠的补偿时机。
	// 必须先按新视口量一遍图框尺寸，再按新尺寸同步各幕位置，顺序不能颠倒。
	const handleRefresh = () => {
		rootInView = rootTrigger.isActive;
		measureScene();
		syncStage();
	};
	ScrollTrigger.addEventListener("refresh", handleRefresh);
	document.addEventListener("visibilitychange", syncStage, { signal });

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
		cycleTransition?.kill();
		standTransition?.kill();
		// stopSquash 已经把立牌图的缩放复位到 1，不必再进下面的 killTweensOf 清单
		stopSquash();
		cycleLoop.kill();
		for (const setRotation of rotationSetters) setRotation.tween.kill();
		for (const scene of scenes) {
			scene.intro?.kill();
			scene.intro = null;
			scene.active = false;
			gsap.set(
				[scene.band, scene.bandDivider, scene.bandNote].filter(
					(element): element is HTMLElement => element !== null,
				),
				{ clearProps: "willChange" },
			);
		}
		renderMeter(0, false);
		viewport.classList.remove("is-horizontal");
		gsap.killTweensOf([
			...cards,
			...swings,
			...stands,
			cycleStage,
			cycleTrack,
			meter,
			stage,
			portal,
			portalImage,
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
		setPointerX.tween.kill();
		setPointerY.tween.kill();
		gsap.killTweensOf([foreground, headline]);
		revealTimeline.scrollTrigger?.kill();
		revealTimeline.kill();
	};
}

/**
 * 第一层入场标题，整段入场压在 enterDuration 内，按五幕推进：
 * ① 开场只有两半长条在中心拼成的一颗小方块，线条与圆环一概不在场；
 * ② 两半边放大边滑向两侧，到竖线处停住，标题从缝里显露，
 *    圆心准星（内圈+四向斜刻度）先在标题背后亮起；
 * ③ 长条在竖线位置原地缩没；中央刻度环自小放大转正，
 *    中缝横线带方块自中间往两侧摊开；
 * ④ 长条快缩没时两侧竖线就位并纵向长出；
 * ⑤ 落定后标题上移，第二层祝福语逐字翻入并循环。退场交给 setupReveal 的 scrub 时间线。
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
	// 刻度环与圆心准星不同幕亮起，仅共用落定与销毁处理
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
	// 竖线的日期刻度层：随竖线一同淡入，但不参与纵向生长（避免文字被 scaleY 拉伸）
	const edgeDates = Array.from(
		headline.querySelectorAll<HTMLElement>("[data-headline-edge-dates]"),
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
	 * 长条全程只做 scaleX + x：外缘 origin 钉死在 CSS 的 band-inset 上。
	 * 开场两半在中心拼成一颗小方块（blockScale / blockShift），
	 * 滑到两侧竖线处（stopShift）正好长满（openScale，内缘恰退到标题半宽外），
	 * 随后停在竖线位置原地缩没，全程不驻留。
	 */
	const measure = () => {
		const bandWidth = bands[0]?.offsetWidth ?? 0;
		const bandLeft = bands[0]?.offsetLeft ?? 0;
		// 停驻点取两侧竖线的布局位：缩没时正好化进竖线里
		const edgeLeft = edges[0]?.offsetLeft ?? window.innerWidth * 0.132;
		const gapHalf = title.offsetWidth / 2 + window.innerWidth * 0.012;
		const blockHalf = title.offsetWidth * 0.2;
		return {
			openScale:
				bandWidth > 0
					? clamp(1 - (gapHalf + edgeLeft - bandLeft) / bandWidth, 0.06, 0.98)
					: 0.76,
			blockScale:
				bandWidth > 0 ? clamp(blockHalf / bandWidth, 0.04, 0.9) : 0.18,
			// 小方块拼到正中所需的外缘平移量：50vw 减去长条外缘的布局位（offsetLeft）
			blockShift: window.innerWidth / 2 - bandLeft - blockHalf,
			// 停驻点：外缘滑到竖线位置即停
			stopShift: edgeLeft - bandLeft,
			// 入场时标题独占中线，落定后整栈上移让出第二层祝福语
			titleY: -title.offsetHeight / 2,
			stackY: -stack.offsetHeight / 2,
		};
	};

	const stopCycle = () => {
		cycleCall?.kill();
		cycleCall = null;
		flip?.kill();
		flip = null;
	};

	const scheduleNext = () => {
		if (signal.aborted || messages.length < 2) return;
		cycleCall?.kill();
		cycleCall = gsap.delayedCall(holdSpan, advance);
		if (!awake) cycleCall.pause();
	};

	/** 祝福语换页：旧句逐字翻出，新句逐字翻入，循环到底再回第一条 */
	function advance() {
		if (signal.aborted) return;
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

	/** 入场前的初始态：两半长条在中心拼成一颗小方块，其余元素全部清场待命 */
	const reset = () => {
		const { titleY, blockScale, blockShift } = measure();
		stopCycle();
		enter?.kill();
		enter = null;
		played = false;
		current = 0;
		gsap.set(headline, { yPercent: 0, autoAlpha: 0 });
		gsap.set(bands, {
			x: (index: number) => (index === 0 ? blockShift : -blockShift),
			scaleX: blockScale,
		});
		gsap.set(edges, { scaleY: 0, autoAlpha: 0 });
		gsap.set(edgeDates, { autoAlpha: 0 });
		gsap.set(axisLeft, { autoAlpha: 0, clipPath: "inset(0% 0% 0% 100%)" });
		gsap.set(axisRight, { autoAlpha: 0, clipPath: "inset(0% 100% 0% 0%)" });
		gsap.set(ring, { autoAlpha: 0, rotation: -90, scale: 0.6 });
		gsap.set(core, { autoAlpha: 0 });
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
		gsap.set(edgeDates, { autoAlpha: 1 });
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
		const { openScale, blockScale, blockShift, stopShift, titleY, stackY } =
			measure();
		const span = enterSpan;
		gsap.set(stack, { y: titleY });
		gsap.set(bands, {
			x: (index: number) => (index === 0 ? blockShift : -blockShift),
			scaleX: blockScale,
		});

		enter = gsap
			.timeline({ onComplete: scheduleNext })
			.set(headline, { yPercent: 0, autoAlpha: 1 }, 0)
			// ① → ②：两半小方块边放大边滑向两侧，外缘滑到竖线位置时正好长满
			.to(
				bands,
				{
					x: (index: number) => (index === 0 ? stopShift : -stopShift),
					scaleX: openScale,
					duration: span * 0.32,
					ease: "power2.in",
				},
				0,
			)
			// ②：缝开的路上圆心准星先一步亮到标题背后（刻度环此幕还不在场）
			.to(
				core,
				{ autoAlpha: 1, duration: span * 0.26, ease: "power2.out" },
				span * 0.08,
			)
			// ③：到竖线处即停住、不停顿，原地缩没；
			// 刻度环自小放大转正，中缝横线带方块自中间往两侧摊开
			.to(
				bands,
				{ scaleX: 0, duration: span * 0.28, ease: "power2.out" },
				span * 0.32,
			)
			.to(
				ring,
				{
					autoAlpha: 1,
					rotation: 0,
					scale: 1,
					duration: span * 0.3,
					ease: "power2.out",
				},
				span * 0.34,
			)
			.to(
				[axisLeft, axisRight],
				{
					autoAlpha: 1,
					clipPath: "inset(0% 0% 0% 0%)",
					duration: span * 0.3,
					ease: "power3.out",
				},
				span * 0.34,
			)
			// ④：长条快缩没时两侧竖线就位并纵向长出，日期刻度随之淡入
			.to(
				edges,
				{
					scaleY: 1,
					autoAlpha: 1,
					duration: span * 0.3,
					ease: "power2.out",
				},
				span * 0.5,
			)
			.to(
				edgeDates,
				{ autoAlpha: 1, duration: span * 0.3, ease: "power2.out" },
				span * 0.54,
			)
			// ⑤：入场落定后标题上移，第二层第一条祝福语逐字翻入
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

	/**
	 * `awake` 表示标题区在视口内，决定入场补间该不该跑；
	 * 祝福语的换页循环（cycleCall + flip）额外让开后台标签页，
	 * 但可见性不参与入场与显隐判断，否则页面被判定不可见时标题会停在不可读状态。
	 */
	const applyAwake = () => {
		const looping = awake && document.visibilityState === "visible";
		if (enter && enter.progress() < 1) enter.paused(!awake);
		if (flip && flip.progress() < 1) flip.paused(!looping);
		if (cycleCall && cycleCall.progress() < 1) cycleCall.paused(!looping);
	};

	const setAwake = (next: boolean) => {
		awake = next;
		applyAwake();
	};

	const syncVisibility = (isActive: boolean) => {
		if (signal.aborted) return;
		setAwake(isActive);
		if (awake) play();
	};

	reset();

	const trigger = ScrollTrigger.create({
		id: "home-blinds-headline",
		trigger: section,
		start: "top 66.666%",
		end: "bottom top",
		invalidateOnRefresh: true,
		onToggle: (self) => syncVisibility(self.isActive),
	});

	// onToggle 在 refresh 时不补发，所以缩放视口后要按当前滚动位置补一次
	const syncFromScroll = () => syncVisibility(trigger.isActive);
	ScrollTrigger.addEventListener("refresh", syncFromScroll);
	document.addEventListener("visibilitychange", syncFromScroll, { signal });
	syncFromScroll();

	// 视口变化后重新量标题宽度：未播则复位起点，播完则直接落到终态重新对齐
	const relayout = () => {
		if (signal.aborted) return;
		if (!played) {
			reset();
			return;
		}
		// 离屏或后台暂停的入场也尚未完成，不能因 fonts.ready 把它跳到终态。
		if (enter && enter.progress() < 1) return;
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
	// 断点重建会复用同一个 DOM，isConnected 不足以判断这次挂载是否还活着。
	void document.fonts.ready.then(() => {
		if (!signal.aborted && headline.isConnected) relayout();
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
			...edgeDates,
			...bands,
			...messages.flat(),
		]);
		gsap.set(messages.flat(), { clearProps: "willChange" });
		gsap.set(headline, { autoAlpha: 0 });
	};
}

/** 固定且隐藏的图片不能依赖原生 lazy 的几何判断，改为观察正常文档流中的整层。 */
function setupStageImages({
	root,
	signal,
	ScrollTrigger,
}: SetupContext): () => void {
	const images = root.querySelectorAll<HTMLImageElement>(
		"img[data-home-blinds-src]",
	);
	const observer = new IntersectionObserver(
		(entries) => {
			if (signal.aborted || !entries.some((entry) => entry.isIntersecting))
				return;
			observer.disconnect();
			let assigned = false;
			for (const image of images) {
				const source = image.dataset.homeBlindsSrc;
				if (!source) continue;
				image.src = source;
				delete image.dataset.homeBlindsSrc;
				assigned = true;
			}
			// 图片补进来后文档高度可能变化，攒到下一帧统一重量 pin 起止点。
			if (assigned) requestScrollTriggerRefresh(ScrollTrigger);
		},
		// 提前一屏启用，历史坐标直接落进舞台时也会立即收到相交回调。
		{ rootMargin: `${window.innerHeight}px 0px` },
	);
	observer.observe(root);
	return () => observer.disconnect();
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
		cleanups.push(setupStageImages(context));
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
export function teardownHomeBlinds(): void {
	bootGeneration += 1;
	activeCleanup?.();
	activeCleanup = null;
	activeRoot = null;
}

export async function bootHomeBlinds(): Promise<void> {
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

	// 断点重启或失败后再启用时，先恢复占位，ScrollTrigger 才能量到真实尺寸。
	delete nextRoot.dataset.homeBlindsReady;
	const generation = bootGeneration;
	try {
		// 只等 pin 建立，不等入场动画与无限循环播放，供导航恢复历史坐标使用。
		const cleanup = await initializeHomeBlinds(nextRoot, generation);
		if (!cleanup) return;
		if (
			generation !== bootGeneration ||
			activeRoot !== nextRoot ||
			!nextRoot.isConnected
		) {
			cleanup();
			return;
		}
		activeCleanup = cleanup;
	} catch {
		// 初始化已逆序回滚；CSS 折叠整层，不让故障留下空白滚动区。
		if (
			generation === bootGeneration &&
			activeRoot === nextRoot &&
			nextRoot.isConnected
		) {
			nextRoot.dataset.homeBlindsReady = "fallback";
		}
	}
}
