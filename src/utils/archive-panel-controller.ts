import { definePageIsland } from "@/utils/swup-lifecycle";

const ROW_SELECTOR = "[data-archive-toggle], [data-archive-link]";

function mountArchivePanel(panel: HTMLElement): () => void {
	const controller = new AbortController();
	const { signal } = controller;
	const tabs = [
		...panel.querySelectorAll<HTMLButtonElement>("[data-archive-tab]"),
	];
	const views = [...panel.querySelectorAll<HTMLElement>("[data-archive-view]")];
	const firstView = views.find((view) => !view.hidden);
	if (!firstView) return () => controller.abort();
	let activeView = firstView;
	let highlightedRow: HTMLElement | null = null;
	let selectedRow: HTMLElement | null = null;
	let isPinned = true;
	const preparedViews = new Set<HTMLElement>();
	const params = new URLSearchParams(window.location.search);
	const tags = params
		.getAll("tag")
		.map((value) => value.trim())
		.filter(Boolean);
	const categories = params
		.getAll("category")
		.map((value) => value.trim())
		.filter(Boolean);
	const hasUncategorized = params.has("uncategorized");
	const hasFilter =
		tags.length > 0 || categories.length > 0 || hasUncategorized;
	const bulk = panel.querySelector<HTMLButtonElement>("[data-archive-bulk]");
	const bulkLabel = panel.querySelector<HTMLElement>(
		"[data-archive-bulk-label]",
	);
	const switcher = panel.querySelector<HTMLElement>("[data-archive-switcher]");
	const switchTrigger = panel.querySelector<HTMLButtonElement>(
		"[data-archive-switch-trigger]",
	);
	const switchOptions = panel.querySelector<HTMLElement>(
		"[data-archive-options]",
	);
	const currentLabel = panel.querySelector<HTMLElement>(
		"[data-archive-current-label]",
	);
	const total = panel.querySelector<HTMLElement>("[data-archive-total]");
	const empty = panel.querySelector<HTMLElement>("[data-archive-empty]");

	function setSwitcherOpen(isOpen: boolean, focusTab = false): void {
		if (!switcher || !switchTrigger || !switchOptions) return;
		// 收起前把焦点交还触发按钮，隐藏的 tabs 不参与后续键盘导航。
		if (!isOpen && switchOptions.contains(document.activeElement))
			switchTrigger.focus({ preventScroll: true });
		switcher.toggleAttribute("data-open", isOpen);
		switchTrigger.setAttribute("aria-expanded", String(isOpen));
		switchOptions.setAttribute("aria-hidden", String(!isOpen));
		switchOptions.inert = !isOpen;
		for (const tab of tabs) {
			const isSelected = tab.getAttribute("aria-selected") === "true";
			tab.tabIndex = isOpen && isSelected ? 0 : -1;
			if (isOpen && isSelected && focusTab) tab.focus({ preventScroll: true });
		}
	}

	// 钉住后胶囊常驻，hover 移开、焦点移出、点击外部都不再触发收起。
	function setPinned(pinned: boolean): void {
		isPinned = pinned;
		switcher?.toggleAttribute("data-pinned", pinned);
		switchTrigger?.setAttribute("aria-pressed", String(pinned));
	}

	function collapseSwitcher(): void {
		if (isPinned) return;
		setSwitcherOpen(false);
	}

	function clearHighlight(): void {
		activeView
			.querySelector("[data-archive-tree]")
			?.removeAttribute("data-highlighted");
		highlightedRow = null;
	}

	function highlightRow(row: HTMLElement): void {
		if (highlightedRow === row) return;
		const tree = activeView.querySelector<HTMLElement>("[data-archive-tree]");
		const highlight = tree?.querySelector<HTMLElement>(
			"[data-archive-highlight]",
		);
		if (!tree || !highlight) return;
		const bounds = tree.getBoundingClientRect();
		const target = row.getBoundingClientRect();
		highlight.style.transitionDuration = highlightedRow ? "" : "0ms";
		highlight.style.transform = `translate(${target.left - bounds.left}px, ${target.top - bounds.top}px)`;
		highlight.style.width = `${target.width}px`;
		highlight.style.height = `${target.height}px`;
		placeSpineFocus(tree, row, bounds, target);
		tree.setAttribute("data-highlighted", "");
		highlightedRow = row;
	}

	// 某一行所属的脊线由「装着它的那个分组」绘制，所以取父分组的箭头中心当 x。
	function placeSpineFocus(
		tree: HTMLElement,
		row: HTMLElement,
		bounds: DOMRect,
		target: DOMRect,
	): void {
		const spine = tree.querySelector<HTMLElement>("[data-archive-spine-focus]");
		if (!spine) return;
		const host = row
			.closest("li")
			?.parentElement?.closest<HTMLElement>(".archive-panel__group");
		const chevron = host?.querySelector<HTMLElement>(
			":scope > .archive-panel__heading .archive-panel__chevron",
		);
		spine.hidden = !chevron;
		if (!chevron) return;
		const center = chevron.getBoundingClientRect();
		spine.style.height = `${target.height * 0.5}px`;
		spine.style.transform = `translate(${center.left + center.width / 2 - bounds.left}px, ${target.top + target.height * 0.25 - bounds.top}px)`;
	}

	function restoreSelection(): void {
		if (selectedRow && !selectedRow.closest("[hidden], [inert]"))
			highlightRow(selectedRow);
		else clearHighlight();
	}

	function setGroupOpen(
		group: HTMLElement,
		isOpen: boolean,
		animate: boolean,
	): void {
		const button = group.querySelector<HTMLButtonElement>(
			"[data-archive-toggle]",
		);
		const content = group.querySelector<HTMLElement>("[data-archive-content]");
		if (!button || !content) return;
		// 先移走焦点再设 inert，收起后不会留下不可见的键盘焦点。
		if (!isOpen && content.contains(document.activeElement)) button.focus();
		if (!isOpen && selectedRow && content.contains(selectedRow))
			selectedRow = null;
		group.toggleAttribute("data-entering", isOpen && animate);
		group.toggleAttribute("data-open", isOpen);
		button.setAttribute("aria-expanded", String(isOpen));
		content.setAttribute("aria-hidden", String(!isOpen));
		content.inert = !isOpen;
	}

	function updateBulk(): void {
		const groups = [
			...activeView.querySelectorAll<HTMLElement>(
				"[data-archive-group]:not([hidden])",
			),
		];
		const isAllOpen =
			groups.length > 0 &&
			groups.every((group) => group.hasAttribute("data-open"));
		if (bulk) {
			bulk.disabled = groups.length === 0;
			bulk.toggleAttribute("data-all-open", isAllOpen);
			bulk.setAttribute(
				"aria-label",
				(isAllOpen ? panel.dataset.labelCollapse : panel.dataset.labelExpand) ??
					"",
			);
		}
		if (bulkLabel)
			bulkLabel.textContent =
				(isAllOpen ? panel.dataset.labelCollapse : panel.dataset.labelExpand) ??
				"";
	}

	function prepareView(view: HTMLElement): void {
		if (preparedViews.has(view)) return;
		const template = view.querySelector<HTMLTemplateElement>(
			"[data-archive-template]",
		);
		if (template) template.replaceWith(template.content.cloneNode(true));
		const visibleIds = new Set<string>();
		for (const row of view.querySelectorAll<HTMLElement>("[data-post-id]")) {
			// data-tags 由 ArchiveTree 的 JSON.stringify 生成，不接收外部 HTML。
			const rowTags: unknown = JSON.parse(row.dataset.tags ?? "[]");
			const matchesTags =
				tags.length === 0 ||
				(Array.isArray(rowTags) &&
					rowTags.some(
						(tag: unknown) => typeof tag === "string" && tags.includes(tag),
					));
			const category = row.dataset.category ?? "";
			const matchesCategory =
				categories.length === 0 ||
				(category !== "" && categories.includes(category));
			const isMatched =
				matchesTags &&
				matchesCategory &&
				(!hasUncategorized || category === "");
			row.hidden = !isMatched;
			if (isMatched && row.dataset.postId) visibleIds.add(row.dataset.postId);
		}
		for (const group of view.querySelectorAll<HTMLElement>(
			"[data-archive-group]",
		)) {
			const count = group.querySelectorAll(
				"[data-post-id]:not([hidden])",
			).length;
			group.hidden = count === 0;
			const countLabel = group.querySelector<HTMLElement>(
				"[data-archive-count]",
			);
			if (countLabel) countLabel.textContent = String(count).padStart(2, "0");
			const accessibleCount = group.querySelector<HTMLElement>(
				"[data-archive-count-label]",
			);
			if (accessibleCount)
				accessibleCount.textContent = `${count} ${count === 1 ? panel.dataset.labelPostOne : panel.dataset.labelPostMany}`;
			setGroupOpen(group, hasFilter || group.hasAttribute("data-open"), false);
		}
		view.setAttribute("role", "tabpanel");
		view.setAttribute(
			"aria-labelledby",
			`archive-tab-${view.dataset.archiveView}`,
		);
		view.tabIndex = 0;
		preparedViews.add(view);
		view.dataset.archiveGroupTotal = String(
			view.querySelectorAll(
				'[data-depth="0"] > [data-archive-group]:not([hidden])',
			).length,
		);
		if (empty) empty.hidden = visibleIds.size > 0;
	}

	function selectTab(tab: HTMLButtonElement): void {
		const nextView = views.find(
			(view) => view.dataset.archiveView === tab.dataset.archiveTab,
		);
		if (!nextView) return;
		clearHighlight();
		selectedRow = null;
		prepareView(nextView);
		for (const view of views) view.hidden = view !== nextView;
		activeView = nextView;
		for (const item of tabs) {
			item.setAttribute("aria-selected", String(item === tab));
			item.tabIndex =
				item === tab && switcher?.hasAttribute("data-open") ? 0 : -1;
		}
		if (currentLabel) currentLabel.textContent = tab.dataset.archiveLabel ?? "";
		if (total) total.textContent = nextView.dataset.archiveGroupTotal ?? "0";
		panel.style.setProperty("--archive-tab-index", String(tabs.indexOf(tab)));
		updateBulk();
	}

	panel.addEventListener(
		"click",
		(event) => {
			if (!(event.target instanceof Element)) return;
			if (event.target.closest("[data-archive-switch-trigger]")) {
				setPinned(!isPinned);
				setSwitcherOpen(true, event.detail === 0);
				return;
			}
			const tab = event.target.closest<HTMLButtonElement>("[data-archive-tab]");
			if (tab) {
				selectTab(tab);
				if (window.matchMedia("(hover: none)").matches) collapseSwitcher();
				return;
			}
			const toggle = event.target.closest<HTMLButtonElement>(
				"[data-archive-toggle]",
			);
			if (toggle) {
				const group = toggle.closest<HTMLElement>("[data-archive-group]");
				if (group) {
					clearHighlight();
					selectedRow = toggle;
					setGroupOpen(group, !group.hasAttribute("data-open"), true);
					updateBulk();
					highlightRow(toggle);
				}
				return;
			}
			if (event.target.closest("[data-archive-bulk]")) {
				clearHighlight();
				selectedRow = null;
				const isOpen = !bulk?.hasAttribute("data-all-open");
				for (const group of activeView.querySelectorAll<HTMLElement>(
					"[data-archive-group]:not([hidden])",
				))
					setGroupOpen(group, isOpen, true);
				updateBulk();
			}
		},
		{ signal },
	);

	panel.addEventListener(
		"keydown",
		(event) => {
			if (!(event.target instanceof Element)) return;
			if (switcher?.contains(event.target)) {
				if (event.key === "Escape") {
					event.preventDefault();
					setPinned(false);
					setSwitcherOpen(false);
					return;
				}
				if (
					event.target.closest("[data-archive-switch-trigger]") &&
					["ArrowLeft", "ArrowDown"].includes(event.key)
				) {
					event.preventDefault();
					setSwitcherOpen(true, true);
					return;
				}
			}
			const tab = event.target.closest<HTMLButtonElement>("[data-archive-tab]");
			if (tab) {
				const index = tabs.indexOf(tab);
				let nextIndex = index;
				if (event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
				else if (event.key === "ArrowLeft")
					nextIndex = (index + tabs.length - 1) % tabs.length;
				else if (event.key === "Home") nextIndex = 0;
				else if (event.key === "End") nextIndex = tabs.length - 1;
				else return;
				event.preventDefault();
				const nextTab = tabs[nextIndex];
				if (nextTab) {
					selectTab(nextTab);
					nextTab.focus();
				}
				return;
			}
			const row = event.target.closest<HTMLElement>(ROW_SELECTOR);
			if (
				!row ||
				![
					"ArrowUp",
					"ArrowDown",
					"ArrowLeft",
					"ArrowRight",
					"Home",
					"End",
				].includes(event.key)
			)
				return;
			const rows = [
				...activeView.querySelectorAll<HTMLElement>(ROW_SELECTOR),
			].filter((item) => !item.closest("[hidden], [inert]"));
			const index = rows.indexOf(row);
			const group = row.closest<HTMLElement>("[data-archive-group]");
			event.preventDefault();
			if (event.key === "ArrowDown")
				rows[Math.min(index + 1, rows.length - 1)]?.focus();
			else if (event.key === "ArrowUp") rows[Math.max(0, index - 1)]?.focus();
			else if (event.key === "Home") rows[0]?.focus();
			else if (event.key === "End") rows[rows.length - 1]?.focus();
			else if (
				event.key === "ArrowRight" &&
				row.matches("[data-archive-toggle]") &&
				group
			) {
				if (!group.hasAttribute("data-open")) {
					clearHighlight();
					setGroupOpen(group, true, true);
				} else if (rows[index + 1] && group.contains(rows[index + 1]))
					rows[index + 1].focus();
			} else if (event.key === "ArrowLeft" && group) {
				if (
					row.matches("[data-archive-toggle]") &&
					group.hasAttribute("data-open")
				) {
					clearHighlight();
					setGroupOpen(group, false, true);
				} else {
					const parent = row.matches("[data-archive-toggle]")
						? group.parentElement?.closest<HTMLElement>("[data-archive-group]")
						: group;
					parent
						?.querySelector<HTMLButtonElement>("[data-archive-toggle]")
						?.focus();
				}
			}
			updateBulk();
		},
		{ signal },
	);

	switcher?.addEventListener(
		"pointerenter",
		(event) => {
			if (event.pointerType !== "touch") setSwitcherOpen(true);
		},
		{ signal },
	);
	switcher?.addEventListener(
		"pointerleave",
		() => {
			const focused = document.activeElement;
			if (
				focused instanceof HTMLElement &&
				switcher.contains(focused) &&
				focused.matches(":focus-visible")
			)
				return;
			collapseSwitcher();
		},
		{ signal },
	);
	switcher?.addEventListener(
		"focusout",
		(event) => {
			if (
				!(event.relatedTarget instanceof Node) ||
				!switcher.contains(event.relatedTarget)
			)
				collapseSwitcher();
		},
		{ signal },
	);
	document.addEventListener(
		"pointerdown",
		(event) => {
			if (event.target instanceof Node && !switcher?.contains(event.target))
				collapseSwitcher();
		},
		{ signal },
	);

	panel.addEventListener(
		"pointerover",
		(event) => {
			if (event.pointerType === "touch" || !(event.target instanceof Element))
				return;
			const row = event.target.closest<HTMLElement>(ROW_SELECTOR);
			if (row) highlightRow(row);
			else restoreSelection();
		},
		{ signal },
	);
	panel.addEventListener("pointerleave", restoreSelection, { signal });
	panel.addEventListener(
		"focusin",
		(event) => {
			if (!(event.target instanceof Element)) return;
			const row = event.target.closest<HTMLElement>(ROW_SELECTOR);
			if (row) highlightRow(row);
		},
		{ signal },
	);
	panel.addEventListener(
		"focusout",
		(event) => {
			if (
				!(event.relatedTarget instanceof Element) ||
				!event.relatedTarget.closest(ROW_SELECTOR)
			)
				restoreSelection();
		},
		{ signal },
	);
	window.addEventListener("resize", clearHighlight, { signal, passive: true });

	// 过滤条件并进面包屑：视图名后面用箭头接上命中的标签/分类，不再单独占一张卡片。
	const filterTerm = panel.querySelector<HTMLElement>(
		"[data-archive-filter-term]",
	);
	const filterTermText = panel.querySelector<HTMLElement>(
		"[data-archive-filter-term-text]",
	);
	if (hasFilter && filterTerm && filterTermText) {
		const terms: string[] = [];
		if (tags.length) terms.push(...tags.map((tag) => `#${tag}`));
		if (categories.length) terms.push(...categories);
		if (hasUncategorized) terms.push(panel.dataset.labelUncategorized ?? "");
		filterTermText.textContent = terms.join(" / ");
		filterTerm.hidden = false;
	}
	// 胶囊默认钉住展开：视图切换是归档页的主操作，不该藏在 hover 之后。
	setPinned(true);
	setSwitcherOpen(true);
	const initialTab = tabs.find(
		(tab) =>
			tab.dataset.archiveTab ===
			(tags.length
				? "tag"
				: categories.length || hasUncategorized
					? "category"
					: "time"),
	);
	if (initialTab) selectTab(initialTab);
	panel.setAttribute("data-enhanced", "");
	return () => {
		controller.abort();
		clearHighlight();
		for (const animation of panel.getAnimations({ subtree: true }))
			animation.cancel();
	};
}

export function registerArchivePanel(): void {
	let cleanup: (() => void) | undefined;
	definePageIsland({
		name: "archive-panel",
		mount: () => {
			const panel = document.querySelector<HTMLElement>("[data-archive-panel]");
			if (panel) cleanup = mountArchivePanel(panel);
		},
		unmount: () => {
			cleanup?.();
			cleanup = undefined;
		},
	});
}
