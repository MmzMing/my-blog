/* Shared inline diagram pan/zoom and fullscreen controls. */
(() => {
	if (window._diagramPanZoomInit) return;
	window._diagramPanZoomInit = true;

	const MIN_SCALE = 0.5;
	const MAX_SCALE = 5;
	const SCALE_STEP = 1.2;
	const overlays = new Set();

	function selectTarget(container) {
		const isDark = document.documentElement.classList.contains("dark");
		const lightSvg = container.querySelector(".mermaid-svg-light svg");
		const darkSvg = container.querySelector(".mermaid-svg-dark svg");
		if (lightSvg && darkSvg) return isDark ? darkSvg : lightSvg;
		return container.querySelector(".plantuml-image, svg, img");
	}

	function getTargets(container) {
		const themedTargets = Array.from(
			container.querySelectorAll(
				".mermaid-svg-light svg, .mermaid-svg-dark svg",
			),
		);
		if (themedTargets.length > 0) return themedTargets;
		const target = selectTarget(container);
		return target ? [target] : [];
	}

	function cleanupInteraction(container) {
		container._diagramPanZoomController?.abort();
		container._diagramPanZoomController = null;
		container.querySelector(".diagram-controls")?.remove();
		for (const target of getTargets(container)) {
			target.style.transform = "";
			target.style.transformOrigin = "";
		}
		delete container.dataset.diagramPanzoomInit;
		container.style.cursor = "";
	}

	function createButton(label, title, action, className = "diagram-ctrl-btn") {
		const button = document.createElement("button");
		button.type = "button";
		button.className = className;
		button.textContent = label;
		button.title = title;
		button.setAttribute("aria-label", title);
		button.addEventListener("click", (event) => {
			event.preventDefault();
			event.stopPropagation();
			action(button);
		});
		return button;
	}

	function initInteraction(container) {
		if (container.dataset.diagramPanzoomInit === "true") return;
		const targets = getTargets(container);
		if (targets.length === 0) return;

		container.dataset.diagramPanzoomInit = "true";
		const controller = new AbortController();
		container._diagramPanZoomController = controller;
		const signal = controller.signal;
		const state = { scale: 1, tx: 0, ty: 0 };

		const apply = () => {
			for (const target of targets) {
				target.style.transformOrigin = "center center";
				target.style.transform = `translate(${state.tx}px, ${state.ty}px) scale(${state.scale})`;
			}
		};
		const clamp = (scale) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
		const reset = () => {
			state.scale = 1;
			state.tx = 0;
			state.ty = 0;
			apply();
		};
		const zoomBy = (factor, originX, originY) => {
			const previous = state.scale;
			const next = clamp(previous * factor);
			if (next === previous) return;

			if (typeof originX === "number" && typeof originY === "number") {
				const rect = (
					selectTarget(container) || targets[0]
				).getBoundingClientRect();
				const dx = originX - (rect.left + rect.width / 2);
				const dy = originY - (rect.top + rect.height / 2);
				const ratio = next / previous;
				state.tx -= dx * (ratio - 1);
				state.ty -= dy * (ratio - 1);
			}

			state.scale = next;
			apply();
		};

		const controls = document.createElement("div");
		controls.className = "diagram-controls";
		controls.setAttribute("role", "group");
		controls.setAttribute("aria-label", "图表控制");
		controls.append(
			createButton("+", "放大", () => zoomBy(SCALE_STEP)),
			createButton("−", "缩小", () => zoomBy(1 / SCALE_STEP)),
			createButton("↺", "重置", reset),
			createButton("⛶", "全屏", (button) => openFullscreen(container, button)),
		);
		container.appendChild(controls);

		let dragging = false;
		let startX = 0;
		let startY = 0;
		let startTx = 0;
		let startTy = 0;

		container.addEventListener(
			"pointerdown",
			(event) => {
				if (event.pointerType === "touch" || event.button !== 0) return;
				if (event.target.closest(".diagram-controls")) return;
				dragging = true;
				startX = event.clientX;
				startY = event.clientY;
				startTx = state.tx;
				startTy = state.ty;
				container.setPointerCapture?.(event.pointerId);
				container.style.cursor = "grabbing";
			},
			{ signal },
		);
		container.addEventListener(
			"pointermove",
			(event) => {
				if (!dragging) return;
				state.tx = startTx + (event.clientX - startX);
				state.ty = startTy + (event.clientY - startY);
				apply();
			},
			{ signal },
		);
		const endDrag = (event) => {
			if (!dragging) return;
			dragging = false;
			container.releasePointerCapture?.(event.pointerId);
			container.style.cursor = "";
		};
		container.addEventListener("pointerup", endDrag, { signal });
		container.addEventListener("pointercancel", endDrag, { signal });
		container.addEventListener(
			"dblclick",
			(event) => {
				if (event.target.closest(".diagram-controls")) return;
				if (state.scale === 1) {
					zoomBy(SCALE_STEP * SCALE_STEP, event.clientX, event.clientY);
				} else {
					reset();
				}
			},
			{ signal },
		);

		apply();
	}

	function openFullscreen(container, trigger) {
		const source = selectTarget(container);
		if (!source) return;

		const previousOverflow = document.body.style.overflow;
		const overlay = document.createElement("div");
		overlay.className = "diagram-fullscreen-overlay";
		overlay.setAttribute("role", "dialog");
		overlay.setAttribute("aria-modal", "true");
		overlay.setAttribute("aria-label", "图表全屏查看");
		overlay.tabIndex = -1;

		const content = document.createElement("div");
		content.className = "diagram-fs-content";
		const clone = source.cloneNode(true);
		clone.style.transform = "";
		clone.style.transformOrigin = "";
		content.appendChild(clone);

		const controls = document.createElement("div");
		controls.className = "diagram-fs-controls";
		controls.setAttribute("role", "group");
		controls.setAttribute("aria-label", "全屏图表控制");
		const controller = new AbortController();
		const signal = controller.signal;
		const state = { scale: 1, tx: 0, ty: 0 };

		const apply = () => {
			clone.style.transformOrigin = "center center";
			clone.style.transform = `translate(${state.tx}px, ${state.ty}px) scale(${state.scale})`;
		};
		const zoom = (factor, originX, originY) => {
			const previous = state.scale;
			const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, previous * factor));
			if (next === previous) return;

			if (typeof originX === "number" && typeof originY === "number") {
				const rect = clone.getBoundingClientRect();
				const dx = originX - (rect.left + rect.width / 2);
				const dy = originY - (rect.top + rect.height / 2);
				const ratio = next / previous;
				state.tx -= dx * (ratio - 1);
				state.ty -= dy * (ratio - 1);
			}

			state.scale = next;
			apply();
		};
		const reset = () => {
			state.scale = 1;
			state.tx = 0;
			state.ty = 0;
			apply();
		};
		const close = () => {
			controller.abort();
			overlay.remove();
			overlays.delete(overlay);
			document.body.style.overflow = previousOverflow;
			if (trigger?.isConnected) trigger.focus();
		};
		overlay._diagramClose = close;

		const closeButton = createButton("✕", "关闭", close);
		controls.append(
			createButton("+", "放大", () => zoom(SCALE_STEP)),
			createButton("−", "缩小", () => zoom(1 / SCALE_STEP)),
			createButton("↺", "重置", reset),
			closeButton,
		);

		content.addEventListener(
			"wheel",
			(event) => {
				event.preventDefault();
				zoom(
					event.deltaY < 0 ? SCALE_STEP : 1 / SCALE_STEP,
					event.clientX,
					event.clientY,
				);
			},
			{ passive: false, signal },
		);

		let dragging = false;
		let startX = 0;
		let startY = 0;
		let startTx = 0;
		let startTy = 0;
		content.addEventListener(
			"pointerdown",
			(event) => {
				if (event.target.closest(".diagram-fs-controls")) return;
				if (event.pointerType === "touch" && event.isPrimary === false) return;
				dragging = true;
				startX = event.clientX;
				startY = event.clientY;
				startTx = state.tx;
				startTy = state.ty;
				content.setPointerCapture?.(event.pointerId);
			},
			{ signal },
		);
		content.addEventListener(
			"pointermove",
			(event) => {
				if (!dragging) return;
				state.tx = startTx + (event.clientX - startX);
				state.ty = startTy + (event.clientY - startY);
				apply();
			},
			{ signal },
		);
		const endDrag = (event) => {
			if (!dragging) return;
			dragging = false;
			content.releasePointerCapture?.(event.pointerId);
		};
		content.addEventListener("pointerup", endDrag, { signal });
		content.addEventListener("pointercancel", endDrag, { signal });

		let pinchDistance = 0;
		let pinchScale = 1;
		let pinchTx = 0;
		let pinchTy = 0;
		let pinchCenterX = 0;
		let pinchCenterY = 0;
		content.addEventListener(
			"touchstart",
			(event) => {
				if (event.touches.length !== 2) return;
				event.preventDefault();
				const first = event.touches[0];
				const second = event.touches[1];
				pinchDistance = Math.hypot(
					second.clientX - first.clientX,
					second.clientY - first.clientY,
				);
				pinchScale = state.scale;
				pinchTx = state.tx;
				pinchTy = state.ty;
				pinchCenterX = (first.clientX + second.clientX) / 2;
				pinchCenterY = (first.clientY + second.clientY) / 2;
			},
			{ passive: false, signal },
		);
		content.addEventListener(
			"touchmove",
			(event) => {
				if (event.touches.length !== 2 || pinchDistance === 0) return;
				event.preventDefault();
				const first = event.touches[0];
				const second = event.touches[1];
				const distance = Math.hypot(
					second.clientX - first.clientX,
					second.clientY - first.clientY,
				);
				const next = Math.min(
					MAX_SCALE,
					Math.max(MIN_SCALE, pinchScale * (distance / pinchDistance)),
				);
				const ratio = next / pinchScale;
				state.scale = next;
				state.tx = pinchCenterX - ratio * (pinchCenterX - pinchTx);
				state.ty = pinchCenterY - ratio * (pinchCenterY - pinchTy);
				apply();
			},
			{ passive: false, signal },
		);

		overlay.addEventListener(
			"click",
			(event) => {
				if (event.target === overlay) close();
			},
			{ signal },
		);
		document.addEventListener(
			"keydown",
			(event) => {
				if (event.key === "Escape") close();
			},
			{ signal },
		);

		overlay.append(content, controls);
		document.body.appendChild(overlay);
		document.body.style.overflow = "hidden";
		overlays.add(overlay);
		apply();
		closeButton.focus();
	}

	function closeAll() {
		for (const overlay of Array.from(overlays)) {
			overlay._diagramClose?.();
		}
	}

	function initAll() {
		for (const container of document.querySelectorAll(".diagram-container")) {
			initInteraction(container);
		}
	}

	window._diagramPanZoomReinit = (container) => {
		cleanupInteraction(container);
		initInteraction(container);
	};

	document.addEventListener("astro:before-preparation", closeAll);
	document.addEventListener("astro:page-load", () => {
		closeAll();
		initAll();
	});
	document.addEventListener("password:decrypted", () => {
		requestAnimationFrame(initAll);
	});

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", initAll, { once: true });
	} else {
		initAll();
	}
})();
