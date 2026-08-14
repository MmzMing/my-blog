export function initHomeHeroSticker(hero: HTMLElement) {
	const sticker = hero.querySelector<HTMLElement>("[data-hero-sticker]");
	const features = Array.from(
		sticker?.querySelectorAll<HTMLElement>("[data-hero-sticker-feature]") ?? [],
	);
	if (!sticker || features.length === 0) return () => undefined;

	const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
	const travelX = Number.parseFloat(sticker.dataset.eyeTravelX ?? "0");
	const travelY = Number.parseFloat(sticker.dataset.eyeTravelY ?? "0");
	const abortController = new AbortController();
	let currentX = 0;
	let currentY = 0;
	let targetX = 0;
	let targetY = 0;
	let animationFrame = 0;

	const render = () => {
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
		targetX = 0;
		targetY = 0;
		scheduleRender();
	};

	window.addEventListener(
		"pointermove",
		(event) => {
			if (reducedMotion.matches) return;
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
		abortController.abort();
		cancelAnimationFrame(animationFrame);
		features.forEach((feature) => {
			feature.style.removeProperty("--home-hero-feature-shift-x");
			feature.style.removeProperty("--home-hero-feature-shift-y");
		});
	};
}
