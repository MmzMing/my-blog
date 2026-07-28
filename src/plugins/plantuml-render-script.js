/* PlantUML theme switching, loading fallback, and shared interaction handoff. */
(() => {
	if (window.plantumlInitialized) return;
	window.plantumlInitialized = true;

	function applyTheme() {
		const isDark = document.documentElement.classList.contains("dark");
		for (const image of document.querySelectorAll(".plantuml-image")) {
			const light = image.getAttribute("data-light-src") || "";
			const dark = image.getAttribute("data-dark-src") || light;
			const next = isDark ? dark : light;
			if (next && image.getAttribute("src") !== next) {
				image.setAttribute("src", next);
			}
		}
	}

	function handoffInteraction(container) {
		window._diagramPanZoomReinit?.(container);
	}

	function bindLoadHandler(image, container) {
		if (image.dataset.loadBound === "true") return;
		image.dataset.loadBound = "true";
		const onLoad = () => handoffInteraction(container);
		if (image.complete && image.naturalWidth > 0) {
			queueMicrotask(onLoad);
		} else {
			image.addEventListener("load", onLoad, { once: true });
		}
	}

	function bindErrorHandler(image, container) {
		if (image.dataset.errorBound === "true") return;
		image.dataset.errorBound = "true";
		image.addEventListener("error", () => {
			if (container.dataset.errorShown === "true") return;
			container.dataset.errorShown = "true";
			const wrapper = container.querySelector(".plantuml-wrapper");
			if (!wrapper) return;

			wrapper.innerHTML = "";
			window._diagramPanZoomReinit?.(container);
			const errorBox = document.createElement("div");
			errorBox.className = "plantuml-error";
			const message = document.createElement("p");
			message.textContent = "PlantUML 图表加载失败，请检查网络或服务器状态";
			const retry = document.createElement("button");
			retry.type = "button";
			retry.textContent = "重试";
			retry.addEventListener("click", (event) => {
				event.preventDefault();
				event.stopPropagation();
				delete container.dataset.errorShown;
				wrapper.innerHTML = "";
				const nextImage = new Image();
				nextImage.className = "plantuml-image";
				nextImage.alt = image.alt;
				nextImage.setAttribute(
					"data-light-src",
					image.getAttribute("data-light-src") || "",
				);
				nextImage.setAttribute(
					"data-dark-src",
					image.getAttribute("data-dark-src") || "",
				);
				nextImage.loading = "lazy";
				nextImage.decoding = "async";
				wrapper.appendChild(nextImage);
				bindErrorHandler(nextImage, container);
				bindLoadHandler(nextImage, container);
				applyTheme();
			});
			errorBox.append(message, retry);
			wrapper.appendChild(errorBox);
		});
	}

	function initAll() {
		for (const container of document.querySelectorAll(
			".plantuml-diagram-container",
		)) {
			const image = container.querySelector(".plantuml-image");
			if (!image) continue;
			bindErrorHandler(image, container);
			bindLoadHandler(image, container);
		}
		applyTheme();
	}

	const themeObserver = new MutationObserver((mutations) => {
		if (
			mutations.some(
				(mutation) =>
					mutation.type === "attributes" && mutation.attributeName === "class",
			)
		) {
			applyTheme();
		}
	});
	themeObserver.observe(document.documentElement, {
		attributes: true,
		attributeFilter: ["class"],
	});

	document.addEventListener("astro:page-load", initAll);
	document.addEventListener("password:decrypted", () => {
		requestAnimationFrame(initAll);
	});
	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", initAll, { once: true });
	} else {
		initAll();
	}
})();
