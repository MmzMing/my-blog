/**
 * 正文内容溢出增强：给 KaTeX 行间公式和宽表格套一层横向滚动容器。
 *
 * 两个函数都用 `:not([data-*])` 选择器跳过已处理的节点，因此可以重复调用；
 * 调用时机由 [layout-init.ts](./layout-init.ts) 统一编排，不要在这里挂事件。
 */

function initKatexScrollContainers(): void {
	const katexElements = document.querySelectorAll<HTMLElement>(
		".katex-display:not([data-scrollbar-initialized])",
	);
	katexElements.forEach((element) => {
		if (!element.parentNode) return;
		const container = document.createElement("div");
		container.className = "katex-display-container";
		element.parentNode.insertBefore(container, element);
		container.appendChild(element);
		container.style.cssText = "overflow-x: auto;";
		element.setAttribute("data-scrollbar-initialized", "true");
	});
}

function initTableScrollContainers(): void {
	const tables = document.querySelectorAll<HTMLElement>(
		".custom-md table:not([data-horizontal-scroll-ready])",
	);
	tables.forEach((table) => {
		if (table.parentElement?.classList.contains("horizontal-scroll-container")) {
			table.dataset.horizontalScrollReady = "true";
			return;
		}
		const container = document.createElement("div");
		container.className = "horizontal-scroll-container";
		table.parentNode?.insertBefore(container, table);
		container.appendChild(table);
		table.dataset.horizontalScrollReady = "true";
	});
}

/**
 * 下一帧执行一次增强。
 * 放到 rAF 里是为了不和 Swup 换入内容的那一帧抢主线程 —— 这两个函数都会插入节点、
 * 触发布局，同步跑会直接叠在切页最忙的时刻上。
 */
export function scheduleContentOverflowEnhancements(): void {
	requestAnimationFrame(() => {
		initKatexScrollContainers();
		initTableScrollContainers();
	});
}
