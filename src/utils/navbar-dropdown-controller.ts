/**
 * 顶部导航共享下拉面板控制器。
 *
 * 交互模型：整条导航只有一个下拉面板（[data-navbar-dropdown-panel]），
 * 悬停哪个带子菜单的导航项，面板就滑到哪一项下方并切换到对应内容页
 * （左右滑动 + 内容交叉淡换），滑到无子菜单的项或离开导航时收起。
 * 各导航项的 .dropdown-container 里只保留触发按钮，内容页由
 * Navbar.astro 集中渲染在面板内，页与项通过 data-dropdown-index /
 * data-dropdown-page 配对。
 *
 * 本模块是常驻组件（导航栏不随 Swup 换页重建）的作用域，
 * pinnedIndex 这类模块级状态在 onNavigation 时统一重置。
 */

import { onNavigation } from "@/utils/swup-lifecycle";

interface PanelElements {
	panel: HTMLElement;
	box: HTMLElement;
	arrow: HTMLElement;
	pages: Map<number, HTMLElement>;
}

/** 键盘 Enter/ArrowDown 打开后的「钉住」态：悬停不再抢占，Escape/外点/导航才收起 */
let pinnedIndex: number | null = null;
let delegationInitialized = false;

function parseIndex(raw: string | undefined): number | null {
	if (raw === undefined) return null;
	const index = Number.parseInt(raw, 10);
	return Number.isInteger(index) ? index : null;
}

function getPanelElements(): PanelElements | null {
	const panel = document.querySelector<HTMLElement>(
		"[data-navbar-dropdown-panel]",
	);
	if (!panel) return null;
	const box = panel.querySelector<HTMLElement>(".navbar-dropdown-box");
	const arrow = panel.querySelector<HTMLElement>(".navbar-dropdown-arrow");
	if (!box || !arrow) return null;

	const pages = new Map<number, HTMLElement>();
	panel
		.querySelectorAll<HTMLElement>("[data-dropdown-page]")
		.forEach((page) => {
			const index = parseIndex(page.dataset.dropdownPage);
			if (index !== null) pages.set(index, page);
		});
	return { panel, box, arrow, pages };
}

function getItemIndex(item: HTMLElement): number | null {
	return parseIndex(item.dataset.dropdownIndex);
}

/** 面板内当前激活页对应的索引 */
function getActivePageIndex(elements: PanelElements): number | null {
	for (const [index, page] of elements.pages) {
		if (page.classList.contains("is-active")) return index;
	}
	return null;
}

/**
 * 面板定位：面板左缘对齐导航项左缘，箭头对齐导航项中心，
 * 箱体尺寸切换到目标内容页（left/宽高均有过渡，产生滑动效果）。
 */
function positionPanel(
	elements: PanelElements,
	item: HTMLElement,
	page: HTMLElement,
): void {
	const navContainer = item.parentElement;
	if (!navContainer) return;
	const navRect = navContainer.getBoundingClientRect();
	const rect = item.getBoundingClientRect();
	elements.panel.style.left = `${rect.left - navRect.left}px`;
	elements.arrow.style.left = `calc(${rect.width / 2}px - 0.375rem)`;
	elements.box.style.width = `${page.offsetWidth}px`;
	elements.box.style.height = `${page.offsetHeight}px`;
}

function freezePanelTransitions(elements: PanelElements): void {
	elements.panel.style.transition = "none";
	elements.arrow.style.transition = "none";
	elements.box.style.transition = "none";
}

function unfreezePanelTransitions(elements: PanelElements): void {
	elements.panel.style.transition = "";
	elements.arrow.style.transition = "";
	elements.box.style.transition = "";
}

function syncTriggerStates(activeIndex: number | null): void {
	document
		.querySelectorAll<HTMLElement>("[data-dropdown]")
		.forEach((container) => {
			const trigger = container.querySelector("[data-dropdown-trigger]");
			const index = getItemIndex(container);
			const isActive = index !== null && index === activeIndex;
			container.classList.toggle("is-dropdown-open", isActive);
			trigger?.setAttribute("aria-expanded", String(isActive));
		});
}

function activatePage(
	elements: PanelElements,
	index: number,
): HTMLElement | null {
	const page = elements.pages.get(index);
	if (!page) return null;
	elements.pages.forEach((p) => {
		p.classList.toggle("is-active", p === page);
	});
	return page;
}

function openForItem(item: HTMLElement, index: number): void {
	const elements = getPanelElements();
	if (!elements) return;
	const page = activatePage(elements, index);
	if (!page) return;

	const wasOpen = elements.panel.classList.contains("is-open");
	if (!wasOpen) {
		// 收起态下打开不做滑动过渡：面板直接就位后仅播放淡入，
		// 避免从上一次关闭时的旧位置滑过来
		freezePanelTransitions(elements);
		positionPanel(elements, item, page);
		void elements.panel.offsetWidth;
		unfreezePanelTransitions(elements);
		elements.panel.classList.add("is-open");
	} else {
		positionPanel(elements, item, page);
	}
	syncTriggerStates(index);
}

export function closeNavbarDropdownPanel(): void {
	pinnedIndex = null;
	const elements = getPanelElements();
	if (!elements) return;
	elements.panel.classList.remove("is-open");
	elements.pages.forEach((inactivePage) => {
		inactivePage.classList.remove("is-active");
	});
	syncTriggerStates(null);
}

/**
 * 悬停驱动的面板同步：item 传 null 表示鼠标已离开导航行。
 * 钉住态（键盘打开）下悬停不抢占面板。
 */
export function syncNavbarDropdownOnHover(item: HTMLElement | null): void {
	if (pinnedIndex !== null) return;
	const elements = getPanelElements();
	if (!elements) return;
	if (!item) {
		closeNavbarDropdownPanel();
		return;
	}
	const index = getItemIndex(item);
	if (index === null || !elements.pages.has(index)) {
		closeNavbarDropdownPanel();
		return;
	}
	openForItem(item, index);
}

/** 键盘打开（钉住）：Enter / ArrowDown 在触发器上触发 */
export function openNavbarDropdownPinned(item: HTMLElement): void {
	const index = getItemIndex(item);
	if (index === null) return;
	pinnedIndex = index;
	openForItem(item, index);
}

export function isNavbarDropdownPinned(): boolean {
	return pinnedIndex !== null;
}

/** 窗口/布局尺寸变化后，让打开中的面板重新对齐当前导航项 */
export function repositionNavbarDropdown(): void {
	if (pinnedIndex !== null) return;
	const elements = getPanelElements();
	if (!elements?.panel.classList.contains("is-open")) return;
	const index = getActivePageIndex(elements);
	if (index === null) return;
	const item = document.querySelector<HTMLElement>(
		`[data-dropdown-index="${index}"]`,
	);
	const page = elements.pages.get(index);
	if (item && page) positionPanel(elements, item, page);
}

function focusFirstPageItem(index: number): void {
	document
		.querySelector<HTMLElement>(
			`[data-dropdown-page="${index}"] .dropdown-item`,
		)
		?.focus();
}

function focusContainerTrigger(index: number): void {
	document
		.querySelector<HTMLElement>(
			`[data-dropdown-index="${index}"] [data-dropdown-trigger]`,
		)
		?.focus();
}

/**
 * 点击 / 键盘的文档级委托。面板在 Swup 容器之外且导航栏常驻，
 * 只需注册一次；pinnedIndex 在 onNavigation 里复位。
 */
export function initNavbarDropdownDelegation(): void {
	if (delegationInitialized) return;
	delegationInitialized = true;

	document.addEventListener("keydown", (event: KeyboardEvent) => {
		const target = event.target as HTMLElement | null;
		const trigger = target?.closest?.(
			"[data-dropdown-trigger]",
		) as HTMLElement | null;
		const pageItem = target?.closest?.(".dropdown-item") as HTMLElement | null;

		if (event.key === "Escape") {
			if (pinnedIndex === null) return;
			const index = pinnedIndex;
			closeNavbarDropdownPanel();
			focusContainerTrigger(index);
			return;
		}

		if (trigger) {
			const container = trigger.closest<HTMLElement>("[data-dropdown]");
			const index = container ? getItemIndex(container) : null;
			if (index === null) return;

			if (event.key === "Enter" || event.key === " ") {
				event.preventDefault();
				if (pinnedIndex === index) {
					closeNavbarDropdownPanel();
				} else {
					openNavbarDropdownPinned(trigger);
				}
			} else if (event.key === "ArrowDown") {
				event.preventDefault();
				openNavbarDropdownPinned(trigger);
				focusFirstPageItem(index);
			}
			return;
		}

		if (pageItem) {
			const page = pageItem.closest<HTMLElement>("[data-dropdown-page]");
			if (!page) return;
			const index = parseIndex(page.dataset.dropdownPage);
			if (index === null) return;
			const items = Array.from(
				page.querySelectorAll<HTMLElement>(".dropdown-item"),
			);
			if (event.key === "ArrowDown") {
				event.preventDefault();
				const current = items.indexOf(pageItem);
				items[(current + 1) % items.length]?.focus();
			} else if (event.key === "ArrowUp") {
				event.preventDefault();
				const current = items.indexOf(pageItem);
				items[(current - 1 + items.length) % items.length]?.focus();
			}
		}
	});

	document.addEventListener("click", (event) => {
		const target = event.target as HTMLElement;
		const actionButton = target.closest("[data-action]");
		if (actionButton) {
			const action = actionButton.getAttribute("data-action");
			if (action) window.dispatchEvent(new CustomEvent(action));
		}

		if (target.closest(".dropdown-item")) {
			closeNavbarDropdownPanel();
			(document.activeElement as HTMLElement | null)?.blur?.();
			return;
		}

		// 触发器区域（含导航行内的其他项）交给悬停逻辑，不在此收起
		if (
			!target.closest("[data-dropdown]") &&
			!target.closest("[data-navbar-dropdown-panel]")
		) {
			closeNavbarDropdownPanel();
		}
	});

	onNavigation(() => closeNavbarDropdownPanel());
	window.addEventListener("pageshow", () => closeNavbarDropdownPanel());
}
