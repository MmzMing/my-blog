import {
	type BubbleMessage,
	loadCommentBubble,
	startBubbleWall,
} from "@/utils/home-blinds-bubble-controller";
import { startBlindsImageRail } from "@/utils/home-blinds-image-rail-controller";
import { startBlindsMarquee } from "@/utils/home-blinds-marquee-controller";
import { requestScrollTriggerRefresh } from "@/utils/scroll-trigger-refresh";

type Gsap = typeof import("gsap")["gsap"];
type ScrollTriggerPlugin = typeof import("gsap/ScrollTrigger")["ScrollTrigger"];
type ScrollTriggerInstance = ReturnType<ScrollTriggerPlugin["create"]>;
type GsapTimeline = ReturnType<Gsap["timeline"]>;
type GsapTween = ReturnType<Gsap["to"]>;

type HomeBlindsRuntimeConfig = {
	reveal: {
		headline: {
			enterDuration: number;
			messageHold: number;
			messageFlipDuration: number;
		};
	};
	scenes: {
		sceneCount: number;
		bubbleMessages: BubbleMessage[];
		commentBubble: {
			enabled: boolean;
			serverURL: string;
			lang: string;
			weight: number;
		};
	};
};

type SetupContext = {
	root: HTMLElement;
	gsap: Gsap;
	ScrollTrigger: ScrollTriggerPlugin;
	config: HomeBlindsRuntimeConfig;
	signal: AbortSignal;
};

const DESKTOP_MEDIA_QUERY = "(min-width: 769px)";
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const BLIND_COUNT = 8;
const BLIND_STAGGER_SHARE = 0.52;
const REVEAL_CATCH_UP_DURATION = 1.02;
const STAGE_MIN_DURATION = 0.14;
const ENTRY_END = 0.54;
const HEADLINE_START = 0.2;
const GLASS_OPEN_START = 0.56;
const GLASS_OPEN_END = 0.79;
const SHRINK_START = 0.8;
const PHOTO_HANDOFF = 0.97;
const PAPER_START = 0.83;
const SCENES_INTRO_SHARE = 0.18;
const SCENES_OUTRO_START = 0.82;
// 给成形和收场留出独立的播放时间，即使一次滚轮事件跨过整段也能按顺序跟上。
const GALLERY_START = 1;
const GALLERY_TRAVEL_START = 1.34;
const GALLERY_OUTRO_START = 1.88;
const GALLERY_END = 2.22;
const GALLERY_SIDE_SCALE = 0.8;
const GALLERY_OUTRO_SCALE = 0.9;
const WHEEL_AXIS_IDLE = 150;
const SWAY_MAX_ANGLE = 6;
const SWAY_SPRING = 125;
const SWAY_DAMPING = 11;
const SWAY_RELEASE_DELAY = 48;
/** 视差起始缩放：上下各留出 (1.18 - 1) / 2 = 9% 的位移余量，位移期间不露边 */
const BACKGROUND_ENTER_SCALE = 1.18;
const BACKGROUND_ENTER_TRAVEL = 0.075;
let activeRoot: HTMLElement | null = null;
let activeCleanup: (() => void) | null = null;
let bootGeneration = 0;

/** 一幕之内需要分层显示的所有元素 */
type SceneRefs = {
	card: HTMLElement;
	photo: HTMLElement;
	swing: HTMLElement;
	isVisible: boolean;
};

function clamp(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value));
}

/** 平滑收边：两端缓、中段快，入场行程不直来直去 */
function smoothstep(value: number) {
	return value * value * (3 - 2 * value);
}

function progressBetween(value: number, start: number, end: number): number {
	return clamp((value - start) / (end - start), 0, 1);
}

/** 让同一块遮罩在左边缘串起各横条，磨砂只需一个滤镜。 */
function renderShutter(element: HTMLElement, progress: number): void {
	element.style.visibility = progress === 1 ? "hidden" : "visible";
	if (progress === 0 || progress === 1) {
		element.style.clipPath = "none";
		return;
	}

	const points = Array.from({ length: BLIND_COUNT }, (_, index) => {
		const delay =
			((BLIND_COUNT - 1 - index) / (BLIND_COUNT - 1)) * BLIND_STAGGER_SHARE;
		const open = smoothstep(
			clamp((progress - delay) / (1 - BLIND_STAGGER_SHARE), 0, 1),
		);
		const top = (index / BLIND_COUNT) * 100;
		const bottom = ((index + 1 - open) / BLIND_COUNT) * 100;
		return `0 ${top}%, 100% ${top}%, 100% ${bottom}%, 0 ${bottom}%`;
	});
	element.style.clipPath = `polygon(${points.join(", ")})`;
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
		photo: selectRequired<HTMLElement>(card, "[data-scene-frame]"),
		swing: selectRequired<HTMLElement>(card, "[data-scene-swing]"),
		isVisible: false,
	};
}

/** 字幕沿纸边依次露出，滚回去和退场时都复用同一组裁切。 */
function createSceneCaption(gsap: Gsap, card: HTMLElement): GsapTimeline {
	const title = selectRequired<HTMLElement>(card, "[data-scene-title]");
	const date = card.querySelector<HTMLElement>("[data-scene-date]");
	const divider = selectRequired<HTMLElement>(
		card,
		"[data-scene-band-divider]",
	);
	const note = selectRequired<HTMLElement>(card, "[data-scene-note]");
	const hidden = { yPercent: 75, clipPath: "inset(0% 0% 100% 0%)" };
	const shown = {
		yPercent: 0,
		clipPath: "inset(0% 0% 0% 0%)",
		duration: 0.48,
		ease: "power2.out",
	};
	const caption = gsap.timeline({ paused: true });
	caption.fromTo(title, hidden, shown, 0);
	if (date) caption.fromTo(date, hidden, shown, 0.1);
	return caption
		.fromTo(
			divider,
			{ scaleY: 0 },
			{ scaleY: 1, duration: 0.34, ease: "power2.out" },
			0.16,
		)
		.fromTo(note, hidden, shown, 0.23);
}

/** 百叶、明信片和页脚共用同一段滚动，场地由 sticky 固定在原来的文档流中。 */
function setupScenes(
	context: SetupContext,
	setHeadlineVisible: (visible: boolean) => void,
): () => void {
	const { root, gsap, ScrollTrigger, config, signal } = context;
	const section = selectRequired<HTMLElement>(
		root,
		"[data-home-blinds-scenes]",
	);
	const viewport = selectRequired<HTMLElement>(
		section,
		"[data-scenes-viewport]",
	);
	const stage = selectRequired<HTMLElement>(root, "[data-blinds-stage]");
	const portal = selectRequired<HTMLElement>(stage, "[data-scenes-portal]");
	const portalImage = selectRequired<HTMLImageElement>(
		portal,
		"[data-scenes-portal-image]",
	);
	const entryShutter = selectRequired<HTMLElement>(
		stage,
		"[data-blinds-entry-shutter]",
	);
	const glass = selectRequired<HTMLElement>(stage, "[data-reveal-glass]");
	const headline = selectRequired<HTMLElement>(stage, "[data-headline-window]");
	const scenes = Array.from(
		section.querySelectorAll<HTMLElement>("[data-home-blinds-scene]"),
		collectScene,
	).slice(0, config.scenes.sceneCount);
	const first = scenes[0];
	const lastIndex = scenes.length - 1;
	const captions = scenes.map(({ card }) => createSceneCaption(gsap, card));
	const stands = selectRequired<HTMLElement>(section, "[data-scenes-stands]");
	const standsTrack = selectRequired<HTMLElement>(
		stands,
		"[data-scenes-stands-track]",
	);
	const standImages = Array.from(
		stands.querySelectorAll<HTMLElement>("[data-scenes-stand-image]"),
	);
	const marqueeLayer = selectRequired<HTMLElement>(
		section,
		"[data-scenes-marquee]",
	);
	const bubbleLayer = selectRequired<HTMLElement>(
		section,
		"[data-scenes-bubbles]",
	);
	const bubbleSlots = Array.from(
		bubbleLayer.querySelectorAll<HTMLElement>("[data-scene-bubble]"),
		(root) => ({
			root,
			body: selectRequired<HTMLElement>(root, "[data-scene-bubble-body]"),
			text: selectRequired<HTMLElement>(root, "[data-scene-bubble-text]"),
		}),
	);
	const marquee = startBlindsMarquee({ layer: marqueeLayer, gsap, signal });
	const setImageRailPaused = startBlindsImageRail(stands, standsTrack, signal);
	const bubbleWall = startBubbleWall({
		container: bubbleLayer,
		bubbles: bubbleSlots,
		messages: config.scenes.bubbleMessages,
		signal,
	});
	const shrinkEase = gsap.parseEase("power2.inOut");
	const stageMotion = { progress: 0 };
	let stageTarget = 0;
	let isInView = false;
	let renderedProgress = Number.NaN;
	let wasInView = false;
	let lastGalleryPosition = 0;
	let marqueeProgress = 0;
	let foregroundProgress = Number.NaN;
	let requestedComment = false;
	let galleryStart = 0;
	let galleryEnd = 0;
	let viewportTop = 0;
	let renderedViewportTop = Number.NaN;
	let swayAngle = 0;
	let swayVelocity = 0;
	let swayTarget = 0;
	let swayStrength = 0;
	let lastSwayInput = 0;
	let isSwaying = false;

	function renderSway(scene: SceneRefs): void {
		scene.swing.style.transform = `rotate(${swayAngle * swayStrength}deg)`;
	}

	function stopSway(): void {
		if (!isSwaying) return;
		gsap.ticker.remove(tickSway);
		isSwaying = false;
		swayAngle = 0;
		swayVelocity = 0;
		swayTarget = 0;
		lastSwayInput = 0;
	}

	function tickSway(_time: number, deltaMs: number): void {
		const target =
			performance.now() - lastSwayInput < SWAY_RELEASE_DELAY ? swayTarget : 0;
		const step = Math.min(deltaMs / 1000, 1 / 30);
		// 欠阻尼弹簧让卡片在停手后越过中线一次，再摆回静止。
		swayVelocity +=
			((target - swayAngle) * SWAY_SPRING - swayVelocity * SWAY_DAMPING) * step;
		swayAngle += swayVelocity * step;
		if (
			target === 0 &&
			Math.abs(swayAngle) < 0.02 &&
			Math.abs(swayVelocity) < 0.1
		)
			stopSway();
		for (const scene of scenes) {
			if (scene.isVisible) renderSway(scene);
		}
	}

	const driveSway = (distance: number): void => {
		if (Math.abs(distance) < 0.1 || swayStrength === 0 || document.hidden)
			return;
		const now = performance.now();
		const elapsed = clamp(now - lastSwayInput, 8, 34);
		swayTarget = clamp(
			(-distance / elapsed) * 4,
			-SWAY_MAX_ANGLE,
			SWAY_MAX_ANGLE,
		);
		lastSwayInput = now;
		if (!isSwaying) {
			isSwaying = true;
			gsap.ticker.add(tickSway);
		}
	};

	// 量布局盒而非动画后的矩形，之后每一帧只写样式。
	const sizes = {
		stageWidth: 0,
		stageHeight: 0,
		viewportHeight: 0,
		photoX: 0,
		photoY: 0,
		photoWidth: 0,
		photoHeight: 0,
		photoScale: 1,
		outroOffsetY: 0,
		step: 0,
	};
	const measure = (): void => {
		const stageBounds = stage.getBoundingClientRect();
		const viewportBounds = viewport.getBoundingClientRect();
		sizes.stageWidth = stageBounds.width;
		sizes.stageHeight = stageBounds.height;
		sizes.viewportHeight = viewportBounds.height;
		// 卡的局部定位不随挂卡摆动变化。保留分数像素，切换两张图时边缘才能重合。
		const frame = getComputedStyle(first.photo);
		const card = getComputedStyle(first.card);
		const cardHeight = Number.parseFloat(card.height);
		// 按原先上收结束时的间距折半，页脚提前接近卡片底边。
		const previousOutroOffsetY = -sizes.stageHeight * 0.12;
		const centeredGap =
			(sizes.viewportHeight - cardHeight * GALLERY_OUTRO_SCALE) / 2;
		sizes.outroOffsetY = (previousOutroOffsetY + centeredGap) / 2;
		const paperFrame = getComputedStyle(
			first.photo.parentElement ?? first.card,
		);
		const frameTop =
			Number.parseFloat(paperFrame.paddingTop) +
			Number.parseFloat(paperFrame.borderTopWidth);
		sizes.photoWidth = Number.parseFloat(frame.width);
		sizes.photoHeight = Number.parseFloat(frame.height);
		sizes.photoX =
			viewportBounds.left +
			viewportBounds.width / 2 -
			(stageBounds.left + stageBounds.width / 2);
		sizes.photoY =
			frameTop +
			sizes.photoHeight / 2 -
			cardHeight / 2 +
			(sizes.viewportHeight - sizes.stageHeight) / 2;
		sizes.step = sizes.photoWidth + Math.max(150, viewportBounds.width * 0.16);

		const { naturalWidth, naturalHeight } = portalImage;
		if (!naturalWidth || !naturalHeight) return;
		const viewportScale = Math.max(
			sizes.stageWidth / naturalWidth,
			sizes.stageHeight / naturalHeight,
		);
		const photoScale = Math.max(
			sizes.photoWidth / naturalWidth,
			sizes.photoHeight / naturalHeight,
		);
		sizes.photoScale = photoScale / viewportScale;
		portalImage.style.width = `${naturalWidth * viewportScale}px`;
		portalImage.style.height = `${naturalHeight * viewportScale}px`;
	};

	const images = [portalImage, first.photo.querySelector("img")].filter(
		(image): image is HTMLImageElement => image !== null,
	);
	const pendingImages = new Set(
		images.filter((image) => !image.hasAttribute("src") || !image.complete),
	);

	const requestCommentBubble = (): void => {
		if (requestedComment) return;
		requestedComment = true;
		const source = config.scenes.commentBubble;
		if (!source.enabled) return;
		void loadCommentBubble({
			serverURL: source.serverURL,
			lang: source.lang,
			weight: source.weight,
			signal,
		})
			.then((message) => {
				if (message && !signal.aborted) bubbleWall.addMessages([message]);
			})
			.catch(() => {
				// 评论服务失败时继续使用本地留言。
			});
	};

	const syncPlayback = (): void => {
		const running = isInView && document.visibilityState === "visible";
		marquee.setPaused(!running || marqueeProgress === 0);
		bubbleWall.setPaused(!running || foregroundProgress === 0);
		setImageRailPaused(!running || foregroundProgress === 0);
		if (!running && isSwaying) {
			stopSway();
			for (const scene of scenes) {
				if (scene.isVisible) renderSway(scene);
			}
		}
	};

	const renderBackdrop = (progress: number): void => {
		const entry = progressBetween(progress, 0, ENTRY_END);
		const opening = progressBetween(progress, GLASS_OPEN_START, GLASS_OPEN_END);
		const crop = shrinkEase(
			progressBetween(progress, SHRINK_START, PHOTO_HANDOFF),
		);
		renderShutter(entryShutter, entry);
		renderShutter(glass, opening);

		const headlineExit = smoothstep(opening);
		headline.style.opacity = String(1 - headlineExit);
		headline.style.visibility = opening === 1 ? "hidden" : "visible";
		headline.style.transform = `translateY(${-38 * headlineExit}%)`;

		const parallax = 1 - smoothstep(entry);
		const scale =
			1 +
			(BACKGROUND_ENTER_SCALE - 1) * parallax +
			(sizes.photoScale - 1) * crop;
		const x = sizes.photoX * crop;
		const targetY = sizes.photoY + viewportTop;
		const y =
			sizes.stageHeight * BACKGROUND_ENTER_TRAVEL * parallax + targetY * crop;
		portalImage.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px) scale(${scale})`;
		const insetX = (sizes.stageWidth - sizes.photoWidth) / 2;
		const insetY = (sizes.stageHeight - sizes.photoHeight) / 2;
		portal.style.clipPath =
			crop === 0
				? "none"
				: `inset(${(insetY + targetY) * crop}px ${(insetX - sizes.photoX) * crop}px ${(insetY - targetY) * crop}px ${(insetX + sizes.photoX) * crop}px)`;
	};

	const renderDecoration = (position: number, outro: number): void => {
		marqueeProgress =
			progressBetween(position, 0.91, GALLERY_TRAVEL_START) *
			(1 - progressBetween(outro, 0.26, 0.94));
		marquee.render(marqueeProgress);

		const foreground =
			progressBetween(position, 1.15, GALLERY_TRAVEL_START + 0.11) *
			(1 - progressBetween(outro, 0.04, 0.67));
		if (foreground === foregroundProgress) return;
		foregroundProgress = foreground;
		bubbleLayer.style.visibility = foreground > 0 ? "visible" : "hidden";
		stands.style.visibility = foreground > 0 ? "visible" : "hidden";
		if (foreground > 0) requestCommentBubble();
		for (const [index, slot] of bubbleSlots.entries()) {
			const delay = (index % 6) * 0.045;
			const reveal = smoothstep(
				progressBetween(foreground, delay, delay + 0.65),
			);
			slot.body.style.setProperty("--bubble-reveal", String(reveal));
		}
		for (const [index, image] of standImages.entries()) {
			const delay = (index % 3) * 0.08;
			const remaining =
				1 - smoothstep(progressBetween(foreground, delay, delay + 0.76));
			image.style.transform = `translateY(${remaining * 105}%) rotateX(${remaining * 55}deg)`;
		}
	};

	const renderCards = (
		position: number,
		galleryPosition: number,
		outro: number,
	): void => {
		const scrollOffset = galleryPosition * sizes.step;
		const pull = smoothstep(progressBetween(outro, 0.23, 1));
		const outroScale = 1 + (GALLERY_OUTRO_SCALE - 1) * pull;
		const y = sizes.outroOffsetY * pull;
		for (const [index, scene] of scenes.entries()) {
			const distance = Math.abs(index - galleryPosition);
			const entryDelay = Math.min(index, 4) * 0.035;
			const assembly =
				index === 0
					? progressBetween(position, PAPER_START, 1.18)
					: progressBetween(position, 0.98 + entryDelay, 1.29 + entryDelay);
			const assembled = smoothstep(assembly);
			const sideExit =
				index === lastIndex ? 0 : smoothstep(progressBetween(outro, 0, 0.72));
			const x =
				index * sizes.step -
				scrollOffset +
				(index === 0 ? 0 : 42 * (1 - assembled)) -
				64 * sideExit;
			if (
				assembly === 0 ||
				sideExit === 1 ||
				Math.abs(x) > sizes.stageWidth / 2 + sizes.step
			) {
				scene.isVisible = false;
				scene.card.style.visibility = "hidden";
				continue;
			}

			scene.isVisible = true;
			scene.card.style.visibility = "visible";
			scene.card.style.opacity = String(
				(index === 0 ? 1 : assembled) * (1 - sideExit),
			);
			const side = smoothstep(progressBetween(distance, 0, 1));
			const scale = outroScale * (1 - (1 - GALLERY_SIDE_SCALE) * side);
			scene.card.style.transform = `translate(-50%, -50%) translate3d(${x}px, ${y}px, 0) scale(${scale})`;
			scene.card.style.zIndex = String(Math.round(20 - distance * 3));
			renderSway(scene);

			scene.swing.style.setProperty(
				"--scene-hanger-reveal",
				String(smoothstep(progressBetween(assembly, 0.4, 0.72))),
			);
			if (index === 0) {
				const paper = smoothstep(progressBetween(position, PAPER_START, 1.1));
				scene.swing.style.setProperty("--scene-paper-reveal", String(paper));
				scene.photo.style.visibility =
					position >= PHOTO_HANDOFF ? "" : "hidden";
			}

			const focus = 1 - smoothstep(progressBetween(distance, 0.23, 0.94));
			const caption = smoothstep(progressBetween(position, 1.02, 1.3));
			captions[index].progress(
				focus * caption * (1 - smoothstep(progressBetween(outro, 0.06, 0.54))),
			);
		}
	};

	function renderStage(force = false): void {
		if (signal.aborted) return;
		const position = stageMotion.progress;
		if (
			!force &&
			position === renderedProgress &&
			isInView === wasInView &&
			(position >= PHOTO_HANDOFF || viewportTop === renderedViewportTop)
		)
			return;
		renderedProgress = position;
		renderedViewportTop = viewportTop;
		const showingBackdrop = isInView && position < PHOTO_HANDOFF;
		stage.style.opacity = showingBackdrop ? "1" : "0";
		stage.style.visibility = showingBackdrop ? "visible" : "hidden";
		if (showingBackdrop) renderBackdrop(position);
		setHeadlineVisible(
			showingBackdrop &&
				position >= HEADLINE_START &&
				position < GLASS_OPEN_END,
		);
		if (!isInView && !wasInView && !force) return;
		wasInView = isInView;

		const galleryPosition =
			lastIndex *
			smoothstep(
				progressBetween(position, GALLERY_TRAVEL_START, GALLERY_OUTRO_START),
			);
		const outro = progressBetween(position, GALLERY_OUTRO_START, GALLERY_END);
		swayStrength =
			smoothstep(
				progressBetween(position, PHOTO_HANDOFF, GALLERY_TRAVEL_START),
			) *
			(1 - smoothstep(progressBetween(outro, 0, 0.46)));
		renderDecoration(isInView ? position : 0, outro);
		syncPlayback();
		if (isInView) {
			renderCards(position, galleryPosition, outro);
			if (!force) {
				const distance = (galleryPosition - lastGalleryPosition) * sizes.step;
				marquee.nudge(distance);
				driveSway(distance);
			}
		} else {
			for (const scene of scenes) {
				scene.isVisible = false;
				scene.card.style.visibility = "hidden";
			}
		}
		lastGalleryPosition = galleryPosition;
		viewport.style.setProperty(
			"--home-blinds-footer-reveal",
			String(smoothstep(progressBetween(outro, 0.12, 0.86))),
		);
	}

	const advanceStage = gsap.quickTo(stageMotion, "progress", {
		duration: REVEAL_CATCH_UP_DURATION,
		ease: "none",
		onUpdate: () => renderStage(),
	});
	const syncScroll = (trigger: ScrollTriggerInstance, settle = false): void => {
		if (signal.aborted) return;
		const scroll = window.scrollY;
		galleryStart = trigger.start + sizes.stageHeight + sizes.viewportHeight;
		galleryEnd = trigger.end - sizes.viewportHeight;
		// 一次跳过粘滞边界时，收缩照片也要跟上正在离场的卡片。
		viewportTop =
			Math.max(0, galleryStart - sizes.viewportHeight - scroll) +
			Math.min(0, galleryEnd - scroll);
		stage.style.clipPath =
			viewportTop < 0 ? `inset(0 0 ${-viewportTop}px 0)` : "";
		isInView = scroll > trigger.start && scroll < trigger.end;
		const gallery = progressBetween(scroll, galleryStart, galleryEnd);
		const reveal = progressBetween(scroll, trigger.start, galleryStart);
		let target = reveal;
		if (gallery > 0) {
			target =
				reveal +
				(GALLERY_TRAVEL_START - GALLERY_START) *
					progressBetween(gallery, 0, SCENES_INTRO_SHARE) +
				(GALLERY_OUTRO_START - GALLERY_TRAVEL_START) *
					progressBetween(gallery, SCENES_INTRO_SHARE, SCENES_OUTRO_START) +
				(GALLERY_END - GALLERY_OUTRO_START) *
					progressBetween(gallery, SCENES_OUTRO_START, 1);
		}
		if (isInView && pendingImages.size > 0)
			target = Math.min(target, GLASS_OPEN_START);

		if (target !== stageTarget) {
			stageTarget = target;
			advanceStage(target).duration(
				Math.max(
					STAGE_MIN_DURATION,
					Math.abs(target - stageMotion.progress) * REVEAL_CATCH_UP_DURATION,
				),
			);
		}
		// 离屏时落到对应端点。页脚刚出现时舞台仍在屏内，补间继续收场。
		if ((settle || !isInView) && stageMotion.progress !== target) {
			advanceStage.tween.progress(1, true).pause();
		}
		renderStage(settle);
	};

	measure();
	const rootTrigger = ScrollTrigger.create({
		id: "home-blinds-fixed-stage",
		trigger: root,
		start: "top bottom",
		end: "bottom top",
		onUpdate: (self) => syncScroll(self),
	});
	syncScroll(rootTrigger, true);

	for (const image of pendingImages) {
		const finish = (): void => {
			pendingImages.delete(image);
			requestScrollTriggerRefresh(ScrollTrigger);
		};
		image.addEventListener("load", finish, { once: true, signal });
		image.addEventListener("error", finish, { once: true, signal });
	}

	const handleRefresh = (): void => {
		measure();
		marquee.refresh();
		syncScroll(rootTrigger);
		renderStage(true);
	};
	ScrollTrigger.addEventListener("refresh", handleRefresh);
	document.addEventListener("visibilitychange", syncPlayback, { signal });

	let lastWheelTime = Number.NEGATIVE_INFINITY;
	let horizontalGesture = false;
	viewport.addEventListener(
		"wheel",
		(event) => {
			if (
				event.ctrlKey ||
				!event.cancelable ||
				(event.target instanceof Node && stands.contains(event.target))
			)
				return;
			const scroll = window.scrollY;
			if (event.timeStamp - lastWheelTime > WHEEL_AXIS_IDLE) {
				horizontalGesture =
					scroll >= galleryStart &&
					scroll <= galleryEnd &&
					Math.abs(event.deltaX) > 1.2 * Math.abs(event.deltaY);
			}
			lastWheelTime = event.timeStamp;
			if (!horizontalGesture || scroll < galleryStart || scroll > galleryEnd)
				return;
			// 一次双轴手势锁定主方向，余下的纵向抖量不在临界点改变页面坐标。
			const unit =
				event.deltaMode === WheelEvent.DOM_DELTA_LINE
					? 16
					: event.deltaMode === WheelEvent.DOM_DELTA_PAGE
						? sizes.stageHeight
						: 1;
			event.preventDefault();
			window.scrollTo({
				top: clamp(
					scroll + event.deltaX * unit * 1.8,
					Math.ceil(galleryStart),
					Math.floor(galleryEnd),
				),
				behavior: "instant",
			});
		},
		{ passive: false, signal },
	);

	return () => {
		advanceStage.tween.kill();
		stopSway();
		rootTrigger.kill();
		ScrollTrigger.removeEventListener("refresh", handleRefresh);
		setImageRailPaused(true);
		marquee.destroy();
		for (const caption of captions) caption.revert();
		stage.style.opacity = "0";
		stage.style.visibility = "hidden";
		stage.style.removeProperty("clip-path");
		viewport.style.removeProperty("--home-blinds-footer-reveal");
		for (const { card, swing } of scenes) {
			card.style.visibility = "hidden";
			swing.style.removeProperty("transform");
		}
		bubbleLayer.style.visibility = "hidden";
		stands.style.visibility = "hidden";
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
 * ⑤ 落定后标题上移，第二层祝福语逐字翻入并循环。外层标题窗口随磨砂退场。
 */
function setupHeadline(context: SetupContext) {
	const { root, gsap, config, signal } = context;
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
	 * 标题窗的显隐由舞台进度决定，重新量尺寸只更新窗内布局。
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

	const setVisible = (visible: boolean): void => {
		if (signal.aborted || awake === visible) return;
		awake = visible;
		applyAwake();
		if (awake) play();
	};

	reset();
	document.addEventListener("visibilitychange", applyAwake, { signal });

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

	const destroy = (): void => {
		window.clearTimeout(relayoutTimer);
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
	return { setVisible, destroy };
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
		const headline = setupHeadline(context);
		cleanups.push(headline.destroy);
		cleanups.push(setupScenes(context, headline.setVisible));
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
 * kill() 变成在游离节点上做 revert；而离场淡出期间背景循环与图片轨道还在跑。递增 generation 同时作废仍在飞的异步初始化。
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
