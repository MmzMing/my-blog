type Gsap = typeof import("gsap")["gsap"];
type GsapTween = ReturnType<Gsap["fromTo"]>;

export function mountGalleryDetail(): () => void {
	const root = document.querySelector<HTMLElement>("[data-gallery-detail]");
	if (!root) return () => {};

	const abortController = new AbortController();
	const { signal } = abortController;
	const photos = Array.from(
		root.querySelectorAll<HTMLElement>("[data-gallery-photo]"),
	);
	let cleanupAnimations: (() => void) | undefined;

	for (const photo of photos) {
		const link = photo.querySelector<HTMLAnchorElement>(".gallery-photo__link");
		const image = photo.querySelector<HTMLImageElement>("img");
		if (!link || !image) continue;

		link.dataset.galleryImageState = "loading";
		const onError = (): void => {
			if (signal.aborted) return;
			link.dataset.galleryImageState = "error";
		};
		const onLoad = async (): Promise<void> => {
			try {
				await image.decode();
			} catch {
				// 解码取消不等于网络失败，仍以当前图片的有效尺寸为准。
			}
			if (signal.aborted) return;
			link.dataset.galleryImageState =
				image.naturalWidth > 0 ? "ready" : "error";
		};

		image.addEventListener("load", onLoad, { once: true, signal });
		image.addEventListener("error", onError, { once: true, signal });
		if (image.complete) {
			if (image.naturalWidth > 0) void onLoad();
			else onError();
		}
	}

	if (photos.length > 0) {
		void import("gsap")
			.then(({ gsap }) => {
				if (signal.aborted) return;
				const media = gsap.matchMedia();
				cleanupAnimations = () => media.revert();
				media.add(
					{
						desktop: "(min-width: 768px)",
						motion: "(prefers-reduced-motion: no-preference)",
					},
					(context) => {
						if (!context.conditions?.motion) return;
						const isDesktop = Boolean(context.conditions.desktop);
						const tweens = new Map<Element, GsapTween>();

						for (const [index, photo] of photos.entries()) {
							const link = photo.querySelector<HTMLElement>(
								".gallery-photo__link",
							);
							const parent = photo.parentElement;
							if (!link || !parent) continue;

							const bounds = photo.getBoundingClientRect();
							const parentBounds = parent.getBoundingClientRect();
							const offset =
								bounds.left +
								bounds.width / 2 -
								(parentBounds.left + parentBounds.width / 2);
							const isCenter = Math.abs(offset) < bounds.width / 4;
							const direction = isCenter ? 0 : Math.sign(offset);
							// 中间列没有左右位移，用相邻照片交替的轻微倾斜补足入场方向。
							const rotation = isCenter
								? (index % 2 === 0 ? 1 : -1) * (isDesktop ? 2.5 : 1)
								: direction * (isDesktop ? 4 : 1.5);
							const tween = gsap.fromTo(
								link,
								{
									x: direction * bounds.width * (isDesktop ? 0.2 : 0.06),
									y: isDesktop ? 120 : 40,
									rotation,
									scale: isDesktop ? 0.92 : 0.97,
									opacity: 0.25,
								},
								{
									x: 0,
									y: 0,
									rotation: 0,
									scale: 1,
									opacity: 1,
									duration: isDesktop ? 0.7 : 0.45,
									ease: "power2.out",
									immediateRender: true,
									paused: true,
									clearProps: "transform,opacity",
								},
							);
							// 首屏可见的照片直接定格在完成态，只有后续滚动才重播。
							if (bounds.top < window.innerHeight) tween.progress(1).pause();
							tweens.set(photo, tween);
						}

						const initialReports = new Set<Element>(tweens.keys());
						const observer = new IntersectionObserver(
							(entries) => {
								if (signal.aborted) return;
								for (const entry of entries) {
									const tween = tweens.get(entry.target);
									if (!tween) continue;
									// 初始状态已在建 tween 时定好；避免底部触发区内的首屏照片被误散开。
									if (initialReports.delete(entry.target)) continue;
									if (entry.isIntersecting) {
										if (tween.progress() < 1) tween.play();
										continue;
									}
									// 从顶部离开保持完成态；退回下方触发线时倒放散开。
									// 触发线在视口 70% 高度处，照片仍大面积可见时就会散开。
									const belowViewport =
										entry.boundingClientRect.top >=
										(entry.rootBounds?.bottom ?? window.innerHeight);
									if (belowViewport && tween.progress() > 0) tween.reverse();
								}
							},
							{ rootMargin: "0px 0px -30% 0px" },
						);
						for (const photo of photos) observer.observe(photo);
						return () => observer.disconnect();
					},
					root,
				);
			})
			.catch((error: unknown) => {
				cleanupAnimations?.();
				cleanupAnimations = undefined;
				if (!signal.aborted)
					console.error("[gallery-detail] 动画加载失败:", error);
			});
	}

	return () => {
		abortController.abort();
		cleanupAnimations?.();
	};
}
