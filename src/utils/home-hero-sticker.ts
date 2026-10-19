export function initHomeHeroSticker(root: HTMLElement | null): () => void {
	const sticker = root?.querySelector<HTMLElement>("[data-hero-sticker]");
	const features = Array.from(
		sticker?.querySelectorAll<HTMLElement>("[data-hero-sticker-feature]") ?? [],
	);
	if (!root || !sticker || features.length === 0) return () => undefined;

	const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
	const travelX = Number.parseFloat(sticker.dataset.eyeTravelX ?? "0");
	const travelY = Number.parseFloat(sticker.dataset.eyeTravelY ?? "0");
	const abortController = new AbortController();
	let stickerInView = false;
	let disposed = false;
	let currentX = 0;
	let currentY = 0;
	let targetX = 0;
	let targetY = 0;
	let animationFrame = 0;

	const canTrack = () =>
		!disposed &&
		stickerInView &&
		!reducedMotion.matches &&
		root.dataset.sceneVisible === "true";

	const stop = () => {
		cancelAnimationFrame(animationFrame);
		animationFrame = 0;
		currentX = 0;
		currentY = 0;
		targetX = 0;
		targetY = 0;
		features.forEach((feature) => {
			feature.style.removeProperty("--home-hero-feature-shift-x");
			feature.style.removeProperty("--home-hero-feature-shift-y");
		});
	};

	const render = () => {
		if (!canTrack()) {
			stop();
			return;
		}
		currentX += (targetX - currentX) * 0.16;
		currentY += (targetY - currentY) * 0.16;
		features.forEach((feature) => {
			const motionScale = Number.parseFloat(feature.dataset.motionScale ?? "1");
			const scale = Number.isFinite(motionScale) ? motionScale : 1;
			feature.style.setProperty(
				"--home-hero-feature-shift-x",
				`${(currentX * scale).toFixed(2)}px`,
			);
			feature.style.setProperty(
				"--home-hero-feature-shift-y",
				`${(currentY * scale).toFixed(2)}px`,
			);
		});
		if (
			Math.abs(targetX - currentX) > 0.01 ||
			Math.abs(targetY - currentY) > 0.01
		) {
			animationFrame = requestAnimationFrame(render);
			return;
		}
		animationFrame = 0;
	};

	const scheduleRender = () => {
		if (!animationFrame) animationFrame = requestAnimationFrame(render);
	};

	const reset = () => {
		if (!canTrack()) {
			stop();
			return;
		}
		targetX = 0;
		targetY = 0;
		scheduleRender();
	};

	// 场景隐藏和离开视口都即时取消插值，不等下一次 pointermove 才停。
	// 角色会跟着 sticky 浮到第二层，观察的是角色自身而不是 hero
	const stickerVisibility = new IntersectionObserver((entries) => {
		for (const entry of entries) stickerInView = entry.isIntersecting;
		if (!canTrack()) stop();
	});
	stickerVisibility.observe(sticker);
	const sceneVisibility = new MutationObserver(() => {
		if (!canTrack()) stop();
	});
	sceneVisibility.observe(root, {
		attributes: true,
		attributeFilter: ["data-scene-visible"],
	});

	window.addEventListener(
		"pointermove",
		(event) => {
			if (!canTrack()) return;
			const bounds = sticker.getBoundingClientRect();
			if (bounds.width === 0 || bounds.height === 0) return;
			const normalizedX =
				(event.clientX - (bounds.left + bounds.width / 2)) / (bounds.width / 2);
			const normalizedY =
				(event.clientY - (bounds.top + bounds.height / 2)) /
				(bounds.height / 2);
			const length = Math.max(1, Math.hypot(normalizedX, normalizedY));
			targetX = (normalizedX / length) * bounds.width * (travelX / 100);
			targetY = (normalizedY / length) * bounds.height * (travelY / 100);
			scheduleRender();
		},
		{ passive: true, signal: abortController.signal },
	);
	window.addEventListener("blur", reset, { signal: abortController.signal });
	document.addEventListener(
		"pointerout",
		(event) => {
			if (!event.relatedTarget) reset();
		},
		{ signal: abortController.signal },
	);
	reducedMotion.addEventListener("change", reset, {
		signal: abortController.signal,
	});

	return () => {
		disposed = true;
		stickerVisibility.disconnect();
		sceneVisibility.disconnect();
		abortController.abort();
		stop();
	};
}
