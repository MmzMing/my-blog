const DIGITS = ["4", "0", "4"];
const FIXED_STEP = 1 / 120;
const MAX_FRAME_DELTA = 1 / 20;
const GRAVITY = 1560;
const STAIR_RESTITUTION = 0.38;
const STAIR_TANGENTIAL_DAMPING = 0.986;
const MOBILE_QUERY = "(max-width: 768px)";
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

interface SceneGeometry {
	blockCount: number;
	blockWidth: number;
	height: number;
	maximumStairHeight: number;
	minimumStairHeight: number;
	scrollSpeed: number;
	width: number;
}

interface StairBlock {
	left: number;
	right: number;
	top: number;
}

interface Glyph {
	angularVelocity: number;
	element: HTMLSpanElement;
	radius: number;
	rotation: number;
	vx: number;
	vy: number;
	x: number;
	y: number;
}

function randomBetween(minimum: number, maximum: number) {
	return minimum + Math.random() * (maximum - minimum);
}

function createSceneGeometry(
	root: HTMLElement,
	isMobile: boolean,
): SceneGeometry {
	const { height: measuredHeight, width: measuredWidth } =
		root.getBoundingClientRect();
	const width = Math.max(measuredWidth, root.clientWidth, 1);
	const height = Math.max(measuredHeight, root.clientHeight, 1);
	const visibleBlockCount = isMobile ? 4 : 6;
	const blockWidth = width / visibleBlockCount;
	const minimumStairHeight = Math.max(28, height * (isMobile ? 0.11 : 0.12));
	const maximumStairHeight = Math.min(
		height * (isMobile ? 0.72 : 0.88),
		isMobile ? 450 : 720,
	);

	return {
		blockCount: visibleBlockCount + 4,
		blockWidth,
		height,
		maximumStairHeight,
		minimumStairHeight,
		scrollSpeed: blockWidth / (isMobile ? 3.5 : 3.4),
		width,
	};
}

function createStairBlocks(geometry: SceneGeometry, stairDistance: number) {
	const offset = stairDistance % geometry.blockWidth;
	const blocks: StairBlock[] = [];

	for (let index = 0; index < geometry.blockCount; index += 1) {
		const left = -geometry.blockWidth - offset + index * geometry.blockWidth;
		const right = left + geometry.blockWidth;
		const horizontalProgress = Math.min(
			1,
			Math.max(
				0,
				(geometry.width - (left + geometry.blockWidth * 0.5)) / geometry.width,
			),
		);
		const height =
			geometry.minimumStairHeight +
			horizontalProgress *
				(geometry.maximumStairHeight - geometry.minimumStairHeight);

		blocks.push({
			left,
			right,
			top: geometry.height - height,
		});
	}

	return blocks;
}

function resizeCanvas(
	canvas: HTMLCanvasElement,
	context: CanvasRenderingContext2D,
	geometry: SceneGeometry,
) {
	const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
	canvas.width = Math.max(1, Math.round(geometry.width * pixelRatio));
	canvas.height = Math.max(1, Math.round(geometry.height * pixelRatio));
	context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
}

function drawStairs(
	context: CanvasRenderingContext2D,
	geometry: SceneGeometry,
	blocks: StairBlock[],
	inkColor: string,
) {
	context.clearRect(0, 0, geometry.width, geometry.height);
	context.save();
	context.globalAlpha = 0.8;
	context.lineWidth = 1;
	context.lineCap = "square";
	context.lineJoin = "miter";
	context.strokeStyle = inkColor;

	for (const block of blocks) {
		if (block.right <= 0 || block.left >= geometry.width) continue;

		context.strokeRect(
			block.left + 0.5,
			block.top + 0.5,
			block.right - block.left,
			geometry.height - block.top,
		);
	}

	context.restore();
}

function removeGlyph(glyphs: Glyph[], index: number) {
	const [glyph] = glyphs.splice(index, 1);
	glyph?.element.remove();
}

function clearGlyphs(glyphs: Glyph[]) {
	for (const glyph of glyphs) {
		glyph.element.remove();
	}

	glyphs.length = 0;
}

function resolveStairCollision(
	glyph: Glyph,
	blocks: StairBlock[],
	previousBottom: number,
	minimumRollingSpeed: number,
) {
	if (glyph.vy <= 0) return false;

	const currentBottom = glyph.y + glyph.radius;
	let landingBlock: StairBlock | null = null;

	for (const block of blocks) {
		const overlapsHorizontally =
			glyph.x + glyph.radius > block.left &&
			glyph.x - glyph.radius < block.right;
		if (!overlapsHorizontally) continue;

		const crossesTop =
			previousBottom <= block.top + 1 && currentBottom >= block.top;
		const isPushedUpByGrowingStep =
			glyph.y < block.top && currentBottom >= block.top;
		if (!crossesTop && !isPushedUpByGrowingStep) continue;

		if (!landingBlock || block.top < landingBlock.top) landingBlock = block;
	}

	if (!landingBlock) return false;

	glyph.y = landingBlock.top - glyph.radius;
	const bouncedVelocity = -glyph.vy * STAIR_RESTITUTION;
	glyph.vy = bouncedVelocity;
	glyph.vx = Math.max(minimumRollingSpeed, glyph.vx * STAIR_TANGENTIAL_DAMPING);

	const targetAngularVelocity = (glyph.vx / glyph.radius) * (180 / Math.PI);
	glyph.angularVelocity +=
		(targetAngularVelocity - glyph.angularVelocity) * 0.3;

	return true;
}

function renderGlyphs(glyphs: Glyph[]) {
	for (const glyph of glyphs) {
		glyph.element.style.transform = `translate3d(${glyph.x.toFixed(2)}px, ${glyph.y.toFixed(2)}px, 0) rotate(${glyph.rotation.toFixed(2)}deg)`;
	}
}

export function mountNotFoundScene(root: HTMLElement) {
	const glyphLayer = root.querySelector<HTMLElement>(
		"[data-not-found-glyph-layer]",
	);
	const stairsCanvas = root.querySelector<HTMLCanvasElement>(
		"[data-not-found-stairs]",
	);
	if (!glyphLayer || !stairsCanvas) return () => {};

	const context = stairsCanvas.getContext("2d");
	if (!context) return () => {};

	const canvasContext: CanvasRenderingContext2D = context;
	const glyphLayerElement = glyphLayer;
	const stairsCanvasElement: HTMLCanvasElement = stairsCanvas;
	const abortController = new AbortController();
	const glyphs: Glyph[] = [];
	const mobileQuery = window.matchMedia(MOBILE_QUERY);
	const reducedMotionQuery = window.matchMedia(REDUCED_MOTION_QUERY);
	let accumulator = 0;
	let destroyed = false;
	let frameId: number | null = null;
	let geometry = createSceneGeometry(root, mobileQuery.matches);
	let inkColor = window.getComputedStyle(root).color;
	let lastFrameTime = 0;
	let spawnCountdown = 0.55;
	let stairBlocks = createStairBlocks(geometry, 0);
	let stairDistance = 0;

	function getGlyphCapacity() {
		return mobileQuery.matches ? 4 : 7;
	}

	function getNextSpawnDelay() {
		return mobileQuery.matches
			? randomBetween(2.5, 5.2)
			: randomBetween(1.7, 4.4);
	}

	function getSpawnBatchSize(availableSlots: number) {
		const maximumBatchSize = Math.min(
			availableSlots,
			mobileQuery.matches ? 2 : 3,
		);

		return Math.floor(randomBetween(1, maximumBatchSize + 1));
	}

	function getMinimumRollingSpeed() {
		return mobileQuery.matches ? 118 : 212;
	}

	function drawScene() {
		drawStairs(canvasContext, geometry, stairBlocks, inkColor);
	}

	function spawnGlyph() {
		const isMobile = mobileQuery.matches;
		const fontSize = isMobile
			? randomBetween(126, 186)
			: randomBetween(198, 288);
		const radius = fontSize * 0.42;
		const element = document.createElement("span");
		const character = document.createElement("span");

		element.className = "page-404__glyph";
		character.className = "page-404__glyph-character";
		character.textContent = DIGITS[Math.floor(Math.random() * DIGITS.length)];
		element.style.setProperty("--page-404-glyph-size", `${fontSize}px`);
		element.style.setProperty(
			"--page-404-glyph-stroke",
			`${Math.max(1.5, fontSize * 0.012).toFixed(2)}px`,
		);
		element.appendChild(character);
		glyphLayerElement.appendChild(element);

		glyphs.push({
			angularVelocity: randomBetween(-180, 180),
			element,
			radius,
			rotation: randomBetween(-32, 32),
			vx: isMobile ? randomBetween(124, 194) : randomBetween(224, 348),
			vy: randomBetween(28, 132),
			x: geometry.width * randomBetween(0.04, 0.17),
			y: -radius - randomBetween(16, geometry.height * 0.12),
		});
	}

	function updateGlyph(glyph: Glyph, delta: number) {
		const previousBottom = glyph.y + glyph.radius;

		glyph.vy += GRAVITY * delta;
		glyph.x += glyph.vx * delta;
		glyph.y += glyph.vy * delta;

		const isOnStair = resolveStairCollision(
			glyph,
			stairBlocks,
			previousBottom,
			getMinimumRollingSpeed(),
		);
		glyph.angularVelocity *= isOnStair ? 0.996 : 0.999;
		glyph.rotation += glyph.angularVelocity * delta;
	}

	function hasLeftScene(glyph: Glyph) {
		const margin = Math.max(glyph.radius, 72);

		return (
			glyph.x - glyph.radius > geometry.width + margin &&
			glyph.y - glyph.radius > geometry.height + margin
		);
	}

	function update(delta: number) {
		stairDistance += geometry.scrollSpeed * delta;
		stairBlocks = createStairBlocks(geometry, stairDistance);
		spawnCountdown -= delta;

		if (spawnCountdown <= 0) {
			const availableSlots = getGlyphCapacity() - glyphs.length;

			if (availableSlots > 0) {
				const batchSize = getSpawnBatchSize(availableSlots);
				for (let index = 0; index < batchSize; index += 1) {
					spawnGlyph();
				}

				spawnCountdown = getNextSpawnDelay();
			} else {
				spawnCountdown = 0.25;
			}
		}

		for (let index = glyphs.length - 1; index >= 0; index -= 1) {
			const glyph = glyphs[index];
			if (!glyph) continue;

			updateGlyph(glyph, delta);
			if (hasLeftScene(glyph)) removeGlyph(glyphs, index);
		}
	}

	function frame(timestamp: number) {
		frameId = null;
		if (destroyed || document.hidden || reducedMotionQuery.matches) return;

		const elapsed = Math.min(
			(timestamp - lastFrameTime) / 1000,
			MAX_FRAME_DELTA,
		);
		lastFrameTime = timestamp;
		accumulator += elapsed;

		while (accumulator >= FIXED_STEP) {
			update(FIXED_STEP);
			accumulator -= FIXED_STEP;
		}

		drawScene();
		renderGlyphs(glyphs);
		frameId = window.requestAnimationFrame(frame);
	}

	function start() {
		if (
			destroyed ||
			document.hidden ||
			reducedMotionQuery.matches ||
			frameId !== null
		)
			return;

		lastFrameTime = window.performance.now();
		frameId = window.requestAnimationFrame(frame);
	}

	function stop() {
		if (frameId !== null) window.cancelAnimationFrame(frameId);

		frameId = null;
		accumulator = 0;
	}

	function refreshGeometry() {
		const previousGeometry = geometry;
		const previousProgress =
			(stairDistance % previousGeometry.blockWidth) /
			previousGeometry.blockWidth;
		geometry = createSceneGeometry(root, mobileQuery.matches);
		stairDistance = previousProgress * geometry.blockWidth;
		stairBlocks = createStairBlocks(geometry, stairDistance);

		for (const glyph of glyphs) {
			glyph.x = (glyph.x / previousGeometry.width) * geometry.width;
			glyph.y = (glyph.y / previousGeometry.height) * geometry.height;
		}

		resizeCanvas(stairsCanvasElement, canvasContext, geometry);
		drawScene();
	}

	function trimGlyphs() {
		while (glyphs.length > getGlyphCapacity()) {
			removeGlyph(glyphs, glyphs.length - 1);
		}
	}

	function handleViewportChange() {
		trimGlyphs();
		refreshGeometry();
	}

	function handleVisibilityChange() {
		if (document.hidden) {
			stop();
			return;
		}

		start();
	}

	function handleMotionPreferenceChange() {
		clearGlyphs(glyphs);
		spawnCountdown = 0.55;
		drawScene();

		if (reducedMotionQuery.matches) {
			stop();
			return;
		}

		start();
	}

	function handleThemeChange() {
		inkColor = window.getComputedStyle(root).color;
		drawScene();
	}

	const resizeObserver = new ResizeObserver(refreshGeometry);
	const themeObserver = new MutationObserver(handleThemeChange);
	resizeObserver.observe(root);
	themeObserver.observe(document.documentElement, {
		attributeFilter: ["class"],
		attributes: true,
	});
	resizeCanvas(stairsCanvasElement, canvasContext, geometry);
	drawScene();
	document.addEventListener("visibilitychange", handleVisibilityChange, {
		signal: abortController.signal,
	});
	window.addEventListener("resize", refreshGeometry, {
		signal: abortController.signal,
	});
	mobileQuery.addEventListener("change", handleViewportChange, {
		signal: abortController.signal,
	});
	reducedMotionQuery.addEventListener("change", handleMotionPreferenceChange, {
		signal: abortController.signal,
	});
	start();

	return () => {
		destroyed = true;
		stop();
		resizeObserver.disconnect();
		themeObserver.disconnect();
		abortController.abort();
		clearGlyphs(glyphs);
	};
}
