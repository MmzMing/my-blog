const TARGET_PIXEL_SIZE = 48;
const MAX_PIXEL_COUNT = 84;
const REVEAL_DURATION = 680;
const PIXEL_DURATION = 300;
const REVEAL_FINISH_BUFFER = 34;

function getGridSize(width: number, height: number) {
	let pixelSize = TARGET_PIXEL_SIZE;
	let columns = Math.max(1, Math.ceil(width / pixelSize));
	let rows = Math.max(1, Math.ceil(height / pixelSize));

	if (columns * rows > MAX_PIXEL_COUNT) {
		pixelSize *= Math.sqrt((columns * rows) / MAX_PIXEL_COUNT);
		columns = Math.max(1, Math.ceil(width / pixelSize));
		rows = Math.max(1, Math.ceil(height / pixelSize));
	}

	return { columns, rows };
}

function getRandomOrder(index: number, total: number): number {
	const value = Math.sin((index + 1) * 127.1 + total * 311.7) * 43758.5453;
	return value - Math.floor(value);
}

function setImageVisible(host: HTMLElement, overlay: HTMLElement | null) {
	overlay?.replaceChildren();
	host.classList.remove("is-loading", "is-revealing");
	host.classList.add("is-revealed");
	window.requestAnimationFrame(() => host.classList.remove("is-revealed"));
}

function finishPixelReveal(
	host: HTMLElement,
	overlay: HTMLElement,
	token: string,
) {
	if (!host.isConnected || host.dataset.imagePixelRevealToken !== token) return;

	// Keep the completed pixel layer in place while the decoded source image
	// becomes visible beneath it. This prevents a final-frame brightness flash.
	host.classList.remove("is-loading");
	host.classList.add("is-revealed");
	window.requestAnimationFrame(() => {
		if (!host.isConnected || host.dataset.imagePixelRevealToken !== token)
			return;
		window.requestAnimationFrame(() => {
			if (!host.isConnected || host.dataset.imagePixelRevealToken !== token)
				return;
			overlay.replaceChildren();
			host.classList.remove("is-revealing");
			window.requestAnimationFrame(() => {
				if (host.dataset.imagePixelRevealToken === token) {
					host.classList.remove("is-revealed");
				}
			});
		});
	});
}

/**
 * Reveals an already-loaded image through a bounded grid of image-backed tiles.
 * The source image remains hidden until the tile animation completes.
 */
export async function revealImageWithPixels(
	host: HTMLElement,
	image: HTMLImageElement,
) {
	if (!host.classList.contains("is-loading")) return;

	const overlay = host.querySelector<HTMLElement>("[data-image-pixel-reveal]");
	const token = String((Number(host.dataset.imagePixelRevealToken) || 0) + 1);
	host.dataset.imagePixelRevealToken = token;
	const source = image.currentSrc || image.src;

	try {
		if (typeof image.decode === "function") {
			await image.decode().catch(() => undefined);
		}

		if (
			!host.isConnected ||
			host.dataset.imagePixelRevealToken !== token ||
			(image.currentSrc || image.src) !== source
		) {
			return;
		}

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

		const { columns, rows } = getGridSize(width, height);
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

		window.setTimeout(() => {
			finishPixelReveal(host, overlay, token);
		}, REVEAL_DURATION + REVEAL_FINISH_BUFFER);
	} catch {
		if (host.dataset.imagePixelRevealToken === token) {
			setImageVisible(host, overlay);
		}
	}
}
