/**
 * 首页导览四卡的交互控制器：入场、展开收起，以及数据层与文章牌堆的手动/自动切换。
 *
 * 描线动画本身不在这里：笔画的 dashoffset、分镜延迟、虚线围合流动全部由
 * home-data-layer.css 的关键帧驱动，本模块只切换根节点上的 3 个 dataset 属性，
 * 让 CSS 决定播什么。因此 Umami 取数等数据获取逻辑不进入本文件。
 *
 * 根节点状态：
 *   data-guide-entered   入场闸门，IntersectionObserver 命中后置 1，此前所有笔画静止
 *   data-guide-expanded  当前展开的卡 id，缺省表示 2×2 缩略态
 *   data-guide-detail    详细态开关，重排落定后才置 on，驱动追加描绘
 *
 * 展开用 GSAP Flip 而非逐帧补间：卡片在两态间换的是 grid 轨道尺寸，
 * Flip 负责「读旧位置 → 改 CSS → 反向补间回新位置」，等价于 React 侧的
 * layoutId 共享元素转场。DrawSVGPlugin 不参与，描线是免费的 CSS。
 */

import { gsap } from "gsap";
import { Flip } from "gsap/Flip";

gsap.registerPlugin(Flip);

/** 与 CSS 的 --guide-flip-duration 对应，改一处要同步另一处 */
const FLIP_DURATION = 0.62;
/** 沿用旧数据层的下沿留白，避免首屏尚未滚到就开始播放 */
const ENTER_ROOT_MARGIN = "0px 0px -30% 0px";
/** 缩略态自动换层的节奏，要慢过描线一遍（460ms）再多一截读数时间 */
const STAT_CYCLE_MS = 2800;
/** 牌堆翻一张的间隔：一张封面要让人看完标题和日期 */
const DECK_CYCLE_MS = 3800;
/** 顶牌抛出动画的时长，必须与 CSS 的 --deck-fly-duration 一致 */
const DECK_FLY_MS = 620;
/** 少于此数不轮播，见下方注释 */
const DECK_MIN_CARDS = 4;
/** 与列表页轮播一致，先给点击留出移动余量，再按卡宽决定是否翻页 */
const DECK_DRAG_THRESHOLD = 10;
const DECK_DRAG_COMMIT_RATIO = 0.22;
const DECK_DRAG_TILT = 9;

const CARD_SELECTOR = "[data-guide-card]";
/** 站点数据右侧的读数卡，与左侧层按 data-stat-card 对应 */
const READOUT_SELECTOR = "[data-stat-card]";
/** 左侧层叠里的一层，本身即悬停与点击的热区 */
const LAYER_SELECTOR = ".stat-layer[data-stat-index]";
/** 牌堆里的每张封面卡，下标即 data-post-card */
const POST_CARD_SELECTOR = "[data-post-card]";
/** 展开态手风琴里的条目，data-post-pick 是牌堆下标 */
const POST_PICK_SELECTOR = "[data-post-pick]";
/** 只有博客文章那张卡的手风琴需要「悬停切封面」 */
const POST_ACC_SELECTOR = '[data-guide-card="posts"] .acc';
const ACC_ITEM_SELECTOR = ".acc__item";
const ACC_HEAD_SELECTOR = "[data-acc-head]";

function prefersReducedMotion(): boolean {
	return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function getCards(root: HTMLElement): HTMLElement[] {
	return Array.from(root.querySelectorAll<HTMLElement>(CARD_SELECTOR));
}

/**
 * 挂载导览层交互，返回清理函数。
 * 由组件的 `bindHomeLayer("data-layer", ...)` 在 boot 里调用，不要自行监听 swup 事件。
 */
export function bootHomeGuide(root: HTMLElement): () => void {
	const reduced = prefersReducedMotion();
	// gsap 3.15 起 context() 首参为空返回 ambient context 而非新建实例，必须传函数
	const ctx = gsap.context(() => {}, root);
	let timeline: gsap.core.Timeline | null = null;
	let activeId = "";

	const markActive = (id: string): void => {
		getCards(root).forEach((card) => {
			const isOn = card.dataset.guideCard === id;
			card.classList.toggle("guide-card--active", isOn);
			card.setAttribute("aria-expanded", isOn ? "true" : "false");
		});
	};

	const applyState = (id: string): void => {
		if (id) root.dataset.guideExpanded = id;
		else delete root.dataset.guideExpanded;
		activeId = id;
		markActive(id);
	};

	const toggle = (id: string): void => {
		const next = activeId === id ? "" : id;
		// 收起时先摘详细态，让详细笔画随卡片收缩一起淡出，再进重排
		if (!next) delete root.dataset.guideDetail;

		if (reduced) {
			applyState(next);
			if (next) root.dataset.guideDetail = "on";
			return;
		}

		timeline?.kill();
		const state = Flip.getState(getCards(root), { props: "borderRadius" });
		applyState(next);
		timeline = ctx.add(() =>
			Flip.from(state, {
				duration: FLIP_DURATION,
				ease: "power2.inOut",
				absolute: true,
			}),
		);
		// 「先归位、再画细节」：追加描绘排在重排落定之后
		if (next && timeline)
			timeline.add(() => {
				root.dataset.guideDetail = "on";
			});
	};

	const onClick = (event: MouseEvent): void => {
		const origin = event.target as Element | null;
		if (!origin) return;
		/* 展开态下的端点链接、手风琴标题照常工作，不触发收起：
		   点按钮是开合这一组，点卡片空白才是收起整张卡 */
		if (origin.closest("a, button")) return;
		const card = origin.closest(CARD_SELECTOR);
		if (card) {
			toggle(card.getAttribute("data-guide-card") ?? "");
			return;
		}
		if (activeId) toggle("");
	};

	// 卡片自身可聚焦（没有可见按钮），键盘用 Enter / Space 触发开合
	const onKeyDown = (event: KeyboardEvent): void => {
		if (event.key !== "Enter" && event.key !== " ") return;
		const origin = event.target;
		if (!(origin instanceof Element) || origin.closest("a, button")) return;
		const card = origin.closest(CARD_SELECTOR);
		if (!card) return;
		event.preventDefault();
		toggle(card.getAttribute("data-guide-card") ?? "");
	};

	/* ---- 站点数据：左侧层叠与右侧读数卡的联动 ----
	   悬停某层 → 右侧换成那层的数据；移开卡片 → 回到轮询的那层；点击 → 定住。
	   读数共用一个滑动窗口，快速切层时由 CSS 从当前位置继续补间，避免淡出留白。 */
	const statLayers = Array.from(
		root.querySelectorAll<SVGElement>(LAYER_SELECTOR),
	);
	const statReadouts = Array.from(
		root.querySelectorAll<HTMLElement>(READOUT_SELECTOR),
	);
	const statReadout = root.querySelector<HTMLElement>(".stat-readout");
	let statPinned = "0";

	const markLayer = (index: string): void => {
		statReadout?.style.setProperty("--stat-active", index);
		statLayers.forEach((layer) => {
			layer.toggleAttribute("data-on", layer.dataset.statIndex === index);
		});
		statReadouts.forEach((card) => {
			card.toggleAttribute("data-on", card.dataset.statCard === index);
		});
	};

	/* 层与读数卡共用同一套下标：展开态六张读数卡铺满了右栏，点它和点左侧那层
	   是同一件事，不必再分两套处理 */
	const indexOfLayer = (node: Element | null): string | null => {
		const hit = node?.closest(`${LAYER_SELECTOR}, ${READOUT_SELECTOR}`);
		return (
			hit?.getAttribute("data-stat-index") ??
			hit?.getAttribute("data-stat-card") ??
			null
		);
	};

	const onStatMove = (event: PointerEvent): void => {
		const index = indexOfLayer(
			event.target instanceof Element ? event.target : null,
		);
		if (index !== null) markLayer(index);
	};

	const onStatOut = (event: PointerEvent): void => {
		// 抬层动画会让热区从鼠标下移走，留在卡片内时保留手动选中，避免读数闪回。
		if (
			event.relatedTarget instanceof Element &&
			event.relatedTarget.closest('[data-guide-card="stats"]')
		)
			return;
		markLayer(statPinned);
	};

	// 层是 SVG <g>，用一层委托而不是逐个绑定：菱形面有填充，可直接命中
	const onStatClick = (event: MouseEvent): void => {
		const index = indexOfLayer(event.target as Element | null);
		if (index === null) return;
		/* 拦住的是「同一节点上的下一个监听器」，所以必须 stopImmediatePropagation：
	   stopPropagation 只挡祖先，root 上的 onClick 仍会跑，点层就被当成点卡收起 */
		event.stopImmediatePropagation();
		statPinned = index;
		markLayer(index);
		// 手动选过就不再自动播，否则读数卡会在用户眼皮底下换掉
		stopStatCycle();
		if (activeId !== "stats") toggle("stats");
	};

	/* ---- 悬停即暂停 ----
	   自动换内容的东西都不该在用户正盯着看时自己跳走，两张卡共用一套开关 */
	const pausedCards = new Set<string>();

	const bindPauseOnHover = (id: string): (() => void) => {
		const card = root.querySelector<HTMLElement>(`[data-guide-card="${id}"]`);
		if (!card) return () => {};
		const enter = (): void => {
			pausedCards.add(id);
		};
		const leave = (): void => {
			pausedCards.delete(id);
		};
		card.addEventListener("pointerenter", enter);
		card.addEventListener("pointerleave", leave);
		return () => {
			card.removeEventListener("pointerenter", enter);
			card.removeEventListener("pointerleave", leave);
		};
	};

	const isPaused = (id: string): boolean =>
		pausedCards.has(id) ||
		(Boolean(document.activeElement?.matches(":focus-visible")) &&
			document.activeElement?.closest<HTMLElement>(CARD_SELECTOR)?.dataset
				.guideCard === id);

	const unbindStatsPause = bindPauseOnHover("stats");

	/* ---- 缩略态自动轮播 ----
	   参考原稿是自动往下走的：不轮播的话六层里有五层永远不会被看到。
	   展开态六张读数卡全显，换层只会让人看不出在选哪层 */
	let statCycleTimer: number | null = null;

	const stopStatCycle = (): void => {
		if (statCycleTimer === null) return;
		window.clearInterval(statCycleTimer);
		statCycleTimer = null;
	};

	const startStatCycle = (): void => {
		if (statCycleTimer !== null || reduced || statLayers.length < 2) return;
		statCycleTimer = window.setInterval(() => {
			if (activeId === "stats" || isPaused("stats")) return;
			statPinned = String((Number(statPinned) + 1) % statLayers.length);
			markLayer(statPinned);
		}, STAT_CYCLE_MS);
	};

	/* ---- 博客文章牌堆 ----
	   顶牌抛出、后面的整摞往上顶一格。位移与缩放全在 CSS 里按 --depth 算，
	   JS 只负责推进 deckShown 并重排下标。少于 4 张不轮播：抛掉的那张会立刻
	   从栈底滑回来（CSS 只在 depth ≥ 3 才把它藏掉），看着像是穿帮 */
	const deckCards = Array.from(
		root.querySelectorAll<HTMLElement>(POST_CARD_SELECTOR),
	);
	const deck = root.querySelector<HTMLElement>("[data-post-deck]");
	const accordion = root.querySelector<HTMLElement>(POST_ACC_SELECTOR);
	let deckAnchor = 0;
	let deckShown = 0;
	let deckCycleTimer: number | null = null;
	let deckFlyTimer: number | null = null;
	let deckFlyingCard: HTMLElement | null = null;
	let deckPointerId: number | null = null;
	let deckDragCard: HTMLElement | null = null;
	let deckStartX = 0;
	let deckStartY = 0;
	let deckDragWidth = 0;
	let deckOffset = 0;
	let isDeckDragging = false;
	let suppressDeckClick = false;

	const layoutDeck = (): void => {
		const n = deckCards.length;
		const shouldMoveFocus = deckCards.some(
			(card) =>
				card === document.activeElement && card.matches(":focus-visible"),
		);
		deckCards.forEach((card, i) => {
			card.style.setProperty("--depth", String((i - deckShown + n) % n));
			card.toggleAttribute("data-on", i === deckShown);
			card.inert = i !== deckShown;
			card.tabIndex = i === deckShown ? 0 : -1;
		});
		if (shouldMoveFocus) deckCards[deckShown]?.focus({ preventScroll: true });
	};

	const showDeckCard = (index: number): void => {
		if (index === deckShown) return;
		deckShown = index;
		layoutDeck();
	};

	const finishDeckFlight = (): void => {
		if (deckFlyTimer !== null) window.clearTimeout(deckFlyTimer);
		deckFlyTimer = null;
		const card = deckFlyingCard;
		if (!card) return;
		deckFlyingCard = null;
		// 飞出的牌直接归入当前栈底位置，不能在撤掉 data-flying 后反向补间回牌面。
		card.style.transition = "none";
		card.removeAttribute("data-flying");
		card.style.removeProperty("--deck-fly-direction");
		card.getBoundingClientRect();
		card.style.removeProperty("transition");
	};

	const advanceDeck = (flyDirection: 1 | -1 = 1): void => {
		const n = deckCards.length;
		if (n < 2) return;
		finishDeckFlight();
		const leaving = deckCards[deckShown];
		// 左右拖走都翻开下一张，方向只影响飞出姿态，旧顶牌始终排到最底部。
		deckAnchor = (deckShown + 1) % n;
		deckShown = deckAnchor;
		layoutDeck();
		// 小牌堆和减少动态效果模式直接换牌，避免旧牌回栈时从正面穿过。
		if (reduced || n < DECK_MIN_CARDS) return;
		deckFlyingCard = leaving ?? null;
		leaving?.style.setProperty("--deck-fly-direction", String(flyDirection));
		leaving?.setAttribute("data-flying", "");
		deckFlyTimer = window.setTimeout(finishDeckFlight, DECK_FLY_MS);
	};

	const stopDeckCycle = (): void => {
		if (deckCycleTimer === null) return;
		window.clearInterval(deckCycleTimer);
		deckCycleTimer = null;
	};

	const startDeckCycle = (): void => {
		if (deckCycleTimer !== null || reduced || deckCards.length < DECK_MIN_CARDS)
			return;
		deckCycleTimer = window.setInterval(() => {
			if (activeId === "posts" || isPaused("posts") || deckPointerId !== null)
				return;
			advanceDeck();
		}, DECK_CYCLE_MS);
	};

	const unbindDeckPause = bindPauseOnHover("posts");

	const resetDeckDrag = (): void => {
		const pointerId = deckPointerId;
		deckPointerId = null;
		isDeckDragging = false;
		deck?.removeAttribute("data-dragging");
		deckDragCard?.style.removeProperty("transform");
		deckDragCard = null;
		if (pointerId !== null && deck?.hasPointerCapture(pointerId))
			deck.releasePointerCapture(pointerId);
	};

	const onDeckDown = (event: PointerEvent): void => {
		if (
			!event.isPrimary ||
			event.button !== 0 ||
			activeId === "posts" ||
			deckCards.length < 2 ||
			deckPointerId !== null
		)
			return;
		const card =
			event.target instanceof Element
				? event.target.closest<HTMLElement>(`${POST_CARD_SELECTOR}[data-on]`)
				: null;
		if (!card) return;
		// 自动抛牌尚未结束时，先收掉旧牌，当前封面立即交给手动操作。
		finishDeckFlight();
		deckPointerId = event.pointerId;
		deckDragCard = card;
		deckStartX = event.clientX;
		deckStartY = event.clientY;
		deckDragWidth = card.getBoundingClientRect().width;
		deckOffset = 0;
		suppressDeckClick = false;
		stopDeckCycle();
	};

	const onDeckMove = (event: PointerEvent): void => {
		if (event.pointerId !== deckPointerId || !deckDragCard || !deck) return;
		const dx = event.clientX - deckStartX;
		const dy = event.clientY - deckStartY;
		if (!isDeckDragging) {
			if (Math.max(Math.abs(dx), Math.abs(dy)) < DECK_DRAG_THRESHOLD) return;
			// 纵向手势留给页面滚动；只有横向拖动才捕获指针并拦住后续点击。
			if (Math.abs(dx) <= Math.abs(dy)) {
				resetDeckDrag();
				startDeckCycle();
				return;
			}
			isDeckDragging = true;
			suppressDeckClick = true;
			deck.setPointerCapture(event.pointerId);
			deck.setAttribute("data-dragging", "");
		}
		event.preventDefault();
		deckOffset = Math.max(-deckDragWidth, Math.min(dx, deckDragWidth));
		const tilt = (deckOffset / deckDragWidth) * DECK_DRAG_TILT;
		deckDragCard.style.transform = `translateX(${deckOffset}px) rotate(${tilt}deg)`;
	};

	const onDeckUp = (event: PointerEvent): void => {
		if (event.pointerId !== deckPointerId) return;
		const shouldAdvance =
			isDeckDragging &&
			Math.abs(deckOffset) >= deckDragWidth * DECK_DRAG_COMMIT_RATIO;
		const direction = deckOffset < 0 ? 1 : -1;
		resetDeckDrag();
		if (shouldAdvance) advanceDeck(direction);
		startDeckCycle();
	};

	const onDeckCancel = (event: PointerEvent): void => {
		if (event.pointerId !== deckPointerId) return;
		resetDeckDrag();
		startDeckCycle();
	};

	const onDeckClick = (event: MouseEvent): void => {
		if (!suppressDeckClick || event.detail === 0) return;
		suppressDeckClick = false;
		// 拖拽结束仍会合成 click，必须在捕获阶段同时阻止链接跳转与外层卡片展开。
		event.preventDefault();
		event.stopPropagation();
	};

	const onDeckKeyDown = (event: KeyboardEvent): void => {
		if (activeId === "posts") return;
		if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
		event.preventDefault();
		event.stopPropagation();
		advanceDeck(event.key === "ArrowRight" ? 1 : -1);
	};

	const onDeckDragStart = (event: DragEvent): void => {
		// 封面与链接的原生拖放会截断 pointermove，统一使用上面的跟手翻牌。
		event.preventDefault();
	};

	deck?.addEventListener("pointerdown", onDeckDown);
	window.addEventListener("pointermove", onDeckMove, { passive: false });
	window.addEventListener("pointerup", onDeckUp);
	window.addEventListener("pointercancel", onDeckCancel);
	deck?.addEventListener("lostpointercapture", onDeckCancel);
	deck?.addEventListener("click", onDeckClick, { capture: true });
	deck?.addEventListener("keydown", onDeckKeyDown);
	deck?.addEventListener("dragstart", onDeckDragStart);

	/* 展开态：悬停手风琴里的哪一条，左侧就换成那张封面 */
	const indexOfPick = (node: Element | null): number | null => {
		const hit = node?.closest<HTMLElement>(POST_PICK_SELECTOR);
		const raw = hit?.dataset.postPick;
		if (raw === undefined) return null;
		const index = Number(raw);
		return Number.isInteger(index) ? index : null;
	};

	const onPickOver = (event: PointerEvent): void => {
		const index = indexOfPick(event.target as Element | null);
		if (index !== null) showDeckCard(index);
	};

	const onPickOut = (): void => {
		showDeckCard(deckAnchor);
	};

	/* ---- 手风琴：一组只开一项 ----
	   开合本身全在 CSS（data-open 驱动边框、圆角与面板高度），这里只保证互斥：
	   点已开的那项就收起来，点别的那项就把前一项关掉。两张卡各自成组，
	   所以作用域限定在被点的这个 .acc 之内 */
	const accHeads = Array.from(
		root.querySelectorAll<HTMLElement>(ACC_HEAD_SELECTOR),
	);

	const onAccHead = (event: MouseEvent): void => {
		const head = (event.target as Element | null)?.closest<HTMLElement>(
			ACC_HEAD_SELECTOR,
		);
		if (!head) return;
		const item = head.closest(ACC_ITEM_SELECTOR);
		const list = head.closest(".acc");
		if (!item || !list) return;

		const wasOpen = item.hasAttribute("data-open");
		list.querySelectorAll<HTMLElement>(ACC_ITEM_SELECTOR).forEach((other) => {
			other.removeAttribute("data-open");
			other
				.querySelector<HTMLElement>(ACC_HEAD_SELECTOR)
				?.setAttribute("aria-expanded", "false");
		});
		if (wasOpen) return;

		item.setAttribute("data-open", "");
		head.setAttribute("aria-expanded", "true");
	};

	accHeads.forEach((head) => {
		head.addEventListener("click", onAccHead);
	});

	// 只跟随实际指针移动选层，抬层动画合成的 pointerover 不应再次切换读数。
	root.addEventListener("pointermove", onStatMove);
	root.addEventListener("pointerout", onStatOut);
	// 必须早于 onClick 注册：同为 root 上的冒泡阶段监听，先注册的先执行，
	// 才能靠 stopPropagation 挡住「点层被当成点卡收起」
	root.addEventListener("click", onStatClick);

	root.addEventListener("click", onClick);
	root.addEventListener("keydown", onKeyDown);
	/* 手风琴用 pointerover 逐条命中、pointerleave 整体归位。用 pointerout 的话
	   在相邻两条之间挪一格鼠标就会被当成离开，封面来回闪 */
	accordion?.addEventListener("pointerover", onPickOver);
	accordion?.addEventListener("pointerleave", onPickOut);

	let observer: IntersectionObserver | null = null;
	if (reduced) {
		root.dataset.guideEntered = "1";
	} else {
		observer = new IntersectionObserver(
			(entries) => {
				if (!entries.some((entry) => entry.isIntersecting)) return;
				observer?.disconnect();
				observer = null;
				root.dataset.guideEntered = "1";
				// 第一次换内容要等一个完整周期，天然排在入场描线之后
				startStatCycle();
				startDeckCycle();
			},
			{ rootMargin: ENTER_ROOT_MARGIN },
		);
		observer.observe(root);
	}

	return () => {
		observer?.disconnect();
		stopStatCycle();
		stopDeckCycle();
		finishDeckFlight();
		resetDeckDrag();
		deck?.removeEventListener("pointerdown", onDeckDown);
		window.removeEventListener("pointermove", onDeckMove);
		window.removeEventListener("pointerup", onDeckUp);
		window.removeEventListener("pointercancel", onDeckCancel);
		deck?.removeEventListener("lostpointercapture", onDeckCancel);
		deck?.removeEventListener("click", onDeckClick, { capture: true });
		deck?.removeEventListener("keydown", onDeckKeyDown);
		deck?.removeEventListener("dragstart", onDeckDragStart);
		deckShown = 0;
		layoutDeck();
		markLayer("0");
		statReadout?.style.removeProperty("--stat-active");
		unbindStatsPause();
		unbindDeckPause();
		accordion?.removeEventListener("pointerover", onPickOver);
		accordion?.removeEventListener("pointerleave", onPickOut);
		accHeads.forEach((head) => {
			head.removeEventListener("click", onAccHead);
		});
		root.removeEventListener("click", onClick);
		root.removeEventListener("keydown", onKeyDown);
		root.removeEventListener("pointermove", onStatMove);
		root.removeEventListener("pointerout", onStatOut);
		root.removeEventListener("click", onStatClick);
		timeline?.kill();
		gsap.killTweensOf(getCards(root));
		ctx.revert();
		// 三个状态属性必须摘干净：swup 二次进入同一层时若残留，
		// 入场闸门会直接跳过、展开态会把上一代的卡带回来
		delete root.dataset.guideEntered;
		delete root.dataset.guideExpanded;
		delete root.dataset.guideDetail;
		markActive("");
		activeId = "";
		timeline = null;
	};
}
