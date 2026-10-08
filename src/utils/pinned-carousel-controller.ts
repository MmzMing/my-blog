import type { ArticleCoverLifecycle } from "@/utils/article-cover-lifecycle";

/** 与 navbar-profile-controller 同一组常量，两处切页动效节奏对齐 */
const SLIDE_DURATION = 240;
const SLIDE_EASING = "cubic-bezier(0.32, 0.72, 0.29, 1)";
const SPRING_BACK_DURATION = 200;
/** 拖拽 commit 后剩余行程再按比例缩短，最长不超过 SLIDE_DURATION */
const SLIDE_MIN_DURATION_RATIO = 0.4;
const AUTO_ROTATE_INTERVAL = 6000;
/** 手动翻页后的静默期：用户正在读的时候别被自动切走 */
const MANUAL_HOLD = 12000;
/** 位移超过这个值才认定成拖拽，给点击和文字选择留出余量 */
const DRAG_START_THRESHOLD = 10;
const DRAG_COMMIT_RATIO = 0.22;
const DRAG_VELOCITY_COMMIT = 500;

type SlideDirection = 1 | -1;

export interface PinnedCarouselOptions {
	/** `.article-list-pinned` 整段，圆点在它内部 */
	section: HTMLElement;
	/** 封面生命周期由 ArticleList.astro 持有，这里只按卡片开关可见性 */
	coverLifecycles: Map<HTMLElement, ArticleCoverLifecycle>;
	signal: AbortSignal;
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max);
}

/**
 * 顶置文章轮播：底部圆点直达 + 卡片拖拽跟手翻页。
 *
 * 索引是环形的（末篇往前翻仍是「从右往左」），所以方向一律由调用方显式给出，
 * 不能像资料卡那样用 indexOf 比大小推——3→1 会被误判成后退。
 * 滑动期间两张卡靠 is-pinned-sliding 同时参与绘制，终态由 data-pinned-active
 * 决定谁留在原位；在途动画用 slideRevision 计数作废，连点圆点不排队、不堆叠。
 */
export function createPinnedCarousel(
	options: PinnedCarouselOptions,
): () => void {
	const { section, coverLifecycles, signal } = options;
	const carouselRoot = section.querySelector<HTMLElement>(
		"[data-article-list-pinned-carousel]",
	);
	if (!carouselRoot) return () => {};
	// 下面的 function 声明拿不到这层的非空收窄（声明提升意味着理论上可在守卫前调用），
	// 用非空别名接住，闭包里就不必反复判空
	const collection = carouselRoot;
	const items = Array.from(
		collection.querySelectorAll<HTMLElement>("[data-article-list-pinned-item]"),
	);
	const dots = Array.from(
		section.querySelectorAll<HTMLButtonElement>(
			"[data-article-list-pinned-dot]",
		),
	);
	if (items.length <= 1) return () => {};

	if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
		// 降级成朴素堆叠列表：不进滑动模式，集合的列布局原样生效
		for (const item of items) item.hidden = false;
		for (const dot of dots) dot.hidden = true;
		return () => {};
	}

	let activeIndex = Math.max(
		0,
		items.findIndex((item) => !item.hidden),
	);
	let slideRevision = 0;
	let slideAnimations: Animation[] = [];
	let rotationTimer: number | undefined;
	let manualHoldTimer: number | undefined;
	let hovered = false;
	let focused = false;
	let dragging = false;
	let suppressClick = false;
	let pointerId: number | undefined;
	let startX = 0;
	let startY = 0;
	let lastX = 0;
	let lastTime = 0;
	let offset = 0;
	let velocity = 0;
	let dragDir: SlideDirection = 1;
	let dragItem: HTMLElement | undefined;

	// 非活动卡靠 visibility 收起（保留占位，容器高度不随切页跳变）。
	// hidden 属性会被 Tailwind preflight 的 display:none!important 钉死，
	// 两张卡没法并排，所以进滑动模式必须把它清掉
	collection.classList.add("is-carousel-slides");
	for (const item of items) item.hidden = false;

	function setItemCoverVisible(item: HTMLElement, visible: boolean): void {
		item
			.querySelectorAll<HTMLElement>("[data-article-list-cover-wrap]")
			.forEach((wrap) => {
				coverLifecycles.get(wrap)?.setVisible(visible);
			});
	}

	function applyActiveState(): void {
		items.forEach((item, index) => {
			if (index === activeIndex) item.dataset.pinnedActive = "true";
			else delete item.dataset.pinnedActive;
		});
		dots.forEach((dot, index) => {
			dot.setAttribute("aria-current", String(index === activeIndex));
		});
	}

	function slideWidth(): number {
		return collection.getBoundingClientRect().width || 1;
	}

	function stopRotation(): void {
		if (rotationTimer === undefined) return;
		window.clearInterval(rotationTimer);
		rotationTimer = undefined;
	}

	function startRotation(): void {
		if (
			rotationTimer !== undefined ||
			manualHoldTimer !== undefined ||
			hovered ||
			focused ||
			dragging
		) {
			return;
		}
		rotationTimer = window.setInterval(() => {
			if (document.hidden || dragging || slideAnimations.length > 0) return;
			slideTo(activeIndex + 1, 1);
		}, AUTO_ROTATE_INTERVAL);
	}

	/** 手动翻页后给一段静默期，到点再恢复自动轮播 */
	function holdRotation(): void {
		stopRotation();
		if (manualHoldTimer !== undefined) window.clearTimeout(manualHoldTimer);
		manualHoldTimer = window.setTimeout(() => {
			manualHoldTimer = undefined;
			startRotation();
		}, MANUAL_HOLD);
	}

	/** 作废在途动画并把非激活卡收回：连点圆点或再次起拖时不排队、不堆叠 */
	function settleSlides(): void {
		slideRevision += 1;
		for (const animation of slideAnimations) animation.cancel();
		slideAnimations = [];
		dragging = false;
		pointerId = undefined;
		dragItem = undefined;
		offset = 0;
		velocity = 0;
		collection.classList.remove("is-pinned-dragging");
		items.forEach((item, index) => {
			item.classList.remove("is-pinned-sliding");
			item.style.removeProperty("transform");
			item.style.removeProperty("pointer-events");
			if (index !== activeIndex) setItemCoverVisible(item, false);
		});
	}

	function onSettled(
		animations: Animation[],
		revision: number,
		done: () => void,
	): void {
		void Promise.all(
			animations.map((animation) => animation.finished.catch(() => undefined)),
		).then(() => {
			// 已被更新的切换接管：过期回调不提交终态，否则会盖掉新页
			if (revision !== slideRevision) return;
			// fill: both 的终态若留着，下次这张卡当来页时内联 transform 会被它盖住
			for (const animation of animations) animation.cancel();
			slideAnimations = [];
			done();
		});
	}

	/**
	 * offset 是拖拽跟手已经产生的位移（px），非拖拽切换传 0。
	 * 传了 offset 就从当前位置接着推到终态，不会出现「跳回起点再滑」。
	 */
	function slideTo(nextIndex: number, dir: SlideDirection, dragFrom = 0): void {
		const resolved = (nextIndex + items.length) % items.length;
		if (resolved === activeIndex) return;
		const fromItem = items[activeIndex];
		const toItem = items[resolved];
		if (!fromItem || !toItem) return;

		const width = slideWidth();
		const travelled = Math.min(Math.abs(dragFrom), width);
		const duration =
			dragFrom === 0
				? SLIDE_DURATION
				: Math.max(
						Math.round(SLIDE_DURATION * ((width - travelled) / width)),
						Math.round(SLIDE_DURATION * SLIDE_MIN_DURATION_RATIO),
					);

		settleSlides();
		const revision = slideRevision;
		activeIndex = resolved;
		applyActiveState();

		for (const item of [fromItem, toItem]) {
			item.classList.add("is-pinned-sliding");
			item.style.pointerEvents = "none";
		}
		// 来页的封面必须在滑进来之前就开始加载揭示，否则拖到一半是空图
		setItemCoverVisible(toItem, true);

		const options: KeyframeAnimationOptions = {
			duration,
			easing: SLIDE_EASING,
		};
		const animations: Animation[] = [
			fromItem.animate(
				[
					{ transform: `translateX(${dragFrom}px)` },
					{ transform: `translateX(${-dir * width}px)` },
				],
				{ ...options, fill: "both" },
			),
			toItem.animate(
				[
					{ transform: `translateX(${dragFrom + dir * width}px)` },
					{ transform: "translateX(0)" },
				],
				options,
			),
		];
		slideAnimations = animations;
		onSettled(animations, revision, () => {
			for (const item of [fromItem, toItem]) {
				item.classList.remove("is-pinned-sliding");
				item.style.removeProperty("pointer-events");
				item.style.removeProperty("transform");
			}
			setItemCoverVisible(fromItem, false);
		});
	}

	function springBack(): void {
		const currentItem = items[activeIndex];
		const incoming = dragItem;
		if (!currentItem) {
			settleSlides();
			return;
		}
		const width = slideWidth();
		const from = offset;
		const dir = dragDir;
		settleSlides();
		const revision = slideRevision;
		currentItem.style.pointerEvents = "none";

		const options: KeyframeAnimationOptions = {
			duration: SPRING_BACK_DURATION,
			easing: SLIDE_EASING,
		};
		const animations: Animation[] = [
			currentItem.animate(
				[
					{ transform: `translateX(${from}px)` },
					{ transform: "translateX(0)" },
				],
				options,
			),
		];
		if (incoming) {
			incoming.classList.add("is-pinned-sliding");
			incoming.style.pointerEvents = "none";
			animations.push(
				incoming.animate(
					[
						{ transform: `translateX(${from + dir * width}px)` },
						{ transform: `translateX(${dir * width}px)` },
					],
					{ ...options, fill: "both" },
				),
			);
		}
		slideAnimations = animations;
		onSettled(animations, revision, () => {
			currentItem.style.removeProperty("pointer-events");
			if (incoming) {
				incoming.classList.remove("is-pinned-sliding");
				incoming.style.removeProperty("pointer-events");
				incoming.style.removeProperty("transform");
				setItemCoverVisible(incoming, false);
			}
			startRotation();
		});
	}

	/** 拖拽中途反向时换一张来页；环形取邻页，所以两端都不需要橡皮筋 */
	function ensureIncoming(dir: SlideDirection): HTMLElement | undefined {
		if (dragItem && dragDir === dir) return dragItem;
		if (dragItem) {
			dragItem.classList.remove("is-pinned-sliding");
			dragItem.style.removeProperty("transform");
			dragItem.style.removeProperty("pointer-events");
			setItemCoverVisible(dragItem, false);
		}
		dragDir = dir;
		dragItem = items[(activeIndex + dir + items.length) % items.length];
		if (dragItem) {
			dragItem.classList.add("is-pinned-sliding");
			dragItem.style.pointerEvents = "none";
			setItemCoverVisible(dragItem, true);
		}
		return dragItem;
	}

	function releaseCapture(): void {
		if (pointerId === undefined) return;
		if (collection.hasPointerCapture(pointerId)) {
			collection.releasePointerCapture(pointerId);
		}
	}

	function onPointerDown(event: PointerEvent): void {
		if (event.pointerType === "mouse" && event.button !== 0) return;
		// 抓卡片时先结束在途滑动，交给手指
		if (slideAnimations.length > 0) settleSlides();
		pointerId = event.pointerId;
		startX = event.clientX;
		startY = event.clientY;
		lastX = event.clientX;
		lastTime = event.timeStamp;
		offset = 0;
		velocity = 0;
		dragItem = undefined;
		suppressClick = false;
		stopRotation();
	}

	function onPointerMove(event: PointerEvent): void {
		if (pointerId === undefined || event.pointerId !== pointerId) return;
		const deltaX = event.clientX - startX;
		const deltaY = event.clientY - startY;
		if (!dragging) {
			if (
				Math.abs(deltaX) < DRAG_START_THRESHOLD &&
				Math.abs(deltaY) < DRAG_START_THRESHOLD
			) {
				return;
			}
			// 竖向手势整个交还给页面滚动，之后这次指针移动不再参与
			if (Math.abs(deltaX) <= Math.abs(deltaY)) {
				pointerId = undefined;
				startRotation();
				return;
			}
			dragging = true;
			suppressClick = true;
			// 快速点击时指针可能在这第一个合格 move 之前就已释放，setPointerCapture
			// 会抛 NotFoundError；捕获失败不影响跟手（move 仍会冒泡到集合），不打断拖拽
			try {
				collection.setPointerCapture(event.pointerId);
			} catch {
				/* 指针已失效，继续无捕获拖拽 */
			}
			collection.classList.add("is-pinned-dragging");
		}
		const currentItem = items[activeIndex];
		const width = slideWidth();
		const dir: SlideDirection = deltaX < 0 ? 1 : -1;
		const incoming = ensureIncoming(dir);
		if (!currentItem || !incoming) return;
		const elapsed = event.timeStamp - lastTime;
		if (elapsed > 0) {
			velocity = ((event.clientX - lastX) / elapsed) * 1000;
			lastX = event.clientX;
			lastTime = event.timeStamp;
		}
		offset = clamp(deltaX, -width, width);
		currentItem.style.transform = `translateX(${offset}px)`;
		incoming.style.transform = `translateX(${offset + dir * width}px)`;
	}

	function onPointerUp(event: PointerEvent): void {
		if (pointerId === undefined || event.pointerId !== pointerId) return;
		releaseCapture();
		if (!dragging) {
			pointerId = undefined;
			startRotation();
			return;
		}
		const width = slideWidth();
		const committed =
			Math.abs(offset) > width * DRAG_COMMIT_RATIO ||
			Math.abs(velocity) > DRAG_VELOCITY_COMMIT;
		if (!committed) {
			springBack();
			return;
		}
		const dir = dragDir;
		slideTo(activeIndex + dir, dir, offset);
		holdRotation();
	}

	function onPointerCancel(event: PointerEvent): void {
		if (pointerId === undefined || event.pointerId !== pointerId) return;
		releaseCapture();
		if (!dragging) {
			pointerId = undefined;
			return;
		}
		// 浏览器接管滚动或指针丢失：弹回当前页，不提交翻页
		springBack();
	}

	function onClickCapture(event: MouseEvent): void {
		if (!suppressClick) return;
		suppressClick = false;
		// 整张卡是链接（__surface-link），拖完不拦就会顺手导航走
		event.preventDefault();
		event.stopPropagation();
	}

	// 活动态决定 CSS 里谁留在原位；封面可见性已由 initCoverLoading 按 hidden 种好
	applyActiveState();

	collection.addEventListener("pointerdown", onPointerDown, { signal });
	collection.addEventListener("pointermove", onPointerMove, { signal });
	collection.addEventListener("pointerup", onPointerUp, { signal });
	collection.addEventListener("pointercancel", onPointerCancel, { signal });
	collection.addEventListener("click", onClickCapture, {
		signal,
		capture: true,
	});
	collection.addEventListener("dragstart", (event) => event.preventDefault(), {
		signal,
	});

	collection.addEventListener(
		"pointerenter",
		() => {
			hovered = true;
			stopRotation();
		},
		{ signal },
	);
	collection.addEventListener(
		"pointerleave",
		() => {
			hovered = false;
			startRotation();
		},
		{ signal },
	);
	collection.addEventListener(
		"focusin",
		() => {
			focused = true;
			stopRotation();
		},
		{ signal },
	);
	collection.addEventListener(
		"focusout",
		(event) => {
			const relatedTarget = event.relatedTarget;
			if (relatedTarget instanceof Node && collection.contains(relatedTarget)) {
				return;
			}
			focused = false;
			startRotation();
		},
		{ signal },
	);
	for (const [index, dot] of dots.entries()) {
		dot.addEventListener(
			"click",
			() => {
				if (index === activeIndex) return;
				slideTo(index, index > activeIndex ? 1 : -1);
				holdRotation();
			},
			{ signal },
		);
	}

	startRotation();

	return () => {
		stopRotation();
		if (manualHoldTimer !== undefined) window.clearTimeout(manualHoldTimer);
		settleSlides();
	};
}
