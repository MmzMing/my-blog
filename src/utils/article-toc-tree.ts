/**
 * 文章 TOC 树：标题采集 + 层级归一化，纯数据模块。
 * 右侧大纲面板（article-toc-panel-controller）与思维导图弹窗共用这一份结构。
 *
 * 归一化规则：正文里出现的最浅标题层级视为一级；每个节点的父节点是
 * 它前面最近的更浅层级标题，找不到就挂到文章标题（根）下——
 * 「没有 h1 时 h2 直接挂根」「h1 后直接跟 h3 时 h3 归入该 h1」都是这条规则的特例。
 */

/** 面板与导图关注的标题层级上限 */
export const TOC_HEADING_SELECTOR = "h1, h2, h3";

export interface TocNode {
	/** 文档顺序的扁平下标，与 DOM 上的 data-toc-index 一致 */
	index: number;
	/** 归一化层级：文章标题的直接子级为 1，向下递增 */
	level: number;
	/** 原始标题层级（h1=1 … h3=3），建栈时使用 */
	depth: number;
	text: string;
	/** 标题元素 id；缺失时点击跳转仍可用（按元素位置滚动），只是不写 hash */
	id: string | null;
	element: HTMLElement;
	/** 父节点下标，根层级为 -1 */
	parent: number;
	/** 子节点下标列表 */
	children: number[];
	/** 子树覆盖的扁平下标区间（含自身），闭区间；子孙在文档序上必然连续 */
	subtreeStart: number;
	subtreeEnd: number;
}

export interface TocTree {
	/** 文章标题文本（根节点） */
	title: string;
	/** 文章标题元素；取不到时点击根节点回页顶 */
	titleElement: HTMLElement | null;
	nodes: TocNode[];
	/** 归一化最大层级，决定面板缩进与导图列数 */
	maxLevel: number;
}

/** 标题纯文本：剔除锚点图标、脚本等渲染噪声（沿用旧 TOC 的清理范围） */
function getHeadingText(heading: HTMLElement): string {
	const clone = heading.cloneNode(true) as HTMLElement;
	clone
		.querySelectorAll(
			"script, style, .anchor, .anchor-icon, [data-pagefind-ignore]",
		)
		.forEach((element) => {
			element.remove();
		});

	const text = clone.textContent?.replace(/#+\s*$/, "").trim();
	return text || heading.getAttribute("aria-label") || heading.id || "Heading";
}

/**
 * 从当前文档采集正文标题并建树。
 * 返回 null 表示没有可用的正文容器或标题，调用方应隐藏整个面板。
 */
export function collectTocTree(): TocTree | null {
	const content =
		document.querySelector(".custom-md") ??
		document.querySelector(".prose") ??
		document.querySelector(".markdown-content");
	if (!content) return null;

	const elements = Array.from(
		content.querySelectorAll<HTMLElement>(TOC_HEADING_SELECTOR),
	);
	if (elements.length === 0) return null;

	const titleElement = document.querySelector<HTMLElement>(".post-hero__title");
	const title = titleElement?.textContent?.trim() || "";

	const nodes: TocNode[] = [];
	/** 当前祖先链（各层级最近一个未闭合节点的下标） */
	const stack: number[] = [];

	for (const element of elements) {
		const depth = Number.parseInt(element.tagName.slice(1), 10);
		while (stack.length > 0 && nodes[stack[stack.length - 1]].depth >= depth) {
			stack.pop();
		}
		const parent = stack.length > 0 ? stack[stack.length - 1] : -1;
		const node: TocNode = {
			index: nodes.length,
			level: stack.length + 1,
			depth,
			text: getHeadingText(element),
			id: element.id || null,
			element,
			parent,
			children: [],
			subtreeStart: nodes.length,
			subtreeEnd: nodes.length,
		};
		if (parent >= 0) nodes[parent].children.push(node.index);
		nodes.push(node);
		stack.push(node.index);
	}

	/* 后序合并子树区间：父节点的区间 = 自身 ∪ 所有子孙 */
	for (let i = nodes.length - 1; i >= 0; i -= 1) {
		const node = nodes[i];
		if (node.parent < 0) continue;
		const parentNode = nodes[node.parent];
		parentNode.subtreeStart = Math.min(
			parentNode.subtreeStart,
			node.subtreeStart,
		);
		parentNode.subtreeEnd = Math.max(parentNode.subtreeEnd, node.subtreeEnd);
	}

	return {
		title,
		titleElement,
		nodes,
		maxLevel: nodes.reduce((max, node) => Math.max(max, node.level), 1),
	};
}
