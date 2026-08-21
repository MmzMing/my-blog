const TARGET_PIXEL_SIZE = 48;
const DESKTOP_MAX_PIXEL_COUNT = 84;
const MOBILE_MAX_PIXEL_COUNT = 36;
const REVEAL_DURATION = 680;
const PIXEL_DURATION = 300;
const REVEAL_FINISH_BUFFER = 750;
const MOBILE_QUERY = "(max-width: 768px)";

export interface ImagePixelRevealOptions {
	signal?: AbortSignal;
}

export function getImagePixelGridSize(
	width: number,
	height: number,
	maxPixelCount: number,
) {
	let pixelSize = TARGET_PIXEL_SIZE;
	let columns = Math.max(1, Math.ceil(width / pixelSize));
	let rows = Math.max(1, Math.ceil(height / pixelSize));

	if (columns * rows > maxPixelCount) {
		pixelSize *= Math.sqrt((columns * rows) / maxPixelCount);
		columns = Math.max(1, Math.ceil(width / pixelSize));
		rows = Math.max(1, Math.ceil(height / pixelSize));
	}

	while (columns * rows > maxPixelCount) {
		if (columns >= rows && columns > 1) columns -= 1;
		else if (rows > 1) rows -= 1;
		else break;
	}

	return { columns, rows };
}

function getRandomOrder(index: number, total: number): number {
	const value = Math.sin((index + 1) * 127.1 + total * 311.7) * 43758.5453;
	return value - Math.floor(value);
}

function nextRevealToken(host: HTMLElement): string {
	const token = String((Number(host.dataset.imagePixelRevealToken) || 0) + 1);
	host.dataset.imagePixelRevealToken = token;
	return token;
}

function isCurrentReveal(host: HTMLElement, token: string): boolean {
	return host.isConnected && host.dataset.imagePixelRevealToken === token;
}

function setImageVisible(host: HTMLElement, overlay: HTMLElement | null): void {
	overlay?.replaceChildren();
	host.classList.remove("is-loading", "is-revealing");
	host.classList.add("is-revealed");
	window.requestAnimationFrame(() => host.classList.remove("is-revealed"));
}

export function cancelImagePixelReveal(host: HTMLElement): void {
	nextRevealToken(host);
	const overlay = host.querySelector<HTMLElement>("[data-image-pixel-reveal]");
	overlay?.replaceChildren();
	host.classList.remove("is-loading", "is-revealing", "is-revealed");
}

function waitForAnimationFrame(signal?: AbortSignal): Promise<boolean> {
	return new Promise((resolve) => {
		if (signal?.aborted) {
			resolve(false);
			return;
		}

		let frameId = 0;
		const finish = (completed: boolean) => {
			if (frameId) window.cancelAnimationFrame(frameId);
			signal?.removeEventListener("abort", handleAbort);
			resolve(completed);
		};
		const handleAbort = () => finish(false);

		signal?.addEventListener("abort", handleAbort, { once: true });
		frameId = window.requestAnimationFrame(() => finish(true));
	});
}

function waitForRevealAnimations(
	overlay: HTMLElement,
	total: number,
	signal?: AbortSignal,
): Promise<boolean> {
	return new Promise((resolve) => {
		if (signal?.aborted) {
			resolve(false);
			return;
		}

		const completedTiles = new Set<EventTarget>();
		let settled = false;
		let safetyTimer: ReturnType<typeof setTimeout> | undefined;

		const finish = (completed: boolean) => {
			if (settled) return;
			settled = true;
			if (safetyTimer !== undefined) clearTimeout(safetyTimer);
			overlay.removeEventListener("animationend", handleAnimationEnd);
			signal?.removeEventListener("abort", handleAbort);
			resolve(completed);
		};
		const handleAbort = () => finish(false);
		const handleAnimationEnd = (event: AnimationEvent) => {
			const target = event.target;
			if (
				event.animationName !== "image-pixel-reveal-in" ||
				!(target instanceof HTMLElement) ||
				!target.classList.contains("image-pixel-reveal__tile") ||
				completedTiles.has(target)
			) {
				return;
			}

			completedTiles.add(target);
			if (completedTiles.size >= total) finish(true);
		};

		overlay.addEventListener("animationend", handleAnimationEnd);
		signal?.addEventListener("abort", handleAbort, { once: true });
		safetyTimer = setTimeout(
			() => finish(true),
			REVEAL_DURATION + REVEAL_FINISH_BUFFER,
		);
	});
}

async function finishPixelReveal(
	host: HTMLElement,
	overlay: HTMLElement,
	token: string,
	signal?: AbortSignal,
): Promise<void> {
	if (!isCurrentReveal(host, token) || signal?.aborted) return;

	host.classList.remove("is-loading");
	host.classList.add("is-revealed");
	if (!(await waitForAnimationFrame(signal)) || !isCurrentReveal(host, token))
		return;
	if (!(await waitForAnimationFrame(signal)) || !isCurrentReveal(host, token))
		return;

	overlay.replaceChildren();
	host.classList.remove("is-revealing");
	if (!(await waitForAnimationFrame(signal)) || !isCurrentReveal(host, token))
		return;
	host.classList.remove("is-revealed");
}

/** Reveals a loaded image through a bounded grid of image-backed tiles. */
export async function revealImageWithPixels(
	host: HTMLElement,
	image: HTMLImageElement,
	options: ImagePixelRevealOptions = {},
): Promise<void> {
	if (!host.classList.contains("is-loading")) return;

	const { signal } = options;
	const overlay = host.querySelector<HTMLElement>("[data-image-pixel-reveal]");
	const token = nextRevealToken(host);
	const source = image.currentSrc || image.src;

	try {
		if (signal?.aborted || !isCurrentReveal(host, token)) return;
		if (
			!overlay ||
			window.matchMedia("(prefers-reduced-motion: reduce)").matches
		) {
			setImageVisible(host, overlay);
			return;
		}

		const { width, height } = host.getBoundingClientRect();
		if (!width || !height || !source) {
			setImageVisible(host, overlay);
			return;
		}

		const maxPixelCount = window.matchMedia(MOBILE_QUERY).matches
			? MOBILE_MAX_PIXEL_COUNT
			: DESKTOP_MAX_PIXEL_COUNT;
		const { columns, rows } = getImagePixelGridSize(
			width,
			height,
			maxPixelCount,
		);
		const tileWidth = width / columns;
		const tileHeight = height / rows;
		const naturalWidth = image.naturalWidth || width;
		const naturalHeight = image.naturalHeight || height;
		const scale = Math.max(width / naturalWidth, height / naturalHeight);
		const renderedWidth = naturalWidth * scale;
		const renderedHeight = naturalHeight * scale;
		const imageOffsetX = (width - renderedWidth) / 2;
		const imageOffsetY = (height - renderedHeight) / 2;
		const spread = REVEAL_DURATION - PIXEL_DURATION;
		const fragment = document.createDocumentFragment();
		const total = columns * rows;

		for (let row = 0; row < rows; row += 1) {
			for (let column = 0; column < columns; column += 1) {
				const index = row * columns + column;
				const left = column * tileWidth;
				const top = row * tileHeight;
				const tile = document.createElement("span");
				tile.className = "image-pixel-reveal__tile";
				tile.style.left = `${left}px`;
				tile.style.top = `${top}px`;
				tile.style.width = `${tileWidth + 0.5}px`;
				tile.style.height = `${tileHeight + 0.5}px`;
				tile.style.backgroundImage = `url(${JSON.stringify(source)})`;
				tile.style.backgroundSize = `${renderedWidth}px ${renderedHeight}px`;
				tile.style.backgroundPosition = `${imageOffsetX - left}px ${imageOffsetY - top}px`;
				tile.style.setProperty(
					"--image-pixel-reveal-delay",
					`${Math.round(getRandomOrder(index, total) * spread)}ms`,
				);
				fragment.append(tile);
			}
		}

		overlay.replaceChildren(fragment);
		host.classList.remove("is-loading", "is-revealed");
		host.classList.add("is-revealing");

		const completed = await waitForRevealAnimations(overlay, total, signal);
		if (!completed || signal?.aborted || !isCurrentReveal(host, token)) return;
		await finishPixelReveal(host, overlay, token, signal);
	} catch {
		if (host.dataset.imagePixelRevealToken === token) {
			setImageVisible(host, overlay);
		}
	}
}
