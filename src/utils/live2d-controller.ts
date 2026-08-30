import type { Live2DModelConfig } from "@/types/config";

/**
 * Live2D 看板娘的客户端控制器。
 *
 * 只被 Live2DWidget.astro 的 module script 调用一次 —— 组件挂在 #swup-container
 * 之外，DOM 与脚本都不会被 Swup 换掉，所以这里不需要任何「跨导航状态恢复」的
 * 兜底，模块级状态本身就是持久的。
 *
 * pixi / pixi-live2d-display 走 CDN 动态注入，不在构建产物里，因此下面只声明
 * 用到的那一小部分形状，不做完整类型。
 */

/* ------------------------------------------------------------------ *
 * 第三方运行时的最小形状
 * ------------------------------------------------------------------ */

interface MotionDefinition {
	File?: string;
	Name?: string;
}

interface Live2DMotionManager {
	definitions?: Record<string, MotionDefinition[]>;
	expressionManager?: { definitions?: MotionDefinition[] };
}

interface Live2DModelInstance {
	width: number;
	height: number;
	x: number;
	y: number;
	scale: { set(value: number): void };
	anchor: { set(x: number, y: number): void };
	/** 0.4.x 挂在 internalModel 上，0.5.x 改叫 internal，两个都认 */
	internal?: { motionManager?: Live2DMotionManager };
	internalModel?: { motionManager?: Live2DMotionManager };
	on(event: "hit", listener: (hitAreas: string[]) => void): void;
	motion(group: string, index?: number, priority?: number): unknown;
	expression(id?: number | string): unknown;
}

interface PixiApplication {
	stage: { addChild(child: unknown): void };
	renderer: { view: HTMLCanvasElement };
	ticker: { start(): void; stop(): void };
	render(): void;
	destroy(removeView?: boolean, options?: unknown): void;
}

interface PixiLive2DStatic {
	/**
	 * 0.4.x / 0.5.x 都只支持 onLoad / onError —— 包里连 "progress" 这个词都没有，
	 * 拿不到真实下载进度，模型阶段只能走不确定态的转圈。
	 */
	from(
		source: string,
		options?: {
			autoInteract?: boolean;
			motionPreload?: "idle" | "none" | "all";
			onLoad?: () => void;
			onError?: (error: unknown) => void;
		},
	): Promise<Live2DModelInstance>;
}

interface PixiNamespace {
	Application: new (options: {
		view: HTMLCanvasElement;
		width: number;
		height: number;
		backgroundAlpha: number;
		antialias: boolean;
		resolution: number;
		autoDensity: boolean;
	}) => PixiApplication;
	live2d?: { Live2DModel: PixiLive2DStatic };
}

function getPixi(): PixiNamespace | null {
	return (window as unknown as { PIXI?: PixiNamespace }).PIXI ?? null;
}

/* ------------------------------------------------------------------ *
 * 常量与状态
 * ------------------------------------------------------------------ */

const STORAGE_KEYS = {
	visibility: "live2d-visibility-cache",
	position: "live2d-position-cache",
};

/** 模型里的动作组是英文键，面板上给中文名；未收录的组原样显示 */
const GROUP_LABELS: Record<string, string> = {
	Idle: "待机",
	Expression: "表情",
	TapShort: "短动画",
	TapLong: "长动画",
	Other: "其他",
};

/**
 * 三个运行时脚本是逐个加载的，进度可以精确分成前 30%。
 * 剩下的 70% 属于模型，但这个库不给进度回调，只能转不确定态。
 */
const SCRIPT_PROGRESS_SPAN = 0.3;

/** model 的 hit 与 canvas 的 click 会先后触发，用时间窗去重 */
const HIT_DEDUPE_WINDOW = 300;

/** 动作面板贴在模型右侧，宽度与 CSS 里的 .live2d-motion-panel 保持一致 */
const PANEL_WIDTH = 340;
const PANEL_GAP = 10;

/**
 * 兜底的运行时脚本地址，配置里没写 cdn 时用这套。
 * 版本必须成对：display 0.4.0 配 pixi 6，0.5.0-beta 要 pixi 7。
 */
const DEFAULT_CDN = {
	cubismCore:
		"https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js",
	pixi: "https://cdn.jsdelivr.net/npm/pixi.js@6.5.10/dist/browser/pixi.min.js",
	live2dDisplay:
		"https://cdn.jsdelivr.net/npm/pixi-live2d-display@0.4.0/dist/cubism4.min.js",
};

const DEFAULT_CLICK_MESSAGES = [
	"你好！",
	"有什么需要帮助的吗？",
	"今天天气真不错呢！",
	"要不要一起玩游戏？",
	"记得按时休息哦！",
];

/**
 * 动作分两种：
 * - instant：播完就回到待机的瞬时动作（点头、跳一下、wink…）
 * - toggle：成对出现的开关动作，合并成一个按钮来回切（拿剑 / 拿剑取消、猫耳 / 猫耳消失）
 */
type MotionItem = {
	label: string;
	kind: "instant" | "toggle";
	/** 瞬时动作用它；toggle 用它作为「开」 */
	index: number;
	/** 仅 toggle：按下「关」时播的动作索引 */
	offIndex?: number;
};
type MotionGroup = { name: string; label: string; items: MotionItem[] };

interface Live2DState {
	/** 已完整跑过一次初始化（无论成功失败） */
	initialized: boolean;
	/** 进入初始化就置位，用来挡住并发重入 */
	initializing: boolean;
	app: PixiApplication | null;
	model: Live2DModelInstance | null;
	groups: MotionGroup[];
	currentGroup: string;
	resourcesReady: boolean;
	resourceLoadPromise: Promise<boolean> | null;
	widgetVisible: boolean;
	transitioning: boolean;
	wasDragging: boolean;
	lastHitAt: number;
	idleTimer: number;
	domSetup: boolean;
	dragSetup: boolean;
	abort: AbortController | null;
	loading: boolean;
	/** 用户手动收起过作者署名后，重新唤出模型时别又弹出来 */
	authorHidden: boolean;
	/** 开关类动作的当前状态，key 是 `${group}:${label}` */
	toggleStates: Map<string, boolean>;
	/**
	 * 用户想不想看到模型。加载是异步的，中途关闭时不能让 load 完成的回调
	 * 又把它显示回来 —— 只看 state.widgetVisible 区分不了「还没显示」和「刚被关掉」。
	 */
	intentVisible: boolean;
}

const state: Live2DState = {
	initialized: false,
	initializing: false,
	app: null,
	model: null,
	groups: [],
	currentGroup: "",
	resourcesReady: false,
	resourceLoadPromise: null,
	widgetVisible: false,
	transitioning: false,
	wasDragging: false,
	lastHitAt: 0,
	idleTimer: 0,
	domSetup: false,
	dragSetup: false,
	abort: null,
	loading: false,
	authorHidden: false,
	intentVisible: false,
	toggleStates: new Map(),
};

let config: Live2DModelConfig;
let modelUrl = "";

/* ------------------------------------------------------------------ *
 * DOM 查询
 * ------------------------------------------------------------------ */

function els() {
	return {
		widget: document.getElementById("live2d-widget"),
		trigger: document.getElementById("live2d-trigger"),
		loader: document.getElementById("live2d-loader"),
		loaderBar: document.getElementById("live2d-loader-bar"),
		loaderPct: document.getElementById("live2d-loader-pct"),
		loaderLabel: document.getElementById("live2d-loader-label"),
		retry: document.getElementById("live2d-retry"),
		motionBtn: document.getElementById("live2d-motion-btn"),
		panel: document.getElementById("live2d-motion-panel"),
		panelTabs: document.getElementById("live2d-motion-tabs"),
		panelList: document.getElementById("live2d-motion-list"),
		infoBtn: document.getElementById("live2d-info-btn"),
		author: document.getElementById("live2d-author"),
		closeBtn: document.getElementById("live2d-close-btn"),
	};
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ------------------------------------------------------------------ *
 * 加载进度
 * ------------------------------------------------------------------ */

function setProgress(ratio: number, label?: string) {
	const { widget, loaderBar, loaderPct, loaderLabel } = els();
	const pct = Math.max(0, Math.min(100, Math.round(ratio * 100)));
	widget?.classList.remove("is-indeterminate");
	if (loaderBar) {
		loaderBar.style.setProperty("--live2d-progress", String(pct));
	}
	if (loaderPct) {
		loaderPct.textContent = `${pct}`;
	}
	if (loaderLabel) {
		loaderLabel.textContent = label ?? (pct > 0 ? "加载中" : "准备加载");
	}
	widget?.setAttribute("data-progress", String(pct));
}

/**
 * 只有脚本阶段拿得到真实进度（分段计数），模型加载阶段这个库不提供
 * 任何进度回调，所以切成转圈的不确定态 —— 比编一个假百分比诚实。
 */
function beginIndeterminate(label: string) {
	const { widget, loaderPct, loaderLabel } = els();
	widget?.classList.add("is-indeterminate");
	if (loaderPct) loaderPct.textContent = "";
	if (loaderLabel) loaderLabel.textContent = label;
}

function showLoader(text: string) {
	const { widget, loader, retry } = els();
	if (!widget || !loader) return;
	// initial 状态是 translateY(120%) + opacity 0，加载层得先把它拉回舞台
	widget.classList.remove("live2d-initial");
	widget.classList.add("is-loading");
	widget.classList.remove("is-error");
	loader.hidden = false;
	retry?.setAttribute("hidden", "");
	setProgress(0, text);
}

function hideLoader() {
	const { widget, loader } = els();
	widget?.classList.remove("is-loading", "is-indeterminate");
	if (loader) loader.hidden = true;
}

function showLoadError(message: string) {
	const { widget, loader, loaderLabel, retry } = els();
	if (!widget || !loader) return;
	state.loading = false;
	widget.classList.remove("is-loading", "is-indeterminate");
	widget.classList.add("is-error");
	loader.hidden = false;
	if (loaderLabel) loaderLabel.textContent = message;
	retry?.removeAttribute("hidden");
}

/* ------------------------------------------------------------------ *
 * 运行时脚本加载：超时 + npm 镜像回退
 * ------------------------------------------------------------------ */

function unpkgMirror(jsdelivrUrl: string): string | null {
	if (!config.cdn?.useNpmMirror) return null;
	if (!jsdelivrUrl.includes("cdn.jsdelivr.net")) return null;
	return jsdelivrUrl.replace(
		"https://cdn.jsdelivr.net/npm/",
		"https://unpkg.com/",
	);
}

/**
 * 按 src 缓存加载结果。之前用「head 里有没有这个 script 标签」判断已加载，有两个坑：
 * 1. onerror 时标签留在 DOM 里，重试会命中它直接 resolve，脚本其实没执行成功；
 * 2. 请求还在飞时再次调用也会命中标签立即 resolve，拿到的是没加载完的状态。
 * 改成缓存 Promise：成功就一直复用，失败就把缓存清掉让重试能真正重跑。
 */
const scriptLoadCache = new Map<string, Promise<void>>();

function loadScript(src: string, timeout: number): Promise<void> {
	const cached = scriptLoadCache.get(src);
	if (cached) return cached;

	const promise = new Promise<void>((resolve, reject) => {
		const script = document.createElement("script");
		script.src = src;
		script.crossOrigin = "anonymous";

		const fail = (error: Error) => {
			window.clearTimeout(timer);
			// 失败必须摘掉标签，否则重试会被「已存在」的判断挡回去
			script.remove();
			scriptLoadCache.delete(src);
			reject(error);
		};

		const timer = window.setTimeout(() => {
			fail(new Error(`加载超时：${src}`));
		}, timeout);

		script.onload = () => {
			window.clearTimeout(timer);
			resolve();
		};
		script.onerror = () => fail(new Error(`加载失败：${src}`));
		document.head.appendChild(script);
	});

	scriptLoadCache.set(src, promise);
	return promise;
}

/** 先试主源，失败再试镜像，全挂才 reject */
async function loadScriptWithFallback(
	src: string,
	timeout: number,
): Promise<void> {
	try {
		await loadScript(src, timeout);
	} catch (error) {
		const mirror = unpkgMirror(src);
		if (!mirror) throw error;
		await loadScript(mirror, timeout);
	}
}

/**
 * 空闲时提前跟三个 CDN 握手。preconnect 只做 DNS + TCP + TLS，不下载任何内容，
 * 但点开看板娘时能省掉 100~300ms 的连接建立时间。
 * 放在空闲回调里，不跟首屏渲染抢主线程。
 */
function warmUpConnections() {
	const run = () => {
		const origins = new Set(
			[
				config.cdn?.cubismCore ?? DEFAULT_CDN.cubismCore,
				config.cdn?.pixi ?? DEFAULT_CDN.pixi,
				config.cdn?.live2dDisplay ?? DEFAULT_CDN.live2dDisplay,
			].map((url) => {
				try {
					return new URL(url).origin;
				} catch {
					return "";
				}
			}),
		);

		for (const origin of origins) {
			if (!origin) continue;
			if (
				document.head.querySelector(`link[rel="preconnect"][href="${origin}"]`)
			) {
				continue;
			}
			const link = document.createElement("link");
			link.rel = "preconnect";
			link.href = origin;
			link.crossOrigin = "anonymous";
			document.head.appendChild(link);
		}
	};

	if (typeof requestIdleCallback === "function") {
		requestIdleCallback(run, { timeout: 3000 });
	} else {
		window.setTimeout(run, 1500);
	}
}

async function ensureResources(): Promise<boolean> {
	if (state.resourcesReady) return true;
	if (state.resourceLoadPromise) return state.resourceLoadPromise;

	state.resourceLoadPromise = (async () => {
		const timeout = config.cdn?.scriptTimeout ?? 10000;
		const cubismCore = config.cdn?.cubismCore ?? DEFAULT_CDN.cubismCore;
		const pixi = config.cdn?.pixi ?? DEFAULT_CDN.pixi;
		const live2dDisplay =
			config.cdn?.live2dDisplay ?? DEFAULT_CDN.live2dDisplay;

		setProgress(0, "加载运行时");

		// cubismcore 和 pixi 互不依赖，并行拉能省掉一整轮往返；
		// 谁先回来谁推进进度，进度条照样动
		let settled = 0;
		const bump = () => {
			settled += 1;
			setProgress((settled / 3) * SCRIPT_PROGRESS_SPAN, "加载运行时");
		};

		await Promise.all([
			loadScriptWithFallback(cubismCore, timeout).then(bump),
			loadScriptWithFallback(pixi, timeout).then(bump),
		]);

		// display 依赖上面两个，只能等它们都到位
		await loadScriptWithFallback(live2dDisplay, timeout).then(bump);

		if (!getPixi()?.live2d) {
			throw new Error("pixi-live2d-display 未正确挂载");
		}
		state.resourcesReady = true;
		return true;
	})().catch((error: unknown) => {
		// 清掉缓存，让「重试」真的能重跑一次
		state.resourceLoadPromise = null;
		state.resourcesReady = false;
		throw error;
	});

	return state.resourceLoadPromise;
}

/* ------------------------------------------------------------------ *
 * 模型初始化
 * ------------------------------------------------------------------ */

function sizeOf() {
	return {
		width: config.size?.width ?? 280,
		height: config.size?.height ?? 250,
	};
}

/** 保证 widget 里有一个干净的 canvas；旧的会被销毁流程摘掉，这里补新的 */
function ensureCanvas(widget: HTMLElement): HTMLCanvasElement {
	const { width, height } = sizeOf();
	const existing = widget.querySelector("canvas");
	if (existing) return existing;

	const canvas = document.createElement("canvas");
	canvas.className = "live2d-canvas";
	canvas.width = width;
	canvas.height = height;
	widget.insertBefore(canvas, widget.firstChild);
	return canvas;
}

function destroyApp() {
	if (!state.app) return;
	try {
		// removeView=true 会顺手把 canvas 摘掉，正好：重建时会换新 canvas，
		// 避免复用一个 WebGL context 已被销毁的画布。
		state.app.destroy(true, {
			children: true,
			texture: true,
			baseTexture: true,
		});
	} catch {
		/* 销毁失败不影响后续重建 */
	}
	state.app = null;
	state.model = null;
}

/** 0.4.x 用 internalModel，0.5.x 改成 internal，两个都取一遍 */
function motionManagerOf(
	model: Live2DModelInstance,
): Live2DMotionManager | undefined {
	return model.internal?.motionManager ?? model.internalModel?.motionManager;
}

function readMotionGroups(model: Live2DModelInstance): MotionGroup[] {
	const definitions = motionManagerOf(model)?.definitions ?? {};
	const groups: MotionGroup[] = [];

	for (const [name, items] of Object.entries(definitions)) {
		if (!Array.isArray(items) || items.length === 0) continue;
		const raw = items.map((item, index) => ({
			label: actionLabel(item, index),
			index,
		}));
		groups.push({
			name,
			label: GROUP_LABELS[name] ?? name,
			items: buildMotionItems(raw),
		});
	}
	return groups;
}

/* ------------------------------------------------------------------ *
 * 成对的开关动作合并
 *
 * 模型里「拿剑 / 拿剑取消」「猫耳 / 猫耳消失」这类是同一个状态的一开一关，
 * 拆成两个按钮很难用。这里按命名规律把它们并成一个来回切的按钮：
 *   优先认 X入场 + X消失 的三件套（裸 X 一并吃掉，不单独占位），
 *   再认 X + 「X 取消」「X -取消」「X取消」「X消失」。
 * 认不到配对的一律当瞬时动作。
 * ------------------------------------------------------------------ */

const CANCEL_SUFFIXES = [" 取消", " -取消", "取消"];
const VANISH_SUFFIX = "消失";
const ENTER_SUFFIX = "入场";

function isCancelName(name: string): boolean {
	return CANCEL_SUFFIXES.some(
		(suffix) => name.length > suffix.length && name.endsWith(suffix),
	);
}

function indexOfName(
	names: string[],
	target: string,
	used: Set<number>,
	self: number,
): number {
	for (let i = 0; i < names.length; i += 1) {
		if (i === self || used.has(i)) continue;
		if (names[i] === target) return i;
	}
	return -1;
}

function indexOfAny(
	names: string[],
	targets: string[],
	used: Set<number>,
	self: number,
): number {
	for (const target of targets) {
		const found = indexOfName(names, target, used, self);
		if (found !== -1) return found;
	}
	return -1;
}

function buildMotionItems(
	raw: { label: string; index: number }[],
): MotionItem[] {
	const names = raw.map((item) => item.label);
	const used = new Set<number>();
	const items: MotionItem[] = [];

	// 第一遍：翅膀入场 / 翅膀 / 翅膀消失 这种三件套合成一个「翅膀」开关
	for (let i = 0; i < names.length; i += 1) {
		if (used.has(i) || !names[i].endsWith(ENTER_SUFFIX)) continue;
		const base = names[i].slice(0, -ENTER_SUFFIX.length);
		if (!base) continue;
		const vanishIndex = indexOfName(names, base + VANISH_SUFFIX, used, i);
		if (vanishIndex === -1) continue;
		const bareIndex = indexOfName(names, base, used, i);
		if (bareIndex !== -1) used.add(bareIndex);
		used.add(i);
		used.add(vanishIndex);
		items.push({
			label: base,
			kind: "toggle",
			index: raw[i].index,
			offIndex: raw[vanishIndex].index,
		});
	}

	// 第二遍：X 与它的取消 / 消失动作配对
	for (let i = 0; i < names.length; i += 1) {
		if (used.has(i)) continue;
		const name = names[i];
		if (isCancelName(name)) continue;

		let offIndex = indexOfAny(
			names,
			CANCEL_SUFFIXES.map((suffix) => name + suffix),
			used,
			i,
		);
		if (offIndex === -1) {
			offIndex = indexOfName(names, name + VANISH_SUFFIX, used, i);
		}

		if (offIndex === -1) {
			used.add(i);
			items.push({ label: name, kind: "instant", index: raw[i].index });
			continue;
		}
		used.add(i);
		used.add(offIndex);
		items.push({
			label: name,
			kind: "toggle",
			index: raw[i].index,
			offIndex: raw[offIndex].index,
		});
	}

	// 第三遍：剩下没配上的（比如只有「取消」却找不到对应的开启动作）照常显示，
	// 别把动作悄悄吞掉
	for (let i = 0; i < names.length; i += 1) {
		if (used.has(i)) continue;
		used.add(i);
		items.push({ label: names[i], kind: "instant", index: raw[i].index });
	}

	return items;
}

function toggleKey(group: string, label: string): string {
	return `${group}:${label}`;
}

function actionLabel(item: MotionDefinition, index: number): string {
	if (item.Name) return item.Name;
	const file = item.File ?? "";
	const base = file.split("/").pop() ?? "";
	const name = base.replace(/\.motion3\.json$/i, "").replace(/\.mtn$/i, "");
	return name || `动作 ${index + 1}`;
}

async function initModel(): Promise<boolean> {
	const { widget } = els();
	if (!widget) return false;

	const pixi = getPixi();
	if (!pixi?.live2d) return false;

	const size = sizeOf();
	const resolution =
		config.resolution ?? Math.min(window.devicePixelRatio || 1, 2);

	destroyApp();

	const canvas = ensureCanvas(widget);
	state.app = new pixi.Application({
		view: canvas,
		width: size.width,
		height: size.height,
		backgroundAlpha: 0,
		antialias: true,
		resolution,
		autoDensity: true,
	});

	// 这个包没有进度回调，模型阶段的百分比是拿不到的，交给不确定态的转圈。
	// autoInteract 同时管「鼠标跟随」和「点击命中检测」，这个库没有提供
	// 只关其中一个的入口（unregisterInteraction 每帧都会被重新调用，关不住），
	// 所以直接用它当跟随开关。本模型没定义 HitAreas，命中检测本来就无效，
	// 点击一直走的是下面 canvas 的 click 兜底。
	const model = await pixi.live2d.Live2DModel.from(modelUrl, {
		autoInteract: config.interactive?.followCursor ?? true,
		motionPreload: "idle",
	});

	const fitScale = Math.min(
		size.width / model.width,
		size.height / model.height,
	);
	model.scale.set(fitScale);
	model.anchor.set(0.5, 0.5);
	model.x = size.width / 2;
	model.y = size.height / 2;
	state.app.stage.addChild(model);
	state.model = model;

	state.groups = readMotionGroups(model);
	// 模型是全新的，之前记的开关状态（拿剑、猫耳…）跟着一起作废
	state.toggleStates.clear();
	const preferred = config.interactive?.defaultMotionGroup ?? "TapShort";
	state.currentGroup = state.groups.some((g) => g.name === preferred)
		? preferred
		: (state.groups[0]?.name ?? "");

	model.on("hit", () => {
		state.lastHitAt = performance.now();
		if (!state.wasDragging) onModelTap();
		state.wasDragging = false;
	});

	setupDom();
	renderPanel();
	scheduleIdle();
	return true;
}

/** 面板里没有可选项时给个说法，别一直挂着「等待模型加载」 */
function renderPanelEmpty(message: string) {
	const { panelTabs, panelList } = els();
	panelTabs?.replaceChildren();
	if (!panelList) return;
	panelList.replaceChildren();
	const hint = document.createElement("span");
	hint.className = "live2d-motion-empty";
	hint.textContent = message;
	panelList.append(hint);
}

/* ------------------------------------------------------------------ *
 * 动作播放
 * ------------------------------------------------------------------ */

function playMotion(group: string, index?: number) {
	const model = state.model;
	if (!model) return;
	try {
		model.motion(group, index, 3);
		if (typeof index === "undefined") {
			model.expression();
		}
	} catch {
		/* 组不存在时静默忽略，面板只列模型真实拥有的组 */
	}
}

function onModelTap() {
	const messages = config.interactive?.clickMessages?.length
		? config.interactive.clickMessages
		: DEFAULT_CLICK_MESSAGES;
	const message = messages[Math.floor(Math.random() * messages.length)];
	window.showModelMessage?.(message, {
		containerId: "live2d-widget",
		displayTime: config.interactive?.messageDisplayTime ?? 3000,
	});

	playMotion(state.currentGroup);
	scheduleIdle();
}

function clearIdle() {
	if (state.idleTimer) {
		window.clearTimeout(state.idleTimer);
		state.idleTimer = 0;
	}
}

function scheduleIdle() {
	clearIdle();
	if (!state.model || !state.widgetVisible) return;

	const min = config.interactive?.idleIntervalMin ?? 15000;
	const max = config.interactive?.idleIntervalMax ?? 30000;
	const delay = min + Math.random() * Math.max(0, max - min);

	state.idleTimer = window.setTimeout(() => {
		if (state.model && state.widgetVisible) {
			playMotion(config.interactive?.idleMotionGroup ?? "Idle", 0);
		}
		scheduleIdle();
	}, delay);
}

/* ------------------------------------------------------------------ *
 * 动作面板
 * ------------------------------------------------------------------ */

function renderPanel() {
	const { panelTabs, panelList } = els();
	if (!panelTabs || !panelList) return;

	if (state.groups.length === 0) {
		renderPanelEmpty("这个模型没有可播放的动作");
		return;
	}

	panelTabs.replaceChildren();
	for (const group of state.groups) {
		const tab = document.createElement("button");
		tab.type = "button";
		tab.className = "live2d-tab";
		tab.textContent = group.label;
		tab.dataset.group = group.name;
		tab.setAttribute("aria-pressed", String(group.name === state.currentGroup));
		if (group.name === state.currentGroup) tab.classList.add("is-active");
		panelTabs.append(tab);
	}

	renderMotionList(state.currentGroup);
}

function renderMotionList(groupName: string) {
	const { panelList } = els();
	if (!panelList) return;

	const group = state.groups.find((item) => item.name === groupName);
	panelList.replaceChildren();
	if (!group) return;

	for (const item of group.items) {
		const chip = document.createElement("button");
		chip.type = "button";
		chip.className = "live2d-motion-chip";
		chip.textContent = item.label;
		chip.dataset.group = group.name;
		chip.dataset.index = String(item.index);

		if (item.kind === "toggle") {
			chip.classList.add("is-toggle");
			chip.dataset.offIndex = String(item.offIndex ?? item.index);
			const on =
				state.toggleStates.get(toggleKey(group.name, item.label)) === true;
			chip.classList.toggle("active", on);
			chip.setAttribute("aria-pressed", String(on));
		}

		panelList.append(chip);
	}
}

function togglePanel(open?: boolean) {
	const { panel, motionBtn } = els();
	if (!panel || !motionBtn) return;
	const next = open ?? !panel.classList.contains("is-open");
	if (next) positionPanel();
	panel.classList.toggle("is-open", next);
	// 面板打开期间按钮保持青色，跟面板的显示状态对上
	motionBtn.classList.toggle("active", next);
	motionBtn.setAttribute("aria-expanded", String(next));
}

/** 面板默认贴模型右侧，右边塞不下就翻到左侧 */
function positionPanel() {
	const { widget, panel } = els();
	if (!widget || !panel) return;
	const rect = widget.getBoundingClientRect();
	const width = panel.offsetWidth || PANEL_WIDTH;
	panel.classList.toggle(
		"is-flipped",
		rect.right + PANEL_GAP + width > window.innerWidth,
	);
}

/* ------------------------------------------------------------------ *
 * 显隐
 * ------------------------------------------------------------------ */

function updateTrigger(show: boolean) {
	els().trigger?.classList.toggle("visible", show);
}

function applyHiddenState() {
	const { widget } = els();
	if (widget) {
		widget.style.visibility = "hidden";
		widget.style.pointerEvents = "none";
	}
	state.widgetVisible = false;
	clearIdle();
	state.app?.ticker.stop();
	updateTrigger(true);
}

function applyVisibleState() {
	const { widget, author, infoBtn } = els();
	if (!widget) return;
	widget.style.visibility = "";
	widget.style.pointerEvents = "";
	widget.style.opacity = "";
	widget.style.transform = "";
	widget.classList.remove("live2d-initial", "live2d-dismissing");
	widget.classList.add("live2d-ready");
	state.widgetVisible = true;
	// 作者署名的可见性尊重用户上一次的选择
	if (author && config.author) {
		author.classList.toggle("visible", !state.authorHidden);
	}
	if (infoBtn) {
		infoBtn.classList.toggle("active", !state.authorHidden);
		infoBtn.setAttribute("aria-pressed", String(!state.authorHidden));
	}
	state.app?.ticker.start();
	state.app?.render();
	scheduleIdle();
}

function readVisibilityCache(): string | null {
	try {
		return localStorage.getItem(STORAGE_KEYS.visibility);
	} catch {
		return null;
	}
}

function writeVisibilityCache(visible: boolean) {
	try {
		localStorage.setItem(
			STORAGE_KEYS.visibility,
			visible ? "visible" : "hidden",
		);
	} catch {
		/* 隐私模式下写不进去，不影响本次会话 */
	}
}

function shouldStartHidden(): boolean {
	const cached = readVisibilityCache();
	if (cached) return cached === "hidden";
	return config.defaultVisible === false;
}

function readPositionCache(): {
	left: number | null;
	top: number | null;
} | null {
	try {
		const raw = localStorage.getItem(STORAGE_KEYS.position);
		if (!raw) return null;
		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed !== "object" || parsed === null) return null;
		const { left, top } = parsed as { left?: unknown; top?: unknown };
		return {
			left: typeof left === "number" && Number.isFinite(left) ? left : null,
			top: typeof top === "number" && Number.isFinite(top) ? top : null,
		};
	} catch {
		return null;
	}
}

function writePositionCache(left: number, top: number) {
	try {
		localStorage.setItem(STORAGE_KEYS.position, JSON.stringify({ left, top }));
	} catch {
		/* 忽略存储错误 */
	}
}

/** 只认数字，0 是合法坐标 —— 旧实现的 `if (pos.left)` 会把左上角位置丢掉 */
function restorePosition() {
	const { widget } = els();
	if (!widget) return;
	const cached = readPositionCache();
	if (!cached) return;
	if (cached.left !== null) {
		widget.style.left = `${cached.left}px`;
		widget.style.right = "auto";
	}
	if (cached.top !== null) {
		widget.style.top = `${cached.top}px`;
		widget.style.bottom = "auto";
	}
}

async function showWidget(): Promise<void> {
	if (state.transitioning || state.loading) return;
	const { widget } = els();
	if (!widget) return;

	state.transitioning = true;
	state.intentVisible = true;
	try {
		updateTrigger(false);
		widget.style.visibility = "";
		widget.style.pointerEvents = "";

		// 模型已经在跑，直接恢复渲染即可
		if (state.app && state.model) {
			applyVisibleState();
			writeVisibilityCache(true);
			restorePosition();
			return;
		}

		await loadAndMount();
		// 加载期间用户可能点了关闭，这时别再把它亮出来
		if (state.app && state.model && state.intentVisible) {
			applyVisibleState();
			writeVisibilityCache(true);
			restorePosition();
		} else if (!state.app || !state.model) {
			updateTrigger(true);
		}
	} finally {
		state.transitioning = false;
	}
}

async function hideWidget(): Promise<void> {
	if (state.transitioning) return;
	const { widget, author } = els();
	if (!widget) return;

	state.transitioning = true;
	state.intentVisible = false;
	try {
		window.clearModelMessage?.();
		author?.classList.remove("visible");
		togglePanel(false);
		state.app?.ticker.stop();
		clearIdle();

		const rect = widget.getBoundingClientRect();
		writePositionCache(rect.left, rect.top);

		// 坠落 + 滑出合成一段动画：旧实现拆成两个 class 依次播放，
		// 中间元素会弹回 translateY(0) 再跳到 fall-distance，肉眼可见地抖一下
		const distanceToBottom = window.innerHeight - rect.bottom;
		widget.style.setProperty("--fall-distance", `${distanceToBottom}px`);
		widget.classList.add("live2d-dismissing");
		await sleep(700);

		widget.classList.remove("live2d-dismissing");
		applyHiddenState();
		writeVisibilityCache(false);
	} finally {
		state.transitioning = false;
	}
}

/** 加载脚本 + 模型，全程驱动加载动效；失败时把重试入口交给用户 */
async function loadAndMount(): Promise<void> {
	if (state.loading) return;
	state.loading = true;
	showLoader("准备加载");

	const timeout = config.loadTimeout ?? 45000;
	try {
		await withTimeout(ensureResources(), timeout, "运行时加载超时");
		beginIndeterminate("加载模型中");
		const ok = await withTimeout(initModel(), timeout, "模型加载超时");
		if (!ok) throw new Error("模型初始化失败");
		setProgress(1, "加载完成");
		hideLoader();
	} catch (error) {
		hideLoader();
		showLoadError(error instanceof Error ? error.message : "加载失败");
	} finally {
		state.loading = false;
	}
}

function withTimeout<T>(
	promise: Promise<T>,
	timeout: number,
	message: string,
): Promise<T> {
	return new Promise((resolve, reject) => {
		const timer = window.setTimeout(() => reject(new Error(message)), timeout);
		promise.then(
			(value) => {
				window.clearTimeout(timer);
				resolve(value);
			},
			(error) => {
				window.clearTimeout(timer);
				reject(error instanceof Error ? error : new Error(message));
			},
		);
	});
}

/* ------------------------------------------------------------------ *
 * 拖拽
 * ------------------------------------------------------------------ */

function setupDrag(widget: HTMLElement) {
	if (state.dragSetup || !state.abort) return;
	state.dragSetup = true;
	const signal = state.abort.signal;

	const DRAG_THRESHOLD = 5;
	let dragging = false;
	let moved = false;
	let startPointer = { x: 0, y: 0 };
	let startRect = { x: 0, y: 0 };
	let frame = 0;
	let pending = { x: 0, y: 0 };

	const isInteractiveTarget = (target: EventTarget | null) =>
		target instanceof Element &&
		target.closest(".live2d-toolbar, .live2d-motion-panel, .live2d-author");

	widget.addEventListener(
		"mousedown",
		(event) => {
			if (event.button !== 0) return;
			if (isInteractiveTarget(event.target)) return;
			dragging = true;
			moved = false;
			startPointer = { x: event.clientX, y: event.clientY };
			const rect = widget.getBoundingClientRect();
			startRect = { x: rect.left, y: rect.top };
			widget.classList.add("is-dragging");
			event.preventDefault();
		},
		{ signal },
	);

	document.addEventListener(
		"mousemove",
		(event) => {
			if (!dragging) return;
			const dx = event.clientX - startPointer.x;
			const dy = event.clientY - startPointer.y;
			if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
				moved = true;
			}
			const maxX = window.innerWidth - widget.offsetWidth;
			const maxY = window.innerHeight - widget.offsetHeight;
			pending = {
				x: Math.max(0, Math.min(startRect.x + dx, maxX)),
				y: Math.max(0, Math.min(startRect.y + dy, maxY)),
			};
			if (!frame) {
				frame = requestAnimationFrame(() => {
					frame = 0;
					widget.style.left = `${pending.x}px`;
					widget.style.top = `${pending.y}px`;
					widget.style.right = "auto";
					widget.style.bottom = "auto";
				});
			}
		},
		{ signal },
	);

	document.addEventListener(
		"mouseup",
		() => {
			if (!dragging) return;
			dragging = false;
			widget.classList.remove("is-dragging");
			if (frame) {
				cancelAnimationFrame(frame);
				frame = 0;
			}
			if (moved) {
				state.wasDragging = true;
				const rect = widget.getBoundingClientRect();
				writePositionCache(rect.left, rect.top);
			}
		},
		{ signal },
	);

	window.addEventListener(
		"resize",
		() => {
			const rect = widget.getBoundingClientRect();
			const maxX = window.innerWidth - widget.offsetWidth;
			const maxY = window.innerHeight - widget.offsetHeight;
			if (rect.left > maxX) {
				widget.style.left = `${Math.max(0, maxX)}px`;
			}
			if (rect.top > maxY) {
				widget.style.top = `${Math.max(0, maxY)}px`;
			}
		},
		{ signal },
	);
}

/* ------------------------------------------------------------------ *
 * DOM 事件
 * ------------------------------------------------------------------ */

function setupDom() {
	if (state.domSetup || !state.abort) return;
	state.domSetup = true;
	const signal = state.abort.signal;
	const el = els();

	el.widget?.addEventListener(
		"click",
		(event) => {
			if (!(event.target instanceof Element)) return;

			if (event.target.closest("#live2d-panel-close-btn")) {
				togglePanel(false);
				return;
			}
			if (event.target.closest("#live2d-reset-btn")) {
				void resetMotions();
				return;
			}

			// 选完动作面板保持打开，方便连着试下一个；只有点面板外面才收起
			const chip = event.target.closest<HTMLElement>(".live2d-motion-chip");
			if (chip?.dataset.group) {
				handleMotionChip(chip);
				return;
			}

			const tab = event.target.closest<HTMLElement>(".live2d-tab");
			if (tab?.dataset.group) {
				selectGroup(tab.dataset.group);
				return;
			}

			if (event.target.closest("#live2d-motion-btn")) {
				togglePanel();
				return;
			}
			if (event.target.closest("#live2d-info-btn")) {
				state.authorHidden = !state.authorHidden;
				const visible = !state.authorHidden;
				el.author?.classList.toggle("visible", visible);
				el.infoBtn?.classList.toggle("active", visible);
				el.infoBtn?.setAttribute("aria-pressed", String(visible));
				return;
			}
			if (event.target.closest("#live2d-close-btn")) {
				void hideWidget();
				return;
			}
			if (event.target.closest("#live2d-retry")) {
				void retryLoad();
				return;
			}

			// 点到画布：如果 model 的 hit 刚刚已经处理过，这里就别再播一次
			if (event.target.closest("canvas")) {
				if (performance.now() - state.lastHitAt < HIT_DEDUPE_WINDOW) return;
				if (state.wasDragging) {
					state.wasDragging = false;
					return;
				}
				onModelTap();
			}
		},
		{ signal },
	);

	el.trigger?.addEventListener("click", () => void showWidget(), { signal });
	el.trigger?.addEventListener(
		"keydown",
		(event) => {
			if (event.key === "Enter" || event.key === " ") {
				event.preventDefault();
				void showWidget();
			}
		},
		{ signal },
	);

	// 面板外点击 / Esc 关闭
	document.addEventListener(
		"click",
		(event) => {
			const { panel, widget } = els();
			if (!panel?.classList.contains("is-open")) return;
			if (!(event.target instanceof Element)) return;
			if (event.target.closest("#live2d-motion-panel, #live2d-motion-btn"))
				return;
			if (widget && event.target.closest("#live2d-widget")) return;
			togglePanel(false);
		},
		{ signal },
	);

	document.addEventListener(
		"keydown",
		(event) => {
			if (event.key === "Escape") togglePanel(false);
		},
		{ signal },
	);

	window.addEventListener(
		"resize",
		() => {
			if (els().panel?.classList.contains("is-open")) positionPanel();
		},
		{ signal },
	);

	// 切标签页时停渲染省电
	document.addEventListener(
		"visibilitychange",
		() => {
			if (document.hidden) pauseRendering();
			else resumeRendering();
		},
		{ signal },
	);

	// 进 bfcache 只暂停不销毁，回来还能接着用；真要卸载了才 cleanup。
	// 旧实现把 cleanup 挂在 beforeunload 上，从 bfcache 回退时脚本已被
	// data-swup-ignore-script 挡住不会重跑，等于把 Live2D 一次性弄死。
	window.addEventListener(
		"pagehide",
		(event) => {
			if (event.persisted) pauseRendering();
			else cleanup();
		},
		{ signal },
	);
	window.addEventListener(
		"pageshow",
		(event) => {
			if (event.persisted) resumeRendering();
		},
		{ signal },
	);

	if (el.widget) setupDrag(el.widget);
}

function selectGroup(groupName: string) {
	state.currentGroup = groupName;
	const { panelTabs } = els();
	for (const tab of panelTabs?.querySelectorAll<HTMLElement>(".live2d-tab") ??
		[]) {
		const active = tab.dataset.group === groupName;
		tab.classList.toggle("is-active", active);
		tab.setAttribute("aria-pressed", String(active));
	}
	renderMotionList(groupName);
	playMotion(groupName);
}

/** 瞬时动作播一次；开关动作在两个索引之间来回切，并记住当前是开是关 */
function handleMotionChip(chip: HTMLElement) {
	const group = chip.dataset.group;
	if (!group) return;
	const index = Number(chip.dataset.index);

	if (!chip.classList.contains("is-toggle")) {
		playMotion(group, index);
		return;
	}

	const key = toggleKey(group, chip.textContent ?? "");
	const nextOn = state.toggleStates.get(key) !== true;
	state.toggleStates.set(key, nextOn);
	playMotion(group, nextOn ? index : Number(chip.dataset.offIndex));
	chip.classList.toggle("active", nextOn);
	chip.setAttribute("aria-pressed", String(nextOn));
}

/**
 * 重置：把当前处于「开」的开关动作逐个关掉（拿剑、猫耳、翅膀…），最后回到待机。
 * 动作之间互相打断，得错开一点播，挤在一起只有最后一个生效。
 */
async function resetMotions() {
	if (!state.model) return;

	const opened: Array<{ group: string; item: MotionItem }> = [];
	for (const group of state.groups) {
		for (const item of group.items) {
			if (item.kind !== "toggle") continue;
			if (state.toggleStates.get(toggleKey(group.name, item.label)) === true) {
				opened.push({ group: group.name, item });
			}
		}
	}

	// 先清状态和界面，让按钮马上回到未选中
	state.toggleStates.clear();
	renderMotionList(state.currentGroup);

	for (const entry of opened) {
		playMotion(entry.group, entry.item.offIndex ?? entry.item.index);
		await sleep(260);
	}

	playMotion(config.interactive?.idleMotionGroup ?? "Idle", 0);
	scheduleIdle();
}

async function retryLoad() {
	state.intentVisible = true;
	await loadAndMount();
	if (state.app && state.model) applyVisibleState();
}

/* ------------------------------------------------------------------ *
 * 生命周期
 * ------------------------------------------------------------------ */

function pauseRendering() {
	state.app?.ticker.stop();
	clearIdle();
}

function resumeRendering() {
	if (!state.widgetVisible || !state.app) return;
	state.app.ticker.start();
	state.app.render();
	scheduleIdle();
}

function cleanup() {
	clearIdle();
	destroyApp();
	state.abort?.abort();
	state.abort = null;
	state.domSetup = false;
	state.dragSetup = false;
	state.initialized = false;
	state.initializing = false;
}

export function initLive2DWidget(rawConfig: string): void {
	const widget = document.getElementById("live2d-widget");
	if (!widget) return;
	// module script 理论上只跑一次，这里兜住任何意外的重复注入
	if (state.initialized || state.initializing) return;

	let parsed: Live2DModelConfig & { modelPath: string };
	try {
		parsed = JSON.parse(rawConfig);
	} catch {
		return;
	}
	config = parsed;
	modelUrl = parsed.modelPath;
	if (!modelUrl) return;

	// 进入即置位：旧实现把它放在 await 之后，导航插进来就会二次初始化
	state.initializing = true;
	state.abort = new AbortController();
	setupDom();

	if (window.innerWidth <= 768) {
		state.initialized = true;
		return;
	}

	warmUpConnections();

	if (shouldStartHidden()) {
		applyHiddenState();
		state.initialized = true;
		return;
	}

	state.widgetVisible = true;
	state.intentVisible = true;
	void loadAndMount()
		.then(() => {
			if (state.app && state.model && state.intentVisible) {
				applyVisibleState();
				restorePosition();
			} else if (!state.app || !state.model) {
				updateTrigger(true);
			}
		})
		.finally(() => {
			state.initialized = true;
		});
}
