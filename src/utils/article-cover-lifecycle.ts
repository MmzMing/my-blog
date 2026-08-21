import {
	cancelImagePixelReveal,
	type ImagePixelRevealOptions,
	revealImageWithPixels,
} from "./image-pixel-reveal";

export const ARTICLE_COVER_SOURCE_TIMEOUT_MS = 8_000;
export const ARTICLE_COVER_DECODE_TIMEOUT_MS = 1_500;

export type ArticleCoverLifecycleState =
	| "idle"
	| "loading"
	| "loaded"
	| "decoding"
	| "revealing"
	| "ready"
	| "error"
	| "disposed";

type RevealImage = (
	host: HTMLElement,
	image: HTMLImageElement,
	options?: ImagePixelRevealOptions,
) => Promise<void>;

interface ArticleCoverLifecycleOptions {
	host: HTMLElement;
	image: HTMLImageElement;
	apiUrls?: string[];
	fallbackSrc?: string;
	baseUrl?: string;
	signal?: AbortSignal;
	sourceTimeoutMs?: number;
	decodeTimeoutMs?: number;
	reveal?: RevealImage;
	cancelReveal?: (host: HTMLElement) => void;
}

export interface ArticleCoverLifecycle {
	setVisible(visible: boolean): void;
	dispose(): void;
	getState(): ArticleCoverLifecycleState;
}

function normalizeSource(source: string, baseUrl: string): string | null {
	if (!source) return null;
	try {
		return new URL(source, baseUrl).href;
	} catch {
		return null;
	}
}

function prefersReducedMotion(): boolean {
	return (
		typeof window !== "undefined" &&
		window.matchMedia("(prefers-reduced-motion: reduce)").matches
	);
}

export function parseArticleCoverApiUrls(raw: string | undefined): string[] {
	try {
		const parsed = JSON.parse(raw || "[]");
		return Array.isArray(parsed)
			? parsed.filter((item): item is string => typeof item === "string")
			: [];
	} catch {
		return [];
	}
}

export function buildArticleCoverSourceQueue(
	initialSrc: string,
	apiUrls: string[],
	fallbackSrc: string | undefined,
	baseUrl: string,
): string[] {
	const sources: string[] = [];
	const seen = new Set<string>();

	for (const candidate of [initialSrc, ...apiUrls, fallbackSrc || ""]) {
		const normalized = normalizeSource(candidate, baseUrl);
		if (!normalized || seen.has(normalized)) continue;
		seen.add(normalized);
		sources.push(normalized);
	}

	return sources;
}

async function settleImageDecode(
	image: HTMLImageElement,
	timeoutMs: number,
	signal: AbortSignal,
): Promise<void> {
	if (signal.aborted || typeof image.decode !== "function") return;

	await new Promise<void>((resolve) => {
		let settled = false;
		let timer: ReturnType<typeof setTimeout> | undefined;

		const finish = () => {
			if (settled) return;
			settled = true;
			if (timer !== undefined) clearTimeout(timer);
			signal.removeEventListener("abort", finish);
			resolve();
		};

		signal.addEventListener("abort", finish, { once: true });
		timer = setTimeout(finish, timeoutMs);

		try {
			void image.decode().then(finish, finish);
		} catch {
			finish();
		}
	});
}

export function createArticleCoverLifecycle(
	options: ArticleCoverLifecycleOptions,
): ArticleCoverLifecycle {
	const {
		host,
		image,
		apiUrls = [],
		fallbackSrc,
		signal,
		sourceTimeoutMs = ARTICLE_COVER_SOURCE_TIMEOUT_MS,
		decodeTimeoutMs = ARTICLE_COVER_DECODE_TIMEOUT_MS,
		reveal = revealImageWithPixels,
		cancelReveal = cancelImagePixelReveal,
	} = options;
	const baseUrl =
		options.baseUrl ||
		(typeof document === "undefined" ? "http://localhost/" : document.baseURI);
	const sources = buildArticleCoverSourceQueue(
		image.src,
		apiUrls,
		fallbackSrc,
		baseUrl,
	);

	let state: ArticleCoverLifecycleState = "idle";
	let sourceIndex = sources.indexOf(normalizeSource(image.src, baseUrl) || "");
	let sourceVersion = 0;
	let operationVersion = 0;
	let visible = false;
	let revealed = false;
	let disposed = false;
	let sourceTimer: ReturnType<typeof setTimeout> | undefined;
	let revealController: AbortController | undefined;

	function setState(nextState: ArticleCoverLifecycleState): void {
		state = nextState;
	}

	function clearSourceTimer(): void {
		if (sourceTimer === undefined) return;
		clearTimeout(sourceTimer);
		sourceTimer = undefined;
	}

	function cancelActiveReveal(): void {
		operationVersion += 1;
		revealController?.abort();
		revealController = undefined;
		cancelReveal(host);
	}

	function showLoading(): void {
		host.classList.remove("is-error");
		host.classList.add("is-loading");
	}

	function finishWithError(): void {
		clearSourceTimer();
		cancelActiveReveal();
		setState("error");
		host.classList.remove("is-loading", "is-revealing", "is-revealed");
		host.classList.add("is-error");
	}

	function scheduleSourceTimeout(version: number): void {
		clearSourceTimer();
		if (!visible || disposed) return;
		sourceTimer = setTimeout(() => {
			if (disposed || !visible || version !== sourceVersion) return;
			advanceSource();
		}, sourceTimeoutMs);
	}

	function inspectCurrentSource(version: number): void {
		queueMicrotask(() => {
			if (disposed || version !== sourceVersion || !image.complete) return;
			if (image.naturalWidth > 0) handleImageLoad();
			else advanceSource();
		});
	}

	function advanceSource(): void {
		if (disposed || state === "ready" || state === "error") return;

		clearSourceTimer();
		cancelActiveReveal();
		sourceIndex += 1;
		sourceVersion += 1;

		const nextSource = sources[sourceIndex];
		if (!nextSource) {
			finishWithError();
			return;
		}

		setState("loading");
		if (visible) showLoading();
		image.src = nextSource;
		scheduleSourceTimeout(sourceVersion);
		inspectCurrentSource(sourceVersion);
	}

	async function decodeAndReveal(version: number): Promise<void> {
		if (
			disposed ||
			!visible ||
			revealed ||
			version !== sourceVersion ||
			state === "decoding" ||
			state === "revealing"
		) {
			return;
		}

		const expectedSource = normalizeSource(image.src, baseUrl);
		const operation = ++operationVersion;
		const activeController = new AbortController();
		revealController = activeController;
		setState("decoding");

		if (!prefersReducedMotion()) {
			await settleImageDecode(image, decodeTimeoutMs, activeController.signal);
		}
		if (
			disposed ||
			!visible ||
			activeController.signal.aborted ||
			operation !== operationVersion ||
			version !== sourceVersion ||
			normalizeSource(image.src, baseUrl) !== expectedSource
		) {
			return;
		}

		setState("revealing");
		try {
			await reveal(host, image, { signal: activeController.signal });
		} catch {
			cancelReveal(host);
		}

		if (
			disposed ||
			!visible ||
			activeController.signal.aborted ||
			operation !== operationVersion ||
			version !== sourceVersion
		) {
			return;
		}

		revealController = undefined;
		revealed = true;
		setState("ready");
		host.classList.remove("is-loading", "is-revealing", "is-error");
	}

	function handleImageLoad(): void {
		if (
			disposed ||
			state === "ready" ||
			state === "error" ||
			state === "decoding" ||
			state === "revealing"
		) {
			return;
		}
		clearSourceTimer();
		setState("loaded");
		if (visible) void decodeAndReveal(sourceVersion);
	}

	function handleImageError(): void {
		if (disposed || state === "ready" || state === "error") return;
		advanceSource();
	}

	function setVisible(nextVisible: boolean): void {
		if (disposed || visible === nextVisible) return;
		visible = nextVisible;

		if (!visible) {
			clearSourceTimer();
			host.classList.remove("is-loading");
			if (state === "decoding" || state === "revealing") {
				cancelActiveReveal();
				setState(
					image.complete && image.naturalWidth > 0 ? "loaded" : "loading",
				);
			}
			return;
		}

		if (state === "ready" || state === "error") return;
		showLoading();

		if (image.complete) {
			if (image.naturalWidth > 0) handleImageLoad();
			else advanceSource();
			return;
		}

		setState("loading");
		scheduleSourceTimeout(sourceVersion);
	}

	function dispose(): void {
		if (disposed) return;
		disposed = true;
		visible = false;
		clearSourceTimer();
		cancelActiveReveal();
		image.removeEventListener("load", handleImageLoad);
		image.removeEventListener("error", handleImageError);
		signal?.removeEventListener("abort", dispose);
		host.classList.remove(
			"is-loading",
			"is-revealing",
			"is-revealed",
			"is-error",
		);
		setState("disposed");
	}

	image.addEventListener("load", handleImageLoad);
	image.addEventListener("error", handleImageError);
	signal?.addEventListener("abort", dispose, { once: true });
	if (signal?.aborted) dispose();

	return {
		setVisible,
		dispose,
		getState: () => state,
	};
}
