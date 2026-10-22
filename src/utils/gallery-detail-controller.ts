export function mountGalleryDetail(): () => void {
	const root = document.querySelector<HTMLElement>("[data-gallery-detail]");
	if (!root) return () => {};

	const abortController = new AbortController();
	const { signal } = abortController;
	const photos = Array.from(
		root.querySelectorAll<HTMLElement>("[data-gallery-photo]"),
	);
	const revealedPhotos = new Set<Element>();
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
						const isDesktop = context.conditions.desktop;
						const observer = new IntersectionObserver((entries) => {
							if (signal.aborted) return;
							for (const entry of entries) {
								if (!entry.isIntersecting) continue;
								const photo = entry.target;
								observer.unobserve(photo);
								const link = photo.querySelector<HTMLElement>(
									".gallery-photo__link",
								);
								const parent = photo.parentElement;
								if (!link || !parent || revealedPhotos.has(photo)) continue;
								revealedPhotos.add(photo);
								const bounds = photo.getBoundingClientRect();
								const parentBounds = parent.getBoundingClientRect();
								const offset =
									bounds.left +
									bounds.width / 2 -
									(parentBounds.left + parentBounds.width / 2);
								const direction =
									Math.abs(offset) < bounds.width / 4 ? 0 : Math.sign(offset);
								context.add(() => {
									gsap.fromTo(
										link,
										{
											x: direction * bounds.width * (isDesktop ? 0.2 : 0.06),
											y: isDesktop ? 120 : 40,
											rotation: direction * (isDesktop ? 4 : 1.5),
											scale: isDesktop ? 0.92 : 0.97,
											opacity: 0.25,
											willChange: "transform, opacity",
										},
										{
											x: 0,
											y: 0,
											rotation: 0,
											scale: 1,
											opacity: 1,
											duration: isDesktop ? 0.7 : 0.45,
											ease: "power2.out",
											clearProps: "transform,opacity,willChange",
										},
									);
								});
							}
						});
						for (const photo of photos) {
							if (revealedPhotos.has(photo)) continue;
							if (photo.getBoundingClientRect().top < window.innerHeight) {
								revealedPhotos.add(photo);
								continue;
							}
							observer.observe(photo);
						}
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
