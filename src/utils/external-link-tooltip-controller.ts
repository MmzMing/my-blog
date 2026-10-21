/**
 * 外链跳转提示：悬停正文外链时，在鼠标上方显示「点击跳转：<href>」并跟随移动。
 * 用 JS 浮层而不是 title / ::before：title 样式与延迟不可控，
 * 伪元素 content 会被算进链接的可访问名称（见 rehype-external-links 的取舍）。
 */

const LINK_SELECTOR = "a.external-link[href]";
const TOOLTIP_CLASS = "external-link-tooltip";
/** 提示框底边与指针的间距 */
const POINTER_OFFSET = 14;
/** 提示框与视口边缘的最小留白 */
const EDGE_MARGIN = 8;

let tooltipEl: HTMLElement | null = null;
let activeLink: HTMLAnchorElement | null = null;

function getTooltip(): HTMLElement {
	if (!tooltipEl) {
		tooltipEl = document.createElement("div");
		tooltipEl.className = TOOLTIP_CLASS;
		tooltipEl.setAttribute("aria-hidden", "true");
		document.body.appendChild(tooltipEl);
	}
	return tooltipEl;
}

function linkFrom(target: EventTarget | null): HTMLAnchorElement | null {
	if (!(target instanceof Element)) return null;
	return target.closest<HTMLAnchorElement>(LINK_SELECTOR);
}

function showFor(link: HTMLAnchorElement): void {
	const tooltip = getTooltip();
	tooltip.textContent = `点击跳转：${link.href}`;
	tooltip.classList.add("is-visible");
	activeLink = link;
}

function hide(): void {
	if (tooltipEl) tooltipEl.classList.remove("is-visible");
	activeLink = null;
}

function moveTooltip(clientX: number, clientY: number): void {
	if (!tooltipEl || !activeLink) return;
	const rect = tooltipEl.getBoundingClientRect();
	const left = Math.min(
		Math.max(clientX - rect.width / 2, EDGE_MARGIN),
		window.innerWidth - rect.width - EDGE_MARGIN,
	);
	const above = clientY - POINTER_OFFSET - rect.height;
	// 顶部放不下时翻到指针下方
	const top = above < EDGE_MARGIN ? clientY + POINTER_OFFSET : above;
	tooltipEl.style.left = `${left}px`;
	tooltipEl.style.top = `${top}px`;
}

export function installExternalLinkTooltipController(): void {
	document.addEventListener("pointerover", (event) => {
		const link = linkFrom(event.target);
		if (!link || link === activeLink) return;
		if (linkFrom(event.relatedTarget) === link) return;
		showFor(link);
	});

	document.addEventListener("pointerout", (event) => {
		const link = linkFrom(event.target);
		if (!link || link !== activeLink) return;
		if (linkFrom(event.relatedTarget) === link) return;
		hide();
	});

	document.addEventListener("pointermove", (event) => {
		if (!activeLink) return;
		moveTooltip(event.clientX, event.clientY);
	});

	// 键盘聚焦时把提示停在链接正上方，位置不跟随指针
	document.addEventListener("focusin", (event) => {
		const link = linkFrom(event.target);
		if (!link) return;
		showFor(link);
		const rect = link.getBoundingClientRect();
		moveTooltip(rect.left + rect.width / 2, rect.top);
	});
	document.addEventListener("focusout", (event) => {
		if (linkFrom(event.target) === activeLink) hide();
	});

	// 滚动会让提示框与指针脱节，直接收起等下一次 pointerover
	window.addEventListener("scroll", hide, { passive: true, capture: true });
}
