import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import type { HeroMosaicConfig } from "@/types/config";
import { initHomeHeroDialogue } from "@/utils/home-hero-dialogue";
import {
	createHeroPhotoFramePaths,
	getHeroPinEndDistance,
} from "@/utils/home-hero-motion";
import { initHomeHeroRain } from "@/utils/home-hero-rain";
import { requestScrollTriggerRefresh } from "@/utils/scroll-trigger-refresh";

gsap.registerPlugin(ScrollTrigger);

const RAIN_ACTIVATE_TIME = 1.14;
const COVER_FLIP_DURATION = 1.3;
const COVER_FLIP_STAGGER = 0.006;
const COVER_FLIP_EASE = "elastic.out(0.8, 0.4)";
const COVER_CLOSE_TIME = 0.4;
const COVER_CLOSE_DURATION = 0.2;
const COVER_CORNER_DURATION = 0.1;
const COVER_FLIP_FADE = 0.26;
/** 舞台缝线随翻面浮出的时长 */
const COVER_SEAM_FADE = 0.5;
const COVER_HOVER_DURATION = 1000;
const COVER_HOVER_KEYFRAMES: Keyframe[] = [
	{ offset: 0, transform: "rotateX(0deg)" },
	{ offset: 0.22, transform: "rotateX(-180deg)" },
	{ offset: 0.47, transform: "rotateX(-400deg)" },
	{ offset: 0.8, transform: "rotateX(-350deg)" },
	{ offset: 1, transform: "rotateX(-360deg)" },
];
const DIALOGUE_REVEAL_TIME = 1.23;
const DIALOGUE_REVEAL_DURATION = 0.11;
const DIALOGUE_REVEAL_END_TIME =
	DIALOGUE_REVEAL_TIME + DIALOGUE_REVEAL_DURATION;
/** 问候气泡在角色升起一小截后冒出，仍落在 pin 结束的驻留段之前，解锁前一定看得到 */
const GREETING_REVEAL_TIME = DIALOGUE_REVEAL_TIME + 0.03;
const INTERACTION_HOLD_START = 1.46;
/** 角色在照片左下角探出时的上浮距离（px） */
const DIALOGUE_REVEAL_LIFT = 56;
/** 角色从照片左下角滑到视口左下角的终点：驻留段开始前必须到位，才能交给 sticky */
const DIALOGUE_SLIDE_END = INTERACTION_HOLD_START;
/** 整图拼合完成（0.75 隐藏碎片）后，导引线与纯色底同时由中点铺开，铺满才开始放大整图 */
const GUIDE_REVEAL_TIME = 0.75;
const GUIDE_REVEAL_DURATION = 0.16;
/** 竖线比横线晚一拍铺开，像先拉横向参考线再拉竖向 */
const GUIDE_VERTICAL_DELAY = 0.03;
/** 导引线铺满后的照片落位段：整图上移居中并收成照片尺寸 */
const PHOTO_SETTLE_TIME = GUIDE_REVEAL_TIME + GUIDE_REVEAL_DURATION;
const PHOTO_SETTLE_DURATION = 0.2;
/** 照片态的平面倾斜角度（参考落地照片的摆法，不做 3D 透视） */
const PHOTO_ROTATION = -3;
/** 叠加图自己的倾角：与照片反向一点，叠出「随手摆上去」的感觉 */
const PHOTO_OVERLAY_ROTATION = 5;
/** 叠加图滑入的起点：从照片盒底部再往下探半张图高 */
const PHOTO_OVERLAY_SLIDE_IN = 0.55;
/** 倾斜比平移多走的时长：转动贯穿整段平移、落位后再收一点，避免 3D 角度一把到位 */
const PHOTO_ROTATION_TAIL = 0.25;
/** 照片态尺寸相对虚线列宽 / 横线画幅高的比例，先撞到的约束生效 */
const PHOTO_WIDTH_RATIO = 0.62;
const PHOTO_HEIGHT_RATIO = 0.96;
/** 照片描边：粗细与图片圆角（rem），与 .home-hero__photo-frame / mosaic-complete 对齐 */
const PHOTO_FRAME_THICKNESS_REM = 0.5;
const PHOTO_FRAME_RADIUS_REM = 0.75;
/** 介绍面板与照片同批落位后淡入 */
const INTRO_REVEAL_TIME = PHOTO_SETTLE_TIME + PHOTO_SETTLE_DURATION;
/** 玩偶角点对齐用的微调：照片逆时针倾斜后真实左下角偏右偏下，玩偶再往左下挪一点 */
const DIALOGUE_CORNER_SHIFT_X = -40;
const DIALOGUE_CORNER_SHIFT_Y = 36;
/** 与 .g-guide 的 stroke-dasharray 一致：一个划 14 + 一个空 12 */
const GUIDE_DASH_PERIOD = 26;
/** 竖线视差走的周期数：位移恒为整周期，交接处的虚线相位才不会错位 */
const GUIDE_DASH_CYCLES = 2;
const GUIDE_DASH_FLOW = GUIDE_DASH_PERIOD * GUIDE_DASH_CYCLES;
let initialReloadHandled = false;

/**
 * navigation.type 描述的是「当前 document 是怎么来的」，Swup 导航不会改它：
 * 在别的页面按了 F5，之后再跳进首页，这里读到的仍然是 "reload"。而本模块恰好是在
 * 「进首页」那次导航里才第一次执行，于是 hero 的首次挂载会误判成「刚刷新了首页」。
 * 用 navigation.name（document 首次加载的 URL）与当前路径比对即可排除这种情况。
 */
function isInitialDocumentPath(navigationName: string) {
	try {
		return (
			new URL(navigationName, location.href).pathname === location.pathname
		);
	} catch {
		return false;
	}
}

/**
 * 刷新首页要从第一帧重播入场编排，所以把滚动位置按回顶部。
 * 这一步必须由持有 ScrollTrigger 的本模块做：ScrollTrigger 初始化时会记住
 * 加载时的滚动位置并在首帧后回灌，只 scrollTo(0,0) 会被它盖回去。
 */
function resetHeroScrollOnReload() {
	if (initialReloadHandled) return false;
	initialReloadHandled = true;
	const navigation = performance.getEntriesByType("navigation")[0] as
		| PerformanceNavigationTiming
		| undefined;
	if (navigation?.type !== "reload") return false;
	if (!isInitialDocumentPath(navigation.name)) return false;

	history.scrollRestoration = "manual";
	ScrollTrigger.clearScrollMemory("manual");
	window.scrollTo(0, 0);
	return true;
}

type HeroRuntimeConfig = {
	mosaic: Omit<HeroMosaicConfig, "rows" | "columns" | "seed">;
	rain: {
		enabled?: boolean;
		intensity?: number;
		color?: string;
	};
};

type TileState = {
	element: HTMLElement;
	order: number;
	offsetX: number;
	offsetY: number;
	rotation: number;
	scale: number;
	blur: number;
};

type TileTransform = {
	x: number;
	y: number;
	rotation: number;
	scaleX: number;
	scaleY: number;
	blur: number;
};

function parseRuntimeConfig(hero: HTMLElement): HeroRuntimeConfig | null {
	try {
		return JSON.parse(hero.dataset.heroConfig ?? "") as HeroRuntimeConfig;
	} catch {
		return null;
	}
}

function readNumber(element: HTMLElement, key: string, fallback: number) {
	const value = Number.parseFloat(element.dataset[key] ?? "");
	return Number.isFinite(value) ? value : fallback;
}

function getTileStates(hero: HTMLElement): TileState[] {
	return Array.from(hero.querySelectorAll<HTMLElement>("[data-hero-tile]")).map(
		(element) => ({
			element,
			order: readNumber(element, "order", 0),
			offsetX: readNumber(element, "offsetX", 0),
			offsetY: readNumber(element, "offsetY", 0),
			rotation: readNumber(element, "rotation", 0),
			scale: readNumber(element, "scale", 1),
			blur: readNumber(element, "blur", 0),
		}),
	);
}

/** 固定布局会搬动 Hero，用文档时间轴接续首帧的 CSS 入场。 */
function keepCoverTextEntrance(cover: HTMLElement): () => void {
	const animations: Animation[] = [];
	for (const source of cover.getAnimations({ subtree: true })) {
		if (
			!(source instanceof CSSAnimation) ||
			source.animationName !== "home-hero-cover-text-in" ||
			!(source.effect instanceof KeyframeEffect)
		)
			continue;

		const animation = new Animation(
			new KeyframeEffect(source.effect),
			document.timeline,
		);
		animation.play();
		animation.startTime = source.startTime ?? document.timeline.currentTime;
		animations.push(animation);
	}
	cover.dataset.coverTextStarted = "";
	return () => {
		for (const animation of animations) animation.cancel();
		delete cover.dataset.coverTextStarted;
	};
}

export function mountHomeHero(): () => void {
	const hero = document.querySelector<HTMLElement>("[data-home-hero]");
	if (!hero || hero.dataset.heroMounted === "true") return () => undefined;

	const config = parseRuntimeConfig(hero);
	if (!config) return () => undefined;
	const resetAfterReload = resetHeroScrollOnReload();

	hero.dataset.heroMounted = "true";
	let disposed = false;
	// revert 既回收动画也恢复挂载前样式，断点切换会在同一批 DOM 上重新挂载。
	const animationContext = gsap.context(() => {}, hero);
	const abortController = new AbortController();
	// 角色气泡渲染在第二层之后（sticky 才能一路停到第二层底部），不在 hero 里
	const dialogueRoot = document.querySelector<HTMLElement>(
		"[data-hero-dialogue]",
	);
	const dialogueAnchor = dialogueRoot?.querySelector<HTMLElement>(
		"[data-dialogue-anchor]",
	);
	const dialogue = initHomeHeroDialogue(dialogueRoot);
	const rain = initHomeHeroRain(hero, config.rain);
	const reducedMotionQuery = window.matchMedia(
		"(prefers-reduced-motion: reduce)",
	);
	const mosaic = hero.querySelector<HTMLElement>("[data-hero-mosaic]");
	const mosaicTarget = hero.querySelector<HTMLElement>(
		"[data-hero-mosaic-target]",
	);
	const mosaicComplete = hero.querySelector<HTMLElement>(
		"[data-hero-mosaic-complete]",
	);
	const mosaicGrid = hero.querySelector<HTMLElement>("[data-hero-mosaic-grid]");
	const mosaicImage = mosaicComplete?.querySelector("img");
	const backdrop = hero.querySelector<HTMLElement>(".home-hero__backdrop");
	const guideRows = hero.querySelector<SVGSVGElement>(".home-guide__guide--h");
	const guideColumns = hero.querySelector<SVGSVGElement>(
		".home-guide__guide--v",
	);
	const guideColumnLines = Array.from(
		guideColumns?.querySelectorAll<SVGLineElement>("line") ?? [],
	);
	const introCards = Array.from(
		hero.querySelectorAll<HTMLElement>(".home-hero__intro-card"),
	);
	const photoOverlay = hero.querySelector<HTMLElement>(
		"[data-hero-photo-overlay]",
	);
	const photoAuthor = hero.querySelector<HTMLElement>(
		"[data-hero-photo-author]",
	);
	const photoFramePaths = Array.from(
		hero.querySelectorAll<SVGPathElement>("[data-hero-photo-frame] path"),
	);
	const cover = hero.querySelector<HTMLElement>("[data-hero-cover]");
	const stopCoverTextEntrance =
		cover && !reducedMotionQuery.matches ? keepCoverTextEntrance(cover) : null;
	// 第一形态的整块背景是纯色：舞台那层缝线先藏起来，翻面时再浮出来接第二形态。
	// 隐藏的是包在外面的容器，不是路径本身 —— 卡背 <use> 克隆的正是路径，
	// 直接改路径透明度会把卡背的图案一起弄没
	const puzzleSeams = hero.querySelector<SVGGElement>(
		".home-hero__puzzle-seams-stage",
	);
	const tiles = getTileStates(hero);
	let timeline: ReturnType<typeof gsap.timeline> | null = null;
	let scrollDriver: ReturnType<typeof gsap.to> | null = null;
	/** 翻面期间冻住拼合进度，翻完才解冻 */
	let coverFrozen = false;
	/** 由 setupCoverFlip 写入，滚动一有进度就由 ScrollTrigger 兜底触发 */
	let startCoverFlip: (() => void) | null = null;
	/** 封面自己的清理（悬停补间、冻结帧、翻面时间线） */
	let coverCleanup: (() => void) | null = null;
	const mosaicGeometry = {
		heroWidth: 0,
		heroHeight: 0,
		width: 1,
		height: 1,
		photoW: 1,
		photoH: 1,
		guideW: 1,
		x: 0,
		y: 0,
		scale: 1,
	};

	/**
	 * 雨的激活条件原本只有下界（时间线过了 RAIN_ACTIVATE_TIME 就一直为真），
	 * 于是滚过首屏之后 canvas 的 rAF 仍在每帧整屏清屏重绘，白白和下方的
	 * 影像层抢主线程。这里补一个视口闸门：hero 离开视口即停，回来再恢复。
	 */
	let heroInView = true;
	let rainWanted = false;
	const syncRain = () => {
		rain.setActive(rainWanted && heroInView && !reducedMotionQuery.matches);
	};
	const heroVisibility = new IntersectionObserver(
		(entries) => {
			for (const entry of entries) heroInView = entry.isIntersecting;
			syncRain();
		},
		// 留一点提前量，滚回首屏时雨已经在跑，不会看到空档
		{ rootMargin: "15% 0px" },
	);
	heroVisibility.observe(hero);

	const updateSceneState = (progress: number) => {
		if (disposed) return;
		const timelineTime = progress * (timeline?.duration() ?? 1);
		const rainActive = timelineTime >= RAIN_ACTIVATE_TIME;
		const dialogueVisible = timelineTime >= DIALOGUE_REVEAL_TIME;
		const greetingWanted = timelineTime >= GREETING_REVEAL_TIME;
		// 先摘掉问候再同步角色可见性：快速滚动时两个阈值会在同一帧一起跨过，
		// 若先把 scene 置 true，greeting 的 false→true 会被「角色不可见」挡掉，气泡就再也不冒了
		if (!greetingWanted) dialogue.setGreetingVisible(false);
		dialogue.setSceneVisible(dialogueVisible);
		if (greetingWanted) dialogue.setGreetingVisible(true);
		rainWanted = rainActive;
		syncRain();
	};

	// computed width / height 不受 transform 影响且保留小数；只在挂载和 refresh 时读布局。
	const measureMosaic = (): boolean => {
		if (!mosaic || !mosaicTarget) return false;
		const style = getComputedStyle(mosaic);
		const frameStyle = getComputedStyle(mosaicTarget);
		const heroWidth = hero.clientWidth;
		const heroHeight = hero.clientHeight;
		const width = Math.max(1, Number.parseFloat(style.width));
		const height = Math.max(1, Number.parseFloat(style.height));
		const bandHeight = Math.max(1, Number.parseFloat(frameStyle.height));
		const guideWidth = guideColumns
			? Number.parseFloat(getComputedStyle(guideColumns).width)
			: Number.NaN;
		// 按整组照片占用的高度缩放，叠图伸出的部分和倾角都必须留在画幅内。
		const stackBottom = Math.max(
			height,
			photoOverlay
				? photoOverlay.offsetTop + photoOverlay.offsetHeight
				: height,
		);
		const rotationPadding =
			width * Math.abs(Math.sin((PHOTO_ROTATION * Math.PI) / 180)) +
			(photoOverlay?.offsetWidth ?? 0) *
				Math.abs(Math.sin((PHOTO_OVERLAY_ROTATION * Math.PI) / 180));
		const guideW = Number.isFinite(guideWidth) ? guideWidth : heroWidth;
		const columnWidth = Number.isFinite(guideWidth)
			? guideWidth * PHOTO_WIDTH_RATIO
			: width;
		const scale = Math.min(
			1,
			columnWidth / width,
			(bandHeight * PHOTO_HEIGHT_RATIO) / (stackBottom + rotationPadding),
		);
		const photoW = width * scale;
		// 画框改为上下留白均分后，位置以布局偏移为准（transform 不参与），
		// 照片态的纵向落点仍按画框中心对齐舞台中心
		const center = mosaic.offsetTop + height / 2;
		const y = heroHeight / 2 - center - ((stackBottom - height) * scale) / 2;
		const x = (photoW - guideW) / 2;
		// 照片实际宽度回写成 CSS 变量，介绍面板靠它贴到照片右侧
		hero.style.setProperty("--home-hero-photo-w", `${Math.round(photoW)}px`);
		const hasChanged =
			heroWidth !== mosaicGeometry.heroWidth ||
			heroHeight !== mosaicGeometry.heroHeight ||
			width !== mosaicGeometry.width ||
			height !== mosaicGeometry.height ||
			x !== mosaicGeometry.x ||
			y !== mosaicGeometry.y ||
			scale !== mosaicGeometry.scale;
		Object.assign(mosaicGeometry, {
			heroWidth,
			heroHeight,
			width,
			height,
			photoW,
			photoH: height * scale,
			guideW,
			x,
			y,
			scale,
		});
		return hasChanged;
	};

	// 照片左下角相对「视口左下角静止位」的偏移：角色先在这里探出，
	// 再随滚动滑回 (0, 0)，之后由 sticky 带进第二层。
	// 照片左缘停在左虚线上，角点再按 SHIFT 往左下挪，贴住倾斜后的真实角落
	const getDialoguePhotoOffset = () => ({
		x:
			(mosaicGeometry.heroWidth - mosaicGeometry.guideW) / 2 +
			DIALOGUE_CORNER_SHIFT_X,
		y:
			-Math.max(0, (mosaicGeometry.heroHeight - mosaicGeometry.photoH) / 2) +
			DIALOGUE_CORNER_SHIFT_Y,
	});

	// 照片描边是 8 条从四角出发到边中点的笔画，d 按拼合框实测尺寸生成；
	// 减弱动效路径不会调用这里，SVG 保持无 d、不渲染
	const updatePhotoFrame = () => {
		if (!mosaic || photoFramePaths.length === 0) return;
		const rem =
			Number.parseFloat(getComputedStyle(document.documentElement).fontSize) ||
			16;
		const paths = createHeroPhotoFramePaths(
			mosaic.offsetWidth,
			mosaic.offsetHeight,
			PHOTO_FRAME_THICKNESS_REM * rem,
			PHOTO_FRAME_RADIUS_REM * rem,
		);
		photoFramePaths.forEach((path, index) => {
			path.setAttribute("d", paths[index] ?? "");
		});
	};

	const getTileEntranceTransform = (tile: TileState): TileTransform => {
		const horizontalRange = Math.max(
			mosaicGeometry.heroWidth * 0.29,
			mosaicGeometry.width * 0.48,
		);
		const verticalRange = Math.max(
			mosaicGeometry.heroHeight * 0.24,
			mosaicGeometry.height * 0.78,
		);
		const normalizedX = tile.offsetX / 75;
		const normalizedY = tile.offsetY / 57.5;
		const distance = Math.hypot(normalizedX, normalizedY);
		const minimumTravel = 0.52;
		const travelMultiplier =
			distance > 0 && distance < minimumTravel ? minimumTravel / distance : 1;
		const scale =
			0.66 + Math.min(0.16, Math.max(0, (tile.scale - 0.72) * 0.48));

		return {
			x: normalizedX * travelMultiplier * horizontalRange,
			y: normalizedY * travelMultiplier * verticalRange,
			rotation: tile.rotation * 0.12,
			scaleX: scale,
			scaleY: scale,
			blur: 13 + (tile.blur / 5) * 10,
		};
	};

	const getBaseScrollDistance = () =>
		getHeroPinEndDistance(
			config.mosaic.desktopScrollDistance,
			window.innerHeight,
			config.mosaic.desktopMinViewports,
		);

	const getDialogueEndProgress = () => {
		const duration = Math.max(0.001, timeline?.duration() ?? 1);
		return Math.min(1, DIALOGUE_REVEAL_END_TIME / duration);
	};

	const getDialogueTailDistance = () => {
		if (getDialogueEndProgress() >= 1) return 0;
		return Math.max(0, config.mosaic.desktopDialogueTailDistance);
	};

	const getCompressedScrollDistance = () =>
		getBaseScrollDistance() * getDialogueEndProgress() +
		getDialogueTailDistance();

	const mapScrollProgressToTimelineProgress = (scrollProgress: number) => {
		const progress = Math.min(1, Math.max(0, scrollProgress));
		const baseDistance = getBaseScrollDistance();
		const dialogueEndProgress = getDialogueEndProgress();
		const preservedDistance = baseDistance * dialogueEndProgress;
		const tailDistance = getDialogueTailDistance();
		const scrollDistance = progress * (preservedDistance + tailDistance);

		if (scrollDistance <= preservedDistance) {
			return Math.min(
				dialogueEndProgress,
				scrollDistance / Math.max(1, baseDistance),
			);
		}
		if (tailDistance <= 0) return 1;

		return Math.min(
			1,
			dialogueEndProgress +
				((scrollDistance - preservedDistance) / tailDistance) *
					(1 - dialogueEndProgress),
		);
	};

	const renderTimelineForScroll = (scrollProgress: number) => {
		// 翻面期间把拼合进度钉在 0：不管滚动是滚轮、滚动条还是脚本触发的，
		// 都不会和翻面同时推进，翻完再由 startCoverFlip 把滚动位置拉回起点。
		if (coverFrozen) {
			timeline?.totalProgress(0);
			updateSceneState(0);
			return;
		}
		const progress = mapScrollProgressToTimelineProgress(scrollProgress);
		timeline?.totalProgress(progress);
		updateSceneState(progress);
	};

	const refreshMosaicGeometry = () => {
		if (!timeline || !measureMosaic()) return;
		updatePhotoFrame();
		const progress = timeline.totalProgress();
		timeline.totalProgress(0, true);
		timeline.invalidate();
		timeline.totalProgress(progress, true);
	};

	const buildTimeline = () => {
		if (!mosaic || !mosaicComplete || !mosaicGrid || tiles.length === 0) return;

		measureMosaic();
		updatePhotoFrame();
		gsap.set(mosaic, {
			x: 0,
			y: 0,
			scale: 1,
			rotation: 0,
		});
		gsap.set(mosaicComplete, { autoAlpha: 0 });
		// 先记录 CSS 的 display，卸载时才能清掉延迟 fromTo 留下的内联起点。
		gsap.set(mosaicGrid, { display: "block" });
		if (dialogueAnchor) {
			const corner = getDialoguePhotoOffset();
			gsap.set(dialogueAnchor, {
				autoAlpha: 0,
				x: corner.x,
				y: corner.y,
				yPercent: 0,
			});
		}
		timeline = gsap.timeline({
			defaults: { ease: "none" },
			paused: true,
		});

		timeline.to({}, { duration: 1 });
		// 首屏不再摆散片，入场从时间线开头就起步，翻完面一滚就能看到碎片聚拢
		for (const tile of tiles) {
			const start = 0.02 + tile.order * 0.02;
			timeline.fromTo(
				tile.element,
				{
					x: () => getTileEntranceTransform(tile).x,
					y: () => getTileEntranceTransform(tile).y,
					rotation: () => getTileEntranceTransform(tile).rotation,
					scaleX: () => getTileEntranceTransform(tile).scaleX,
					scaleY: () => getTileEntranceTransform(tile).scaleY,
					filter: () => `blur(${getTileEntranceTransform(tile).blur}px)`,
					autoAlpha: 0,
				},
				{
					x: 0,
					y: 0,
					rotation: 0,
					scaleX: 1,
					scaleY: 1,
					filter: "blur(0px)",
					autoAlpha: 1,
					duration: 0.09,
					ease: "power3.inOut",
					immediateRender: false,
				},
				start,
			);
		}

		timeline.fromTo(
			mosaicComplete,
			{ autoAlpha: 0 },
			{ autoAlpha: 1, duration: 0.03, ease: "none" },
			0.72,
		);
		// 整图与碎片完全对齐后隐藏碎片 DOM，避免 24 个合成层随整图缩放继续绘制。
		timeline.fromTo(
			mosaicGrid,
			{ display: "block" },
			{ display: "none", duration: 0, immediateRender: false },
			0.75,
		);

		if (dialogueAnchor) {
			// 角色先在照片左下角探出，再随滚动滑到视口左下角，
			// 之后由 sticky 带着一路停到第二层左下角
			timeline.fromTo(
				dialogueAnchor,
				{
					autoAlpha: 0,
					x: () => getDialoguePhotoOffset().x,
					y: () => getDialoguePhotoOffset().y + DIALOGUE_REVEAL_LIFT,
				},
				{
					autoAlpha: 1,
					x: () => getDialoguePhotoOffset().x,
					y: () => getDialoguePhotoOffset().y,
					duration: DIALOGUE_REVEAL_DURATION,
					ease: "power3.out",
				},
				DIALOGUE_REVEAL_TIME,
			);
			timeline.fromTo(
				dialogueAnchor,
				{
					x: () => getDialoguePhotoOffset().x,
					y: () => getDialoguePhotoOffset().y,
				},
				{
					x: 0,
					y: 0,
					duration: Math.max(
						0.001,
						DIALOGUE_SLIDE_END - DIALOGUE_REVEAL_END_TIME,
					),
					ease: "power1.inOut",
				},
				DIALOGUE_REVEAL_END_TIME,
			);
		}

		// 导引线铺满后整图不再铺满画幅：上移居中并左移到左虚线处、收成照片尺寸；
		// 立体阴影由 CSS 落在整图上，右腾出的列给介绍面板
		timeline.fromTo(
			mosaic,
			{ x: 0, y: 0, scale: 1 },
			{
				x: () => mosaicGeometry.x,
				y: () => mosaicGeometry.y,
				scale: () => mosaicGeometry.scale,
				duration: PHOTO_SETTLE_DURATION,
				ease: "power3.inOut",
			},
			PHOTO_SETTLE_TIME,
		);
		// 倾斜与平移同帧起步、但走得更长：平移全程都在转，落位后再收一段才停，
		// 角度不会在平移起点一把到位
		timeline.fromTo(
			mosaic,
			{ rotation: 0 },
			{
				rotation: PHOTO_ROTATION,
				duration: PHOTO_SETTLE_DURATION + PHOTO_ROTATION_TAIL,
				ease: "power1.inOut",
			},
			PHOTO_SETTLE_TIME,
		);
		if (photoFramePaths.length) {
			// 拼合一完成（碎片隐藏、导引线同段铺开时）边框就从四角沿四边向中点蔓延，
			// 不等照片落位；描边在拼合框内，之后跟着照片一起左移倾斜。
			// 1000 与 pathLength 对齐：px 补间会被取整，用 1 会退化成 1/0 跳变
			timeline.fromTo(
				photoFramePaths,
				{ strokeDashoffset: 1000 },
				{
					strokeDashoffset: 0,
					duration: GUIDE_REVEAL_DURATION,
					ease: "power2.inOut",
				},
				GUIDE_REVEAL_TIME,
			);
		}
		if (introCards.length) {
			// 三张介绍卡初始绕右下角竖立，照片落位后顶部往左倒下归位、错峰分层
			timeline.fromTo(
				introCards,
				{ autoAlpha: 0, rotate: 90 },
				{
					autoAlpha: 1,
					rotate: 0,
					duration: 0.16,
					ease: "power2.out",
					stagger: 0.05,
				},
				INTRO_REVEAL_TIME,
			);
		}
		if (photoAuthor) {
			// 主图作者标牌随介绍卡同拍淡入，此时照片已缩到落位比例
			timeline.fromTo(
				photoAuthor,
				{ autoAlpha: 0 },
				{ autoAlpha: 1, duration: 0.1, ease: "power1.out" },
				INTRO_REVEAL_TIME,
			);
		}
		if (photoOverlay) {
			// 叠加图与介绍卡同拍：从照片下缘外滑入、带自己的倾角叠上去。
			// 它在拼合框内，会跟着照片一起缩放平移，像随手压在上面的第二张
			timeline.fromTo(
				photoOverlay,
				{
					autoAlpha: 0,
					y: () => mosaicGeometry.height * PHOTO_OVERLAY_SLIDE_IN,
					rotation: 0,
				},
				{
					autoAlpha: 1,
					y: 0,
					rotation: PHOTO_OVERLAY_ROTATION,
					duration: 0.16,
					ease: "power3.out",
				},
				INTRO_REVEAL_TIME,
			);
		}
		if (backdrop && guideRows && guideColumns) {
			// 纯色底淡入遮掉缝线，与导引线由中点铺开同一段进行
			timeline.fromTo(
				backdrop,
				{ opacity: 0 },
				{
					opacity: 1,
					duration: GUIDE_REVEAL_DURATION,
					ease: "power2.inOut",
				},
				GUIDE_REVEAL_TIME,
			);
			timeline.fromTo(
				guideRows,
				{ clipPath: "inset(-5px 50% -5px 50%)" },
				{
					clipPath: "inset(-5px 0% -5px 0%)",
					duration: GUIDE_REVEAL_DURATION,
					ease: "power2.inOut",
				},
				GUIDE_REVEAL_TIME,
			);
			timeline.fromTo(
				guideColumns,
				{ clipPath: "inset(50% -5px 50% -5px)" },
				{
					clipPath: "inset(0% -5px 0% -5px)",
					duration: GUIDE_REVEAL_DURATION,
					ease: "power2.inOut",
				},
				GUIDE_REVEAL_TIME + GUIDE_VERTICAL_DELAY,
			);
			// 竖线视差：只让虚线整体往下流，线两端不动、且只走整数个周期，
			// 既保住与第二层竖线在交接处的相位，也不会看着像线被拉断
			timeline.fromTo(
				guideColumnLines,
				{ strokeDashoffset: 13 },
				{
					strokeDashoffset: 13 + GUIDE_DASH_FLOW,
					duration: GUIDE_REVEAL_DURATION + PHOTO_SETTLE_DURATION,
					ease: "power2.inOut",
				},
				GUIDE_REVEAL_TIME,
			);
		}

		timeline.to(
			{},
			{ duration: Math.max(0, config.mosaic.interactionHold) },
			INTERACTION_HOLD_START,
		);

		const scrollState = { progress: 0 };
		scrollDriver = gsap.to(scrollState, {
			progress: 1,
			duration: 1,
			ease: "none",
			paused: true,
			onUpdate: () => renderTimelineForScroll(scrollState.progress),
		});

		const heroScrollTrigger = ScrollTrigger.create({
			id: "home-hero-two-layer",
			trigger: hero,
			start: "top top",
			end: () => `+=${getCompressedScrollDistance()}`,
			pin: hero,
			pinSpacing: true,
			scrub: config.mosaic.scrub,
			anticipatePin: 1,
			animation: scrollDriver,
			invalidateOnRefresh: true,
			onRefresh: (self) => {
				// refreshInit 时 pin 可能还锁着旧宽度，必须等 pin 恢复新布局后再测量。
				animationContext.add(refreshMosaicGeometry);
				self.update();
				renderTimelineForScroll(scrollDriver?.progress() ?? self.progress);
			},
			onUpdate: (self) => {
				// 兜底：滚动进度只要起步就先播翻面，不依赖滚轮拦截是否生效
				if (self.progress > 0.0005) startCoverFlip?.();
				if (!scrollDriver) renderTimelineForScroll(self.progress);
			},
		});

		renderTimelineForScroll(heroScrollTrigger.progress);
		// 影像层要等 await import("gsap") 之后才建 pin，比这里晚若干微任务。
		// 立刻 refresh 会按「还没有影像层 .pin-spacer」的文档高度算 pin 起止点，
		// 攒到下一帧统一 refresh，那时各层的 pin 都已插好。
		requestScrollTriggerRefresh(ScrollTrigger);
	};

	/**
	 * 封面翻面：停在顶端时往下滑 = 整面卡翻成背景；往上滑 = 翻回第一形态。
	 *
	 * 两个方向都是一次性播完的动画：播放期间滚轮 / 触控 / 翻页键全部吃掉，
	 * 并且持续把滚动按回顶端，pin 的 scrub 时间线不会和翻面同时推进。
	 * 各卡以随机顺序起转，整组同时向视点靠近并收拢卡缝。
	 */
	const setupCoverFlip = () => {
		if (!cover) return;
		const cards = Array.from(
			cover.querySelectorAll<HTMLElement>("[data-hero-cover-card]"),
		);
		if (cards.length === 0) return;

		// 监听统一挂在挂载级的 abortController 上：卸载时一次性解绑。
		// 不能用 animationContext.add(() => gate.abort()) —— context.add 会立即执行，
		// 那样挂载瞬间就把自己刚绑的监听全删了。
		const signal = abortController.signal;
		let form: "cover" | "stage" = "cover";
		let isAnimating = false;
		let touchStartY = 0;

		const hoverAnimations = new Map<HTMLElement, Animation>();
		const spinCard = (card: HTMLElement) => {
			if (form !== "cover" || isAnimating || hoverAnimations.has(card)) return;
			const animation = card.animate(
				COVER_HOVER_KEYFRAMES,
				COVER_HOVER_DURATION,
			);
			hoverAnimations.set(card, animation);
			animation.onfinish = () => hoverAnimations.delete(card);
		};

		const stopHover = () => {
			for (const animation of hoverAnimations.values()) animation.cancel();
			hoverAnimations.clear();
		};

		let freezeFrame = 0;
		const freezeScroll = () => {
			freezeFrame = 0;
			if (!isAnimating) return;
			if (window.scrollY !== 0) window.scrollTo(0, 0);
			freezeFrame = requestAnimationFrame(freezeScroll);
		};

		const lock = () => {
			isAnimating = true;
			coverFrozen = true;
			stopHover();
			window.scrollTo(0, 0);
			scrollDriver?.progress(0);
			// 只靠 preventDefault 不够稳：不可取消的滚轮、键盘、拖滚动条都能绕过，
			// 所以动画期间每帧再把位置按回 0，pin 期间视觉本来就停在原处
			if (!freezeFrame) freezeFrame = requestAnimationFrame(freezeScroll);
		};

		const unlock = () => {
			isAnimating = false;
			coverFrozen = false;
		};

		if (puzzleSeams) gsap.set(puzzleSeams, { opacity: 0 });

		// 两个方向都让卡片越过落点再回弹。返回时先显露铺平的背面再翻开。
		const createCoverTurn = (toStage: boolean) => {
			const turnAt = toStage ? 0 : COVER_FLIP_FADE;
			const spacing = toStage ? 0 : 1;
			const flip = gsap.timeline({
				paused: true,
				onComplete: () => {
					form = toStage ? "stage" : "cover";
					unlock();
				},
			});
			flip.to(
				cards,
				{
					rotateX: toStage ? -180 : 0,
					duration: COVER_FLIP_DURATION,
					ease: COVER_FLIP_EASE,
					stagger: { each: COVER_FLIP_STAGGER, from: "random" },
				},
				turnAt,
			);
			flip.to(
				cover,
				{
					"--cover-spacing": spacing,
					duration: COVER_CLOSE_DURATION,
					ease: "power3.inOut",
				},
				toStage ? COVER_CLOSE_TIME : turnAt,
			);
			flip.to(
				cover,
				{ "--cover-corners": spacing, duration: COVER_CORNER_DURATION },
				toStage ? COVER_CLOSE_TIME + COVER_CLOSE_DURATION : turnAt,
			);
			flip.to(
				cover,
				{
					autoAlpha: toStage ? 0 : 1,
					duration: COVER_FLIP_FADE,
					ease: "power1.out",
				},
				toStage ? flip.duration() : 0,
			);
			if (puzzleSeams) {
				flip.to(
					puzzleSeams,
					{
						opacity: toStage ? 1 : 0,
						duration: COVER_SEAM_FADE,
						ease: "power1.out",
					},
					toStage ? 0 : flip.duration() - COVER_SEAM_FADE,
				);
			}
			return flip;
		};
		const forward = createCoverTurn(true);
		const back = createCoverTurn(false);
		const skipToStage = () => {
			stopHover();
			forward.pause(0, true).progress(1, true);
			form = "stage";
		};

		// 恢复到页面中段时直接落在翻面后的状态，回到顶部仍可翻回封面。
		if (window.scrollY > window.innerHeight * 0.5) skipToStage();

		const playForward = () => {
			if (form !== "cover" || isAnimating) return;
			if (window.scrollY > window.innerHeight * 0.5) {
				skipToStage();
				return;
			}
			lock();
			forward.restart();
		};

		const playBack = () => {
			if (form !== "stage" || isAnimating) return;
			lock();
			back.restart();
		};
		startCoverFlip = playForward;

		for (const card of cards) {
			card.parentElement?.addEventListener(
				"pointerenter",
				(event) => {
					if (event.pointerType !== "touch") spinCard(card);
				},
				{ signal },
			);
		}

		const handleWheel = (event: WheelEvent) => {
			if (isAnimating) {
				event.preventDefault();
				return;
			}
			if (window.scrollY > 1) return;
			if (event.deltaY > 0) {
				if (form !== "cover") return;
				event.preventDefault();
				playForward();
				return;
			}
			if (event.deltaY < 0 && form === "stage") {
				event.preventDefault();
				playBack();
			}
		};

		const handleTouchStart = (event: TouchEvent) => {
			touchStartY = event.touches[0]?.clientY ?? 0;
		};

		const handleTouchMove = (event: TouchEvent) => {
			if (isAnimating) {
				event.preventDefault();
				return;
			}
			if (window.scrollY > 1) return;
			const currentY = event.touches[0]?.clientY ?? touchStartY;
			const delta = currentY - touchStartY;
			if (delta < 0 && form === "cover") {
				event.preventDefault();
				playForward();
				return;
			}
			if (delta > 0 && form === "stage") {
				event.preventDefault();
				playBack();
			}
		};

		const forwardKeys = [" ", "PageDown", "ArrowDown", "End"];
		const backKeys = ["PageUp", "ArrowUp", "Home"];
		const handleKeydown = (event: KeyboardEvent) => {
			const wantsForward = forwardKeys.includes(event.key);
			const wantsBack = backKeys.includes(event.key);
			if (!wantsForward && !wantsBack) return;
			// 焦点在按钮/链接/输入框上时，这些键归控件
			const target = event.target;
			if (
				target instanceof Element &&
				target.closest(
					"button, a, input, textarea, select, [contenteditable='true']",
				)
			) {
				return;
			}
			if (isAnimating) {
				event.preventDefault();
				return;
			}
			if (window.scrollY > 1) return;
			if (wantsForward && form === "cover") {
				event.preventDefault();
				playForward();
				return;
			}
			if (wantsBack && form === "stage") {
				event.preventDefault();
				playBack();
			}
		};

		window.addEventListener("wheel", handleWheel, { passive: false, signal });
		window.addEventListener("touchstart", handleTouchStart, {
			passive: true,
			signal,
		});
		window.addEventListener("touchmove", handleTouchMove, {
			passive: false,
			signal,
		});
		window.addEventListener("keydown", handleKeydown, { signal });

		// 动画期间不管滚动从哪来（拖滚动条、脚本、锚点）都按回顶端；
		// 静止时封面形态一离开顶端就补一次翻面，真跑到中段则直接收掉这层
		const handleScroll = () => {
			if (isAnimating) {
				if (window.scrollY !== 0) window.scrollTo(0, 0);
				return;
			}
			if (window.scrollY > 0) playForward();
		};
		window.addEventListener("scroll", handleScroll, { passive: true, signal });

		// 交给挂载入口在卸载时调用（不能走 animationContext.add —— 它会立即执行）
		coverCleanup = () => {
			if (freezeFrame) cancelAnimationFrame(freezeFrame);
			stopHover();
		};
	};

	animationContext.add(() => {
		if (reducedMotionQuery.matches) {
			dialogue.setSceneVisible(true);
			dialogue.setGreetingVisible(true);
		} else {
			buildTimeline();
			// 慢速图片先建立 pin，图片撑出自然高度后再统一刷新几何。
			for (const image of [mosaicImage, photoOverlay?.querySelector("img")]) {
				if (!image || image.complete) continue;
				image.addEventListener(
					"load",
					() => requestScrollTriggerRefresh(ScrollTrigger),
					{ once: true, signal: abortController.signal },
				);
			}
			// 翻面是独立的一次性动画，不挂在 scrub 时间线上，放在 pin 建好之后
			setupCoverFlip();
		}
	});

	// 复位要等 pin 与时间线都建好之后的那一帧，且必须可被卸载取消：
	// 快速离开首页时这一帧若还跑着，会在新页面上 scrollTo(0,0) 并改全局恢复模式。
	let reloadResetFrame = 0;
	if (resetAfterReload) {
		reloadResetFrame = requestAnimationFrame(() => {
			reloadResetFrame = 0;
			if (disposed) return;
			window.scrollTo(0, 0);
			timeline?.progress(0);
			scrollDriver?.progress(0);
			updateSceneState(0);
			requestScrollTriggerRefresh(ScrollTrigger);
			history.scrollRestoration = "auto";
		});
	}

	return () => {
		if (disposed) return;
		disposed = true;
		if (reloadResetFrame) cancelAnimationFrame(reloadResetFrame);
		heroVisibility.disconnect();
		rain.destroy();
		dialogue.destroy();
		coverCleanup?.();
		coverCleanup = null;
		stopCoverTextEntrance?.();
		abortController.abort();
		animationContext.revert();
		scrollDriver = null;
		timeline = null;
		delete hero.dataset.heroMounted;
	};
}
