import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import type { HeroMosaicConfig } from "@/types/config";
import { initHomeHeroDialogue } from "@/utils/home-hero-dialogue";
import { createFlyText, type FlyTextHandle } from "@/utils/home-hero-fly-text";
import { getHeroPinEndDistance } from "@/utils/home-hero-motion";
import { initHomeHeroRain } from "@/utils/home-hero-rain";
import { initHomeHeroSticker } from "@/utils/home-hero-sticker";
import { navigateToPage } from "@/utils/navigation-utils";

gsap.registerPlugin(ScrollTrigger);

const RAIN_ACTIVATE_TIME = 0.99;
const DIALOGUE_REVEAL_TIME = 1.08;
const DIALOGUE_REVEAL_DURATION = 0.11;
const DIALOGUE_REVEAL_END_TIME =
	DIALOGUE_REVEAL_TIME + DIALOGUE_REVEAL_DURATION;
const QUICK_ACTIONS_REVEAL_TIME = 1.14;
const INTERACTION_HOLD_START = 1.31;
let initialReloadHandled = false;

function resetHeroScrollOnReload() {
	if (initialReloadHandled) return false;
	initialReloadHandled = true;
	const navigation = performance.getEntriesByType("navigation")[0] as
		| PerformanceNavigationTiming
		| undefined;
	if (navigation?.type !== "reload") return false;

	history.scrollRestoration = "manual";
	ScrollTrigger.clearScrollMemory("manual");
	window.scrollTo(0, 0);
	return true;
}

type HeroRuntimeConfig = {
	mosaic: HeroMosaicConfig;
	rain: {
		enabled?: boolean;
		intensity?: number;
		color?: string;
	};
};

type TileState = {
	element: HTMLElement;
	row: number;
	column: number;
	order: number;
	offsetX: number;
	offsetY: number;
	rotation: number;
	scale: number;
	blur: number;
	initiallyVisible: boolean;
};

type TileTransform = {
	x: number;
	y: number;
	rotation: number;
	scaleX: number;
	scaleY: number;
	blur: number;
};

type TileEntranceTransform = TileTransform;
type TileIdleTransform = TileTransform;

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
			row: readNumber(element, "row", 0),
			column: readNumber(element, "column", 0),
			order: readNumber(element, "order", 0),
			offsetX: readNumber(element, "offsetX", 0),
			offsetY: readNumber(element, "offsetY", 0),
			rotation: readNumber(element, "rotation", 0),
			scale: readNumber(element, "scale", 1),
			blur: readNumber(element, "blur", 0),
			initiallyVisible: element.dataset.idleVisible === "true",
		}),
	);
}

function createSeededRandom(seed: number) {
	let value = seed >>> 0;
	return () => {
		value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
		return value / 4294967296;
	};
}

function bindQuickActions(hero: HTMLElement, abortController: AbortController) {
	hero.addEventListener(
		"click",
		(event) => {
			const target = (event.target as Element).closest<HTMLElement>(
				"[data-hero-action]",
			);
			if (!target) return;
			const href = target.dataset.heroActionHref;
			if (!href) return;
			event.preventDefault();
			navigateToPage(href);
		},
		{ signal: abortController.signal },
	);
}

function setReducedMotionState(
	hero: HTMLElement,
	dialogue: ReturnType<typeof initHomeHeroDialogue>,
) {
	hero.dataset.reducedMotion = "true";
	hero.dataset.layerActive = "true";
	hero.querySelectorAll<HTMLElement>("[data-hero-action]").forEach((action) => {
		action.tabIndex = 0;
		action.setAttribute("aria-hidden", "false");
	});
	dialogue.setSceneVisible(true);
	document
		.querySelector(".home-page--motion-pending")
		?.classList.remove("home-page--motion-pending");
}

export function mountHomeHero() {
	const hero = document.querySelector<HTMLElement>("[data-home-hero]");
	if (!hero || hero.dataset.heroMounted === "true") return () => undefined;

	// 移动端首页由 HomeMobile 渲染，桌面 Hero 隐藏时跳过挂载（马赛克/雨/对话框等）
	if (
		document.getElementById("home-mobile") &&
		window.matchMedia("(max-width: 768px)").matches
	) {
		document
			.querySelector(".home-page--motion-pending")
			?.classList.remove("home-page--motion-pending");
		return () => undefined;
	}

	const config = parseRuntimeConfig(hero);
	if (!config) return () => undefined;
	const resetAfterReload = resetHeroScrollOnReload();

	hero.dataset.heroMounted = "true";
	const abortController = new AbortController();
	const dialogue = initHomeHeroDialogue(hero);
	const destroySticker = initHomeHeroSticker(hero);
	const rain = initHomeHeroRain(hero, config.rain);
	const reducedMotionQuery = window.matchMedia(
		"(prefers-reduced-motion: reduce)",
	);
	const mobileQuery = window.matchMedia("(max-width: 768px)");
	const title = hero.querySelector<HTMLElement>("[data-hero-title]");
	const contact = hero.querySelector<HTMLElement>("[data-hero-contact]");
	const mosaic = hero.querySelector<HTMLElement>("[data-hero-mosaic]");
	const mosaicComplete = hero.querySelector<HTMLElement>(
		"[data-hero-mosaic-complete]",
	);
	const backdrop = hero.querySelector<HTMLElement>("[data-hero-backdrop]");
	const dialogueRoot = hero.querySelector<HTMLElement>("[data-hero-dialogue]");
	const quickActions = Array.from(
		hero.querySelectorAll<HTMLElement>("[data-hero-action]"),
	);
	const tiles = getTileStates(hero);
	let timeline: ReturnType<typeof gsap.timeline> | null = null;
	let heroScrollTrigger: ReturnType<typeof ScrollTrigger.create> | null = null;
	let scrollDriver: ReturnType<typeof gsap.to> | null = null;
	let idleTimer = 0;
	let idleTween: ReturnType<typeof gsap.timeline> | null = null;
	let tilesIntroTimeline: ReturnType<typeof gsap.timeline> | null = null;
	let textIntroTimeline: ReturnType<typeof gsap.timeline> | null = null;
	let tilesIntroDone = false;
	let flyHandles: FlyTextHandle[] = [];
	let contactScatterTimeline: ReturnType<typeof gsap.timeline> | null = null;
	let flyLayoutTimer = 0;
	let activeTiles = new Set(
		tiles.filter((tile) => tile.initiallyVisible).map((tile) => tile.element),
	);
	const random = createSeededRandom(config.mosaic.seed ^ 0x9e3779b9);

	bindQuickActions(hero, abortController);

	const stopIdleRotation = () => {
		window.clearInterval(idleTimer);
		idleTimer = 0;
		idleTween?.kill();
		idleTween = null;
	};

	const startIdleRotation = () => {
		if (idleTimer || reducedMotionQuery.matches) return;
		idleTimer = window.setInterval(() => {
			const visible = tiles.filter((tile) => activeTiles.has(tile.element));
			const hidden = tiles.filter((tile) => !activeTiles.has(tile.element));
			if (visible.length === 0 || hidden.length === 0) return;
			const leaving = visible[Math.floor(random() * visible.length)];
			const entering = hidden[Math.floor(random() * hidden.length)];
			const enteringTransform = getTileIdleTransform(entering);
			activeTiles.delete(leaving.element);
			activeTiles.add(entering.element);
			idleTween?.kill();
			idleTween = gsap.timeline();
			idleTween.to(
				leaving.element,
				{
					autoAlpha: 0,
					duration: 0.38,
					ease: "power2.inOut",
				},
				0,
			);
			idleTween.fromTo(
				entering.element,
				{
					x: enteringTransform.x,
					y: enteringTransform.y,
					rotation: enteringTransform.rotation,
					scaleX: enteringTransform.scaleX * 0.88,
					scaleY: enteringTransform.scaleY * 0.88,
					filter: `blur(${enteringTransform.blur}px)`,
					autoAlpha: 0,
				},
				{
					autoAlpha: 1,
					scaleX: enteringTransform.scaleX,
					scaleY: enteringTransform.scaleY,
					duration: 0.48,
					ease: "power3.out",
				},
				0.12,
			);
		}, config.mosaic.idleInterval);
	};

	const resetIdleTiles = () => {
		activeTiles = new Set(
			tiles.filter((tile) => tile.initiallyVisible).map((tile) => tile.element),
		);
		tiles.forEach((tile) => {
			const transform = tile.initiallyVisible
				? getTileInitialTransform(tile)
				: getTileEntranceTransform(tile);
			gsap.set(tile.element, {
				x: transform.x,
				y: transform.y,
				rotation: transform.rotation,
				scaleX: transform.scaleX,
				scaleY: transform.scaleY,
				filter: `blur(${transform.blur}px)`,
				autoAlpha: tile.initiallyVisible ? 1 : 0,
			});
		});
	};

	// 用户开始滚动时立即完成进行中的入场动画，交由 scrub 时间线接管
	const completePendingIntros = () => {
		if (tilesIntroTimeline) {
			tilesIntroTimeline.progress(1);
			tilesIntroTimeline = null;
		}
		if (textIntroTimeline) {
			textIntroTimeline.progress(1);
			textIntroTimeline.kill();
			textIntroTimeline = null;
		}
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
		const timelineTime = progress * (timeline?.duration() ?? 1);
		const rainActive = timelineTime >= RAIN_ACTIVATE_TIME;
		const dialogueVisible = timelineTime >= DIALOGUE_REVEAL_TIME;
		const layerActive = timelineTime >= QUICK_ACTIONS_REVEAL_TIME;
		dialogue.setSceneVisible(dialogueVisible);
		hero.dataset.layerActive = String(layerActive);
		quickActions.forEach((action) => {
			action.tabIndex = layerActive ? 0 : -1;
			action.setAttribute("aria-hidden", String(!layerActive));
		});
		rainWanted = rainActive;
		syncRain();
		if (progress > 0.002) {
			stopIdleRotation();
			completePendingIntros();
		} else if (!idleTimer && tilesIntroDone) {
			resetIdleTiles();
			startIdleRotation();
		}
	};

	const getMosaicTransform = () => {
		if (!mosaic) return { y: 0, scale: 1 };
		const heroWidth = hero.clientWidth;
		const heroHeight = hero.clientHeight;
		const mosaicWidth = mosaic.offsetWidth;
		const mosaicHeight = mosaic.offsetHeight;
		const mosaicCenterY = mosaic.offsetTop + mosaicHeight / 2;
		return {
			y: heroHeight / 2 - mosaicCenterY,
			scale:
				Math.max(
					heroWidth / Math.max(1, mosaicWidth),
					heroHeight / Math.max(1, mosaicHeight),
				) * 1.015,
		};
	};

	const getTileEntranceTransform = (tile: TileState): TileEntranceTransform => {
		const horizontalRange = Math.max(
			hero.clientWidth * (mobileQuery.matches ? 0.22 : 0.29),
			mosaic?.offsetWidth ? mosaic.offsetWidth * 0.48 : 0,
		);
		const verticalRange = Math.max(
			hero.clientHeight * (mobileQuery.matches ? 0.16 : 0.24),
			mosaic?.offsetHeight ? mosaic.offsetHeight * 0.78 : 0,
		);
		const blurBase = mobileQuery.matches ? 8 : 13;
		const blurRange = mobileQuery.matches ? 6 : 10;
		const normalizedX = tile.offsetX / 75;
		const normalizedY = tile.offsetY / 57.5;
		const distance = Math.hypot(normalizedX, normalizedY);
		const minimumTravel = 0.52;
		const travelMultiplier =
			distance > 0 && distance < minimumTravel ? minimumTravel / distance : 1;

		return {
			x: normalizedX * travelMultiplier * horizontalRange,
			y: normalizedY * travelMultiplier * verticalRange,
			rotation: tile.rotation * 0.12,
			scaleX: 0.66 + Math.min(0.16, Math.max(0, (tile.scale - 0.72) * 0.48)),
			scaleY: 0.66 + Math.min(0.16, Math.max(0, (tile.scale - 0.72) * 0.48)),
			blur: blurBase + (tile.blur / 5) * blurRange,
		};
	};

	const getTileIdleTransform = (tile: TileState): TileIdleTransform => {
		const mosaicWidth = mosaic?.offsetWidth ?? hero.clientWidth * 0.84;
		const mosaicHeight = mosaic?.offsetHeight ?? hero.clientHeight * 0.72;
		const idleVisible = Math.max(1, config.mosaic.idleVisible);
		const depth = tile.order % idleVisible;
		const depthProgress = idleVisible > 1 ? depth / (idleVisible - 1) : 0;
		const normalizedX = (tile.offsetX + 75) / 150;
		const normalizedY = (tile.offsetY + 57.5) / 115;
		const targetX = mosaicWidth * (0.04 + normalizedX * 0.92);
		const targetY = mosaicHeight * (0.3 + normalizedY * 0.62);
		const tileCenterX =
			((tile.column + 0.5) / config.mosaic.columns) * mosaicWidth;
		const tileCenterY = ((tile.row + 0.5) / config.mosaic.rows) * mosaicHeight;

		return {
			x: targetX - tileCenterX,
			y: targetY - tileCenterY,
			rotation: tile.rotation,
			scaleX: 1.18 - depthProgress * 0.38,
			scaleY: 1.18 - depthProgress * 0.38,
			blur: depthProgress * 7,
		};
	};

	// 首屏布局只服务于第一次静止展示；进入轮换后仍回到上面的随机布局。
	const getTileInitialTransform = (tile: TileState): TileTransform => {
		const layout = config.mosaic.initialLayout?.[tile.order];
		if (mobileQuery.matches || !mosaic || !layout) {
			return getTileIdleTransform(tile);
		}

		const mosaicWidth = Math.max(1, mosaic.offsetWidth);
		const mosaicHeight = Math.max(1, mosaic.offsetHeight);
		const columns = Math.max(1, config.mosaic.columns);
		const rows = Math.max(1, config.mosaic.rows);
		const clampRatio = (value: number, fallback: number) =>
			Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback;
		const centerX = clampRatio(layout.x, 0.5) * mosaicWidth;
		const centerY = clampRatio(layout.y, 0.5) * mosaicHeight;
		const tileCenterX = ((tile.column + 0.5) / columns) * mosaicWidth;
		const tileCenterY = ((tile.row + 0.5) / rows) * mosaicHeight;
		const width = Math.max(0.01, clampRatio(layout.width, 1 / columns));
		const height = Math.max(0.01, clampRatio(layout.height, 1 / rows));
		const rotation =
			typeof layout.rotation === "number" && Number.isFinite(layout.rotation)
				? layout.rotation
				: 0;
		const blur = Number.isFinite(layout.blur)
			? Math.max(0, layout.blur ?? 0)
			: 0;

		return {
			x: centerX - tileCenterX,
			y: centerY - tileCenterY,
			rotation,
			scaleX: width * columns,
			scaleY: height * rows,
			blur,
		};
	};

	const getBaseScrollDistance = () =>
		mobileQuery.matches
			? getHeroPinEndDistance(
					config.mosaic.mobileScrollDistance,
					window.innerHeight,
					config.mosaic.mobileMinViewports,
				)
			: getHeroPinEndDistance(
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
		return Math.max(
			0,
			mobileQuery.matches
				? config.mosaic.mobileDialogueTailDistance
				: config.mosaic.desktopDialogueTailDistance,
		);
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
		const progress = mapScrollProgressToTimelineProgress(scrollProgress);
		timeline?.totalProgress(progress);
		updateSceneState(progress);
	};

	const invalidateTimelineFromInitialState = () => {
		if (!timeline) return;
		const progress = timeline.totalProgress();
		// GSAP 的 to tween 会以 invalidate 时的当前值作为起点，先回到初始帧才能保留原始起点。
		timeline.totalProgress(0, true);
		timeline.invalidate();
		timeline.totalProgress(progress, true);
	};

	const buildTimeline = () => {
		if (!title || !mosaic || !backdrop || tiles.length === 0) return;

		gsap.set(mosaic, { xPercent: -50, y: 0, scale: 1 });
		gsap.set(mosaicComplete, { autoAlpha: 0 });
		gsap.set(backdrop, { autoAlpha: 0 });
		gsap.set(dialogueRoot, { autoAlpha: 0, y: 16, scale: 0.96 });
		gsap.set(quickActions, { autoAlpha: 0, y: 38, scale: 0.42 });
		for (const tile of tiles) {
			const transform = tile.initiallyVisible
				? getTileInitialTransform(tile)
				: getTileEntranceTransform(tile);
			gsap.set(tile.element, {
				x: transform.x,
				y: transform.y,
				rotation: transform.rotation,
				scaleX: transform.scaleX,
				scaleY: transform.scaleY,
				filter: `blur(${transform.blur}px)`,
				autoAlpha: tile.initiallyVisible ? 1 : 0,
			});
		}

		timeline = gsap.timeline({
			defaults: { ease: "none" },
			paused: true,
		});

		timeline.to({}, { duration: 1 });
		timeline.to(
			title,
			{
				yPercent: -20,
				scale: 0.58,
				transformOrigin: "0% 50%",
				duration: 0.1,
				ease: "power3.inOut",
			},
			0,
		);
		// 右下角 contact 的退场不再整体渐隐，改为字符随风散落，
		// 由 prepareFlyText() 在字体就绪后将 scatter 时间线挂载到 0.04 位置。
		timeline.to(
			tiles.map((tile) => tile.element),
			{
				autoAlpha: 0,
				duration: 0.06,
				ease: "power2.in",
			},
			0.04,
		);

		for (const tile of tiles) {
			const start = 0.1 + tile.order * 0.02;
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

		if (mosaicComplete) {
			timeline.to(
				mosaicComplete,
				{ autoAlpha: 1, duration: 0.03, ease: "none" },
				0.72,
			);
		}

		timeline.to(
			title,
			{
				autoAlpha: 0,
				yPercent: -28,
				duration: 0.08,
				ease: "power2.in",
			},
			0.72,
		);

		if (dialogueRoot) {
			timeline.to(
				dialogueRoot,
				{
					autoAlpha: 1,
					y: 0,
					scale: 1,
					duration: DIALOGUE_REVEAL_DURATION,
					ease: "power3.out",
				},
				DIALOGUE_REVEAL_TIME,
			);
		}

		timeline.to(
			mosaic,
			{
				y: () => getMosaicTransform().y,
				scale: () => getMosaicTransform().scale,
				duration: 0.2,
				ease: "power3.inOut",
			},
			0.76,
		);
		timeline.to(
			backdrop,
			{ autoAlpha: 1, duration: 0.1, ease: "power2.inOut" },
			0.87,
		);
		timeline.to(
			mosaic,
			{ autoAlpha: 0, duration: 0.07, ease: "power2.in" },
			0.92,
		);

		quickActions.forEach((action, index) => {
			timeline?.to(
				action,
				{
					autoAlpha: 1,
					y: 0,
					scale: 1,
					duration: 0.14,
					ease: "back.out(2.1)",
				},
				QUICK_ACTIONS_REVEAL_TIME + index * 0.03,
			);
		});

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

		heroScrollTrigger = ScrollTrigger.create({
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
			onRefreshInit: invalidateTimelineFromInitialState,
			onRefresh: (self) => {
				self.update();
				renderTimelineForScroll(scrollDriver?.progress() ?? self.progress);
			},
			onUpdate: (self) => {
				if (!scrollDriver) renderTimelineForScroll(self.progress);
			},
		});

		renderTimelineForScroll(heroScrollTrigger.progress);
		ScrollTrigger.refresh();
	};

	// 初始可见碎片改为渐入，完成后进入常规 idle 轮换
	const playTilesIntro = () => {
		const idleTiles = tiles.filter((tile) => tile.initiallyVisible);
		if (!idleTiles.length) {
			tilesIntroDone = true;
			return;
		}
		tilesIntroTimeline = gsap.timeline({
			onComplete: () => {
				tilesIntroTimeline = null;
				tilesIntroDone = true;
				if (
					(heroScrollTrigger?.progress ?? 0) <= 0.002 &&
					!reducedMotionQuery.matches &&
					!idleTimer
				) {
					startIdleRotation();
				}
			},
		});
		for (const tile of idleTiles) {
			const transform = getTileInitialTransform(tile);
			tilesIntroTimeline.fromTo(
				tile.element,
				{
					y: transform.y + 24,
					scaleX: transform.scaleX * 0.92,
					scaleY: transform.scaleY * 0.92,
					filter: `blur(${transform.blur + 5}px)`,
					autoAlpha: 0,
				},
				{
					y: transform.y,
					scaleX: transform.scaleX,
					scaleY: transform.scaleY,
					filter: `blur(${transform.blur}px)`,
					autoAlpha: 1,
					duration: 0.85,
					ease: "power2.out",
					immediateRender: true,
				},
				0.06 + tile.order * 0.05,
			);
		}
	};

	// 右下角 contact：Scatter random 入场；下滑时字符风散退场
	const prepareFlyText = () => {
		const titleHost = hero.querySelector<HTMLElement>(
			".home-hero__title > span:first-child",
		);
		const contactHosts = (
			contact
				? [
						hero.querySelector<HTMLElement>(".home-hero__contact-platform"),
						hero.querySelector<HTMLElement>(".home-hero__contact-handle"),
					]
				: []
		).filter((host): host is HTMLElement => host !== null);
		const occupation = hero.querySelector<HTMLElement>(
			".home-hero__occupation",
		);
		const identityText = [titleHost, occupation].filter(
			(element): element is HTMLElement => element !== null,
		);

		// 字体就绪前先隐藏 contact，避免拆字前闪现原始整段文字。
		contactHosts.forEach((host) => {
			gsap.set(host, { autoAlpha: 0 });
		});
		identityText.forEach((element) => {
			gsap.set(element, { autoAlpha: 0, y: 14 });
		});

		const mountContactScatter = () => {
			if (!timeline || !flyHandles.length) return;
			if (contactScatterTimeline) timeline.remove(contactScatterTimeline);
			const scatter = gsap.timeline();
			for (const handle of flyHandles) {
				const tl = handle.buildScatter(0.12);
				if (tl) scatter.add(tl, 0);
			}
			contactScatterTimeline = scatter;
			timeline.add(scatter, 0.04);
		};

		const handleFlyLayoutChange = () => {
			window.clearTimeout(flyLayoutTimer);
			flyLayoutTimer = window.setTimeout(() => {
				if (hero.dataset.heroMounted !== "true") return;
				for (const handle of flyHandles) handle.rebuild();
				mountContactScatter();
			}, 200);
		};

		document.fonts.ready.then(() => {
			if (hero.dataset.heroMounted !== "true") return;
			flyHandles = contactHosts.map((host) => createFlyText(host));
			for (const handle of flyHandles) {
				handle.prepare();
				handle.onLayoutChange(handleFlyLayoutChange);
			}
			contactHosts.forEach((host) => {
				gsap.set(host, { autoAlpha: 1 });
			});

			mountContactScatter();

			const progress = heroScrollTrigger?.progress ?? 0;
			if (progress <= 0.01) {
				const intro = gsap.timeline();
				const contactEntrances = flyHandles
					.map((handle) => handle.buildEntrance(0.8))
					.filter((tl): tl is ReturnType<typeof gsap.timeline> => tl !== null);
				contactEntrances.forEach((tl, index) => {
					intro.add(tl, 0.22 + index * 0.05);
				});
				textIntroTimeline = intro;
			} else {
				for (const handle of flyHandles) handle.setNatural();
			}

			if (identityText.length) {
				gsap.to(identityText, {
					autoAlpha: 1,
					y: 0,
					duration: 0.7,
					ease: "power2.out",
					delay: 0.5,
				});
			}
		});
	};

	if (reducedMotionQuery.matches) {
		setReducedMotionState(hero, dialogue);
	} else {
		buildTimeline();
		playTilesIntro();
		prepareFlyText();
	}
	document
		.querySelector(".home-page--motion-pending")
		?.classList.remove("home-page--motion-pending");

	if (resetAfterReload) {
		requestAnimationFrame(() => {
			window.scrollTo(0, 0);
			timeline?.progress(0);
			scrollDriver?.progress(0);
			updateSceneState(0);
			ScrollTrigger.refresh();
			history.scrollRestoration = "auto";
		});
	}

	return () => {
		stopIdleRotation();
		window.clearTimeout(flyLayoutTimer);
		tilesIntroTimeline?.kill();
		tilesIntroTimeline = null;
		textIntroTimeline?.kill();
		textIntroTimeline = null;
		for (const handle of flyHandles) handle.destroy();
		flyHandles = [];
		contactScatterTimeline = null;
		heroVisibility.disconnect();
		rain.destroy();
		dialogue.destroy();
		destroySticker();
		abortController.abort();
		heroScrollTrigger?.kill();
		heroScrollTrigger = null;
		scrollDriver?.kill();
		scrollDriver = null;
		timeline?.kill();
		timeline = null;
		delete hero.dataset.heroMounted;
		delete hero.dataset.layerActive;
	};
}
