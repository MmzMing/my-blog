const DEFAULT_HIDE_DELAY = 0;
const DEFAULT_MAX_WAIT = 8000;
/** waitForPageLoaderHidden 的兜底上限，比 DEFAULT_MAX_WAIT 更宽，正常路径不会走到 */
const DEFAULT_HIDDEN_WAIT = 10000;

export const LOADER_READY_EVENT = "firefly:page-loader-ready";
export const LOADER_HIDDEN_EVENT = "firefly:page-loader-hidden";

/* ========== 通用工具 ========== */

function delay(ms) {
	if (ms <= 0) return Promise.resolve();
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(promise, timeout) {
	return new Promise((resolve, reject) => {
		const timeoutId = setTimeout(resolve, timeout);
		promise.then(
			(value) => {
				clearTimeout(timeoutId);
				resolve(value);
			},
			(error) => {
				clearTimeout(timeoutId);
				reject(error);
			},
		);
	});
}

function dispatchDomEvent(documentRef, type, detail) {
	const CustomEventCtor = globalThis.CustomEvent;
	const event =
		typeof CustomEventCtor === "function"
			? new CustomEventCtor(type, { detail })
			: { type, detail };
	documentRef.dispatchEvent?.(event);
}

/* ========== 路径判断 ========== */

function isHomePath(pathname) {
	return pathname === "/" || pathname === "";
}

function isHomeUrl(targetUrl, windowRef) {
	if (!targetUrl) return false;
	try {
		const url = new URL(targetUrl, windowRef.location.href);
		return isHomePath(url.pathname);
	} catch {
		return false;
	}
}

function isInternalPageVisit(targetUrl, windowRef) {
	if (!targetUrl) return true;
	try {
		const url = new URL(targetUrl, windowRef.location.href);
		return (
			url.origin === windowRef.location.origin &&
			(url.pathname !== windowRef.location.pathname ||
				url.search !== windowRef.location.search)
		);
	} catch {
		return true;
	}
}

function getVisitUrl(visit) {
	const toUrl = visit?.to?.url;
	return Array.isArray(toUrl) ? toUrl[0] : toUrl;
}

/* ========== 页面就绪检测 ========== */

const SWUP_SCOPES =
	"#swup-container, #left-sidebar-dynamic, #right-sidebar-dynamic";

function collectPendingImages(documentRef) {
	const containers = documentRef.querySelectorAll(SWUP_SCOPES);
	const scope = containers.length > 0 ? [...containers] : [documentRef];
	const images = scope.flatMap((container) => [
		...container.querySelectorAll("img"),
	]);
	return images.filter((image) => {
		// 跳过尚未进入视口的懒加载图片，避免它们阻塞加载页隐藏
		if (image.loading === "lazy" && !image.complete) return false;
		return !image.complete;
	});
}

function waitForImage(image) {
	return new Promise((resolve) => {
		image.addEventListener("load", resolve, { once: true });
		image.addEventListener("error", resolve, { once: true });
	});
}

export function waitForBrowserPageReady({
	document: documentRef = document,
	maxWait = DEFAULT_MAX_WAIT,
} = {}) {
	const imageSettled = Promise.all(
		collectPendingImages(documentRef).map(waitForImage),
	);
	const fontsReady = documentRef.fonts?.ready ?? Promise.resolve();
	return withTimeout(Promise.all([imageSettled, fontsReady]), maxWait);
}

/* ========== DOM 状态应用 ========== */

function applyDomState(domContext, state) {
	const { document: documentRef, loader, window: windowRef } = domContext;
	const root = documentRef.documentElement;
	const body = documentRef.body;

	if (state === "visible") {
		loader.hidden = false;
		loader.classList.remove("page-loader--hidden");
		loader.classList.add("page-loader--visible");
		root.classList.add("is-page-loading");
		body?.setAttribute("aria-busy", "true");
		return;
	}

	loader.classList.remove("page-loader--visible");
	loader.classList.add("page-loader--hidden");
	root.classList.remove("is-page-loading");
	body?.removeAttribute("aria-busy");
	windowRef.setTimeout(() => {
		if (loader.classList.contains("page-loader--hidden")) {
			loader.hidden = true;
			dispatchDomEvent(documentRef, LOADER_HIDDEN_EVENT, {
				timestamp: Date.now(),
			});
		}
	}, DEFAULT_HIDE_DELAY);
}

/** 立即将 loader 置于隐藏状态并派发 hidden 事件（用于移动端 / 非首页初始态）。 */
function hideLoaderImmediately(domContext) {
	const { document: documentRef, loader } = domContext;
	loader.hidden = true;
	loader.classList.add("page-loader--hidden");
	loader.classList.remove("page-loader--visible");
	documentRef.documentElement.classList.remove("is-page-loading");
	documentRef.body?.removeAttribute("aria-busy");
	dispatchDomEvent(documentRef, LOADER_HIDDEN_EVENT, {
		timestamp: Date.now(),
	});
}

/* ========== 控制器 ========== */

export function createPageLoaderController({
	hideDelay = DEFAULT_HIDE_DELAY,
	onStateChange,
	waitForPageReady = () => Promise.resolve(),
} = {}) {
	let visible = false;
	let token = 0;

	function emit(state) {
		onStateChange?.(state);
	}

	function show() {
		token += 1;
		if (!visible) {
			visible = true;
			emit("visible");
		}
		return token;
	}

	async function hideWhenReady(reason) {
		const currentToken = token;
		await waitForPageReady({ reason, token: currentToken });
		await delay(hideDelay);
		if (currentToken !== token || !visible) return false;
		visible = false;
		emit("hidden");
		return true;
	}

	return {
		hideWhenReady,
		isVisible: () => visible,
		show,
	};
}

/* ========== 查询函数 ========== */

export function isPageLoaderVisible({ document: documentRef = document } = {}) {
	const loader = documentRef.getElementById("page-loader");
	return Boolean(
		loader &&
			!loader.hidden &&
			!loader.classList.contains("page-loader--hidden"),
	);
}

export function waitForPageLoaderHidden({
	document: documentRef = document,
	timeout = DEFAULT_HIDDEN_WAIT,
} = {}) {
	if (!isPageLoaderVisible({ document: documentRef })) return Promise.resolve();
	return new Promise((resolve) => {
		let timer;
		const settle = () => {
			documentRef.removeEventListener(LOADER_HIDDEN_EVENT, settle);
			if (timer !== undefined) clearTimeout(timer);
			resolve();
		};
		documentRef.addEventListener(LOADER_HIDDEN_EVENT, settle);
		// 加载页的显隐由 Swup 的 link:click / visit:start / content:replace → page:view
		// 这条链驱动：只要 show() 的 token 在 hideWhenReady() 取值之后又自增
		// （例如一次进首页的导航被下一次打断），hidden 事件就再也不会派发。
		// 没有上限的话，等它的调用方会被永久挂住 —— 首页数据层就会一直停在
		// data-guide-opening="pending"，标题与全部卡片被 CSS 的 visibility: hidden 按住。
		// 上限取得比 waitForBrowserPageReady 的 DEFAULT_MAX_WAIT 更宽，正常路径不会走到。
		timer = setTimeout(settle, timeout);
	});
}

/* ========== Swup 绑定 ========== */

function bindSwup({ controller, document: documentRef, window: windowRef }) {
	let isBound = false;

	function bind() {
		if (isBound || !windowRef.swup?.hooks) return;
		isBound = true;

		windowRef.swup.hooks.on("link:click", (_visit, { el } = {}) => {
			const href = el?.getAttribute?.("href");
			if (isInternalPageVisit(href, windowRef) && isHomeUrl(href, windowRef))
				controller.show("swup-link-click");
		});
		windowRef.swup.hooks.on("visit:start", (visit) => {
			if (isHomeUrl(getVisitUrl(visit), windowRef))
				controller.show("swup-visit-start");
		});
		windowRef.swup.hooks.on("content:replace", (visit) => {
			if (isHomeUrl(getVisitUrl(visit), windowRef))
				controller.show("swup-content-replace");
		});
		windowRef.swup.hooks.on("page:view", () => {
			void controller.hideWhenReady("swup-page-view");
		});
		windowRef.swup.hooks.on("visit:end", () => {
			void controller.hideWhenReady("swup-visit-end");
		});
	}

	bind();
	documentRef.addEventListener("swup:enable", bind, { once: true });
}

/* ========== 初始化 ========== */

function isMobile(windowRef) {
	return windowRef.matchMedia("(max-width: 768px)").matches;
}

export function initPageLoader({
	document: documentRef = document,
	window: windowRef = window,
} = {}) {
	if (windowRef.__fireflyPageLoader) return windowRef.__fireflyPageLoader;

	const loader = documentRef.getElementById("page-loader");
	if (!loader) return null;

	const domContext = { document: documentRef, loader, window: windowRef };

	// 移动端：完全跳过加载页
	if (isMobile(windowRef)) {
		hideLoaderImmediately(domContext);
		return null;
	}

	const controller = createPageLoaderController({
		onStateChange: (state) => applyDomState(domContext, state),
		waitForPageReady: () => waitForBrowserPageReady({ document: documentRef }),
	});
	windowRef.__fireflyPageLoader = controller;

	// 非首页：不显示初始加载页
	if (!isHomePath(windowRef.location.pathname)) {
		hideLoaderImmediately(domContext);
	} else {
		controller.show("initial");

		const hideInitialLoader = () => {
			windowRef.requestAnimationFrame(() => {
				void controller.hideWhenReady("window-load");
			});
		};

		if (documentRef.readyState === "complete") hideInitialLoader();
		else windowRef.addEventListener("load", hideInitialLoader, { once: true });
	}

	documentRef.addEventListener("astro:page-load", () => {
		documentRef.dispatchEvent(new CustomEvent(LOADER_READY_EVENT));
		void controller.hideWhenReady("astro-page-load");
	});

	bindSwup({ controller, document: documentRef, window: windowRef });

	return controller;
}
