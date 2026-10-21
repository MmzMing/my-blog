/**
 * Mermaid 节点文字贴边补偿。
 *
 * 图表在构建期由 merman（无头）渲染，它的字体度量把中日韩字符按半宽估算，
 * 节点框因此偏窄；浏览器按真实字体排版时文字会多折一行，压到节点下边框。
 * merman 没有可用的补偿参数，只能在渲染完成后用真实度量把框撑开：
 * 先加宽（消除多余折行），再按实际文字高度补足纵向空间。
 */

/** 单个节点横向最多放宽的比例，避免异常字体下把整张图撑坏 */
const MAX_WIDTH_GROWTH = 1.6;
/** 节点内文字与边框保留的最小水平留白 */
const MIN_HORIZONTAL_PADDING = 8;
/** 文字与节点上下边框的最小间距，与构建期 flowchart.padding 对应 */
const MIN_VERTICAL_PADDING = 10;

interface NodeGeometry {
	box: SVGRectElement;
	label: Element;
	boxX: number;
	boxWidth: number;
	boxY: number;
	boxHeight: number;
	labelX: number;
	labelY: number;
}

function readNumber(value: string | null): number {
	const parsed = Number.parseFloat(value ?? "");
	return Number.isFinite(parsed) ? parsed : 0;
}

function getGeometry(node: Element): NodeGeometry | null {
	const box = node.querySelector<SVGRectElement>("rect");
	const label = node.querySelector("foreignObject, text");
	if (!box || !label) return null;
	return {
		box,
		label,
		boxX: readNumber(box.getAttribute("x")),
		boxWidth: readNumber(box.getAttribute("width")),
		boxY: readNumber(box.getAttribute("y")),
		boxHeight: readNumber(box.getAttribute("height")),
		labelX: readNumber((label as Element).getAttribute("x")),
		labelY: readNumber((label as Element).getAttribute("y")),
	};
}

function fitNode(node: Element): void {
	const geometry = getGeometry(node);
	if (!geometry) return;
	const { box, label, boxX, boxWidth, boxY, boxHeight, labelX } = geometry;

	const textWidth = label.getBoundingClientRect().width;
	const neededWidth = textWidth + MIN_HORIZONTAL_PADDING * 2;
	const width = Math.max(
		boxWidth,
		Math.min(neededWidth, boxWidth * MAX_WIDTH_GROWTH),
	);
	if (width > boxWidth + 0.5) {
		const extra = width - boxWidth;
		box.setAttribute("width", String(width));
		box.setAttribute("x", String(boxX - extra / 2));
		label.setAttribute("width", String(width - MIN_HORIZONTAL_PADDING * 2));
		label.setAttribute("x", String(labelX - extra / 2));
	}

	// 加宽后折行数可能变化，重新量一次文字高度再决定纵向要不要补
	const textHeight = label.getBoundingClientRect().height;
	const neededHeight = textHeight + MIN_VERTICAL_PADDING * 2;
	if (neededHeight > boxHeight + 0.5) {
		const extra = neededHeight - boxHeight;
		box.setAttribute("height", String(neededHeight));
		box.setAttribute("y", String(boxY - extra / 2));
		label.setAttribute("height", String(textHeight));
		label.setAttribute("y", String(-textHeight / 2));
	}
}

function fitSvg(svg: SVGSVGElement): void {
	if (svg.dataset.labelFitted === "true") return;
	svg.dataset.labelFitted = "true";
	for (const node of Array.from(svg.querySelectorAll(".node"))) {
		fitNode(node);
	}
}

/** 只处理当前可见的那份 SVG：display:none 的那份量不到真实尺寸 */
function fitVisibleSvgs(): void {
	for (const svg of Array.from(
		document.querySelectorAll<SVGSVGElement>(
			".mermaid-svg-light svg, .mermaid-svg-dark svg",
		),
	)) {
		if (svg.getBoundingClientRect().width === 0) continue;
		fitSvg(svg);
	}
}

declare global {
	interface Window {
		__mermaidLabelFitThemeListener?: boolean;
	}
}

export function scheduleMermaidLabelFit(): void {
	requestAnimationFrame(fitVisibleSvgs);

	// 构建期同时产出明暗两份 SVG，只有可见的那份量得到尺寸；换主题后补跑一次。
	// 监听挂在 window 上且只装一次，页面孤岛重复挂载也不会叠加。
	if (window.__mermaidLabelFitThemeListener) return;
	window.__mermaidLabelFitThemeListener = true;
	window.addEventListener("theme-change", () => {
		requestAnimationFrame(fitVisibleSvgs);
	});
}
