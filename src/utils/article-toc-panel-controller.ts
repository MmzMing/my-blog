/**
 * 右侧大纲面板（Obsidian 风格）控制器。
 *
 * 结构：工具栏（手风琴三模式 + 思维导图 + 进度%）/ 节点树（圆点 + SVG 肘形
 * 连接线）/ 思维导图弹窗。树与连接线全部由本控制器在客户端渲染。
 *
 * 坑位备忘：
 * - 面板是 max-height 封顶 + 树内部滚动，配合停靠钳制：面板底边触到正文卡底
 *   后随文档滚走，不悬浮在评论区上；
 * - 连接线坐标取圆点中心相对树容器的位置（含 scrollTop），SVG 作为树的
 *   第一个子节点随内容一起滚，滚动树不需要重画；
 * - 折叠动画用 grid-template-rows 1fr→0fr 过渡（无需 JS 测量高度），动画期间
 *   由 startLineAnimation 逐帧重画连接线，让线跟着行一起动；
 * - 手风琴的展开/收起状态挂在行容器的 is-collapsed 类上，子树隐藏交给
 *   CSS 结构（嵌套列表 + 0fr 裁剪），不再逐行打 is-hidden。
 */

import {
	collectTocTree,
	type TocNode,
	type TocTree,
} from "@/utils/article-toc-tree";
import { definePageIsland } from "@/utils/swup-lifecycle";

/** 活动行居中滚动的节流间隔（沿用旧浏览列表的节奏） */
const READING_OFFSET = 80;
const ACTIVE_SCROLL_THROTTLE = 120;
/** 连接线端点与圆点边缘的留隙（px） */
const LINE_DOT_GAP = 3;
/** 连接线拐角处的圆弧半径（px） */
const LINE_CORNER_RADIUS = 5;
/** 导图缩放边界与步进 */
const MINDMAP_ZOOM_MIN = 0.5;
const MINDMAP_ZOOM_MAX = 2.5;
const MINDMAP_ZOOM_STEP = 0.2;
/** 滚轮缩放的单档倍率与拖拽平移的触发阈值（px） */
const MINDMAP_WHEEL_FACTOR = 1.1;
const MINDMAP_PAN_THRESHOLD = 4;
/* 滚动钳制：面板底边最多到正文卡（含 License/相关文章/上下篇）底部再往上这段
   距离，越过后随文档滚走，不悬浮在评论区上 */
const RAIL_BOTTOM_GAP = 24;
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

function clamp(value: number, minimum: number, maximum: number): number {
	return Math.min(Math.max(value, minimum), maximum);
}

function prefersReducedMotion(): boolean {
	return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export class ArticleTocPanelController {
	private readonly root: HTMLElement;
	private readonly abortController = new AbortController();
	private readonly treeNav: HTMLElement | null;
	private readonly linesSvg: SVGSVGElement | null;
	private readonly autoButton: HTMLButtonElement | null;
	private readonly toggleAllButton: HTMLButtonElement | null;
	private readonly mindmapButton: HTMLButtonElement | null;
	private readonly progressRegion: HTMLElement | null;
	private readonly progressLabel: HTMLElement | null;
	private readonly mindmapDialog: HTMLDialogElement | null;
	private readonly mindmapCanvas: HTMLElement | null;
	private readonly mindmapTree: HTMLElement | null;
	private readonly mindmapLinesSvg: SVGSVGElement | null;
	private readonly mindmapZoomOutButton: HTMLButtonElement | null;
	private readonly mindmapZoomInButton: HTMLButtonElement | null;
	private readonly mindmapResetButton: HTMLButtonElement | null;
	private readonly mindmapFullscreenButton: HTMLButtonElement | null;

	private tree: TocTree | null = null;
	private article: HTMLElement | null = null;
	private articleStart = 0;
	private articleEnd = 0;
	/** 各标题的文档绝对纵坐标，下标对齐 tree.nodes */
	private headingTops: number[] = [];
	/** 自动手风琴（自动收拢）开关；展开跟随不受此开关影响 */
	private autoEnabled = true;
	/** 自动手风琴的手动覆盖：下标 → 期望展开状态（仅开关开启时生效） */
	private manualState = new Map<number, boolean>();
	private activeIndex = -1;
	private activeChain = new Set<number>();
	private lastProgressPercent = -1;
	/** 行 DOM 引用，下标对齐 tree.nodes；根行不在此列 */
	private rows: {
		row: HTMLElement;
		link: HTMLAnchorElement;
		dot: HTMLElement;
		toggle: HTMLButtonElement | null;
	}[] = [];
	private rootDot: HTMLElement | null = null;
	/** 连接线 path，下标对齐 tree.nodes；仅活动/悬停链上的节点持有可见 path */
	private linePaths: (SVGPathElement | null)[] = [];
	/** 悬停中的节点下标，-1 表示无悬停 */
	private hoverIndex = -1;
	private animationFrame: number | null = null;
	private measureFrame: number | null = null;
	private linesFrame: number | null = null;
	/** 折叠动画期间逐帧重画连接线用的帧句柄与截止时刻 */
	private lineAnimFrame: number | null = null;
	private lineAnimUntil = 0;
	private activeScrollTimer: ReturnType<typeof setTimeout> | null = null;
	private resizeObserver: ResizeObserver | null = null;
	private mindmapNodePills: (HTMLElement | null)[] = [];
	private mindmapRootPill: HTMLElement | null = null;
	/** 导图连接线 path，下标对齐 tree.nodes，供悬停链高亮 */
	private mindmapPaths: (SVGPathElement | null)[] = [];
	/** 导图缩放倍率，通过树容器的 font-size（em 体系）生效 */
	private mindmapZoom = 1;
	/** 画布拖拽平移的进行中状态；null 表示未在拖拽 */
	private panState: {
		pointerId: number;
		startX: number;
		startY: number;
		scrollLeft: number;
		scrollTop: number;
	} | null = null;
	/** 刚完成一次拖拽时吞掉随之而来的 click，避免拖拽结束误触节点跳转 */
	private mindmapPanDragged = false;
	/* 停靠钳制状态：面板底边触到正文卡底后随文档滚走（top 逐渐变负） */
	private railBaseTop = 0;
	private railHeight = 0;
	private appliedRailTop: number | null = null;

	constructor(root: HTMLElement) {
		this.root = root;
		this.treeNav = root.querySelector("[data-toc-tree]");
		this.linesSvg = root.querySelector("[data-toc-lines]");
		this.autoButton = root.querySelector("[data-toc-auto-btn]");
		this.toggleAllButton = root.querySelector("[data-toc-toggle-all-btn]");
		this.mindmapButton = root.querySelector("[data-toc-mindmap-btn]");
		this.progressRegion = root.querySelector("[data-toc-progress]");
		this.progressLabel = root.querySelector("[data-toc-progress-label]");
		this.mindmapDialog = root.querySelector("[data-toc-mindmap]");
		this.mindmapCanvas = root.querySelector("[data-toc-mindmap-canvas]");
		this.mindmapTree = root.querySelector("[data-toc-mindmap-tree]");
		this.mindmapLinesSvg = root.querySelector("[data-toc-mindmap-lines]");
		this.mindmapZoomOutButton = root.querySelector(
			"[data-toc-mindmap-zoom-out]",
		);
		this.mindmapZoomInButton = root.querySelector("[data-toc-mindmap-zoom-in]");
		this.mindmapResetButton = root.querySelector("[data-toc-mindmap-reset]");
		this.mindmapFullscreenButton = root.querySelector(
			"[data-toc-mindmap-fullscreen]",
		);
	}

	public init(): boolean {
		this.article =
			document.querySelector(".custom-md") ??
			document.querySelector(".prose") ??
			document.querySelector(".markdown-content");
		this.tree = collectTocTree();
		if (!this.article || !this.tree || !this.treeNav || !this.linesSvg) {
			this.root.hidden = true;
			return false;
		}

		this.root.hidden = false;
		const rootTop = Number.parseFloat(getComputedStyle(this.root).top);
		this.railBaseTop = Number.isNaN(rootTop) ? 0 : rootTop;
		this.cachePositions();
		this.renderRows();
		this.bindInteractions();
		this.resizeObserver = new ResizeObserver(() => this.scheduleMeasure());
		this.resizeObserver.observe(this.article);
		window.addEventListener("scroll", () => this.scheduleUpdate(), {
			passive: true,
			signal: this.abortController.signal,
		});
		window.addEventListener("resize", () => this.scheduleMeasure(), {
			passive: true,
			signal: this.abortController.signal,
		});

		this.root.classList.remove("is-pending");
		this.applyAutoAccordion();
		this.syncToggleAllButton();
		this.scheduleLines();
		this.update();
		return true;
	}

	public destroy(): void {
		this.abortController.abort();
		this.resizeObserver?.disconnect();
		this.resizeObserver = null;
		this.root.style.top = "";
		this.appliedRailTop = null;
		if (this.animationFrame !== null) cancelAnimationFrame(this.animationFrame);
		if (this.measureFrame !== null) cancelAnimationFrame(this.measureFrame);
		if (this.linesFrame !== null) cancelAnimationFrame(this.linesFrame);
		if (this.lineAnimFrame !== null) cancelAnimationFrame(this.lineAnimFrame);
		if (this.activeScrollTimer) clearTimeout(this.activeScrollTimer);
		this.animationFrame = null;
		this.measureFrame = null;
		this.linesFrame = null;
		this.lineAnimFrame = null;
		this.activeScrollTimer = null;
		/* 弹窗还开着时导航走人：显式关掉，避免顶层 layer 残留焦点陷阱 */
		if (this.mindmapDialog?.open) this.mindmapDialog.close();
	}

	/* ---------- 渲染 ---------- */

	private renderRows(): void {
		const tree = this.tree;
		const svg = this.linesSvg;
		const nav = this.treeNav;
		if (!tree || !nav || !svg) return;

		const fragment = document.createDocumentFragment();
		this.rows = [];
		this.linePaths = tree.nodes.map(() => null);

		const rootRow = document.createElement("div");
		rootRow.className = "article-toc-panel__row article-toc-panel__row--root";
		rootRow.dataset.tocIndex = "-1";
		const rootLink = document.createElement("a");
		rootLink.className = "article-toc-panel__link";
		rootLink.href = "#";
		rootLink.dataset.tocNavigate = "-1";
		rootLink.title = tree.title;
		const rootDot = document.createElement("span");
		rootDot.className = "article-toc-panel__dot";
		const rootText = document.createElement("span");
		rootText.className = "article-toc-panel__text";
		rootText.textContent = tree.title;
		rootLink.append(rootDot, rootText);
		rootRow.appendChild(rootLink);
		fragment.appendChild(rootRow);
		this.rootDot = rootDot;

		/* 嵌套列表：子级挂在父级的 children 容器里，折叠动画由 CSS 结构完成 */
		const rootList = document.createElement("ul");
		rootList.className = "article-toc-panel__list";
		tree.nodes
			.filter((node) => node.parent < 0)
			.forEach((node) => {
				this.buildItem(node, rootList);
			});
		fragment.appendChild(rootList);

		nav.replaceChildren(svg, fragment);
	}

	/** 递归构建列表项；children 顺序即文档序，rows 引用也按此顺序入栈 */
	private buildItem(node: TocNode, list: HTMLElement): void {
		const item = document.createElement("li");
		item.className = "article-toc-panel__item";
		item.dataset.tocIndex = String(node.index);

		const row = document.createElement("div");
		row.className = "article-toc-panel__row";
		row.dataset.tocLevel = String(node.level);
		row.style.setProperty("--toc-level", String(node.level));

		const link = document.createElement("a");
		link.className = "article-toc-panel__link";
		link.href = node.id ? `#${encodeURIComponent(node.id)}` : "#";
		link.dataset.tocNavigate = String(node.index);
		link.title = node.text;

		const dot = document.createElement("span");
		dot.className = "article-toc-panel__dot";
		const text = document.createElement("span");
		text.className = "article-toc-panel__text";
		text.textContent = node.text;
		link.append(dot, text);
		row.appendChild(link);

		let toggle: HTMLButtonElement | null = null;
		if (node.children.length > 0) {
			toggle = document.createElement("button");
			toggle.type = "button";
			toggle.className = "article-toc-panel__toggle";
			toggle.dataset.tocToggle = String(node.index);
			toggle.setAttribute("aria-expanded", "true");
			row.appendChild(toggle);
		}
		item.appendChild(row);

		/* rows 必须按文档序（先序）入栈，下标才与 node.index 对齐 */
		this.rows.push({ row, link, dot, toggle });

		if (node.children.length > 0) {
			const wrap = document.createElement("div");
			wrap.className = "article-toc-panel__children";
			const childList = document.createElement("ul");
			childList.className = "article-toc-panel__list";
			node.children.forEach((childIndex) => {
				const child = this.tree?.nodes[childIndex];
				if (child) this.buildItem(child, childList);
			});
			wrap.appendChild(childList);
			item.appendChild(wrap);
		}

		list.appendChild(item);
	}

	/* ---------- 手风琴 ---------- */

	/** 自动手风琴开关：只控制「自动收拢」；展开跟随不受影响。
	    开启时立即按当前阅读位置收拢一次，关闭则非活动分支保持现状 */
	private setAutoEnabled(enabled: boolean): void {
		this.autoEnabled = enabled;
		this.manualState.clear();
		this.autoButton?.setAttribute("aria-pressed", String(enabled));
		if (!enabled) return;

		if (this.applyAutoAccordion()) this.startLineAnimation();
		this.scheduleLines();
		this.syncToggleAllButton();
	}

	/**
	 * 一键展开/收起（一次性动作，与自动开关解耦）：根据当前树状态决定方向，
	 * aria-pressed 表示「当前是否全展开」，图标与 tooltip 预告点击后的动作。
	 */
	private toggleAll(): void {
		this.applyExpandAll(!this.isAllExpanded());
		this.startLineAnimation();
		this.scheduleLines();
		this.syncToggleAllButton();
	}

	private isAllExpanded(): boolean {
		const tree = this.tree;
		if (!tree) return false;
		return tree.nodes.every(
			(node) =>
				node.children.length === 0 ||
				!this.rows[node.index]?.row.classList.contains("is-collapsed"),
		);
	}

	private syncToggleAllButton(): void {
		const button = this.toggleAllButton;
		if (!button) return;

		const expanded = this.isAllExpanded();
		button.setAttribute("aria-pressed", String(expanded));
		const label = expanded
			? (button.dataset.tocCollapseLabel ?? "")
			: (button.dataset.tocExpandLabel ?? "");
		if (!label) return;
		button.setAttribute("aria-label", label);
		button.dataset.tooltip = label;
	}

	/** 当前活动节点的祖先链（含自身） */
	private rebuildActiveChain(): void {
		this.activeChain = new Set<number>();
		const tree = this.tree;
		if (!tree) return;
		let cursor = this.activeIndex;
		while (cursor >= 0) {
			this.activeChain.add(cursor);
			cursor = tree.nodes[cursor].parent;
		}
	}

	/**
	 * 展开跟随 + 自动手风琴：
	 * - 展开跟随始终生效——阅读位置进入哪个分支，该分支（活动链）自动展开；
	 * - 开关只控制「自动收拢」这一半：开启时非活动链分支收拢成手风琴，
	 *   关闭时非活动分支保持现状，只展不收；
	 * - 手动覆盖（行尾箭头）优先，阅读位置滚出其子树区间后解除。
	 * 返回本次是否有折叠状态变化（用于决定是否播放动画）。
	 */
	private applyAutoAccordion(): boolean {
		const tree = this.tree;
		if (!tree) return false;

		let changed = false;
		this.manualState.forEach((_, index) => {
			const node = tree.nodes[index];
			const inside =
				this.activeIndex >= node.subtreeStart &&
				this.activeIndex <= node.subtreeEnd;
			if (!inside) this.manualState.delete(index);
		});

		tree.nodes.forEach((node) => {
			const ref = this.rows[node.index];
			if (!ref?.toggle) return;

			const isCollapsedNow = ref.row.classList.contains("is-collapsed");
			let expanded: boolean;
			if (this.manualState.has(node.index)) {
				expanded = this.manualState.get(node.index) === true;
			} else if (this.activeChain.has(node.index)) {
				expanded = true;
			} else if (!this.autoEnabled) {
				expanded = !isCollapsedNow;
			} else {
				expanded = false;
			}

			const willCollapse = !expanded;
			if (isCollapsedNow !== willCollapse) changed = true;
			ref.row.classList.toggle("is-collapsed", willCollapse);
			ref.toggle.setAttribute("aria-expanded", String(expanded));
		});
		return changed;
	}

	/** 一键全展开 / 全收起，直接作用于树，不看活动链也不改自动开关 */
	private applyExpandAll(expand: boolean): void {
		const tree = this.tree;
		if (!tree) return;

		tree.nodes.forEach((node) => {
			const ref = this.rows[node.index];
			if (!ref?.toggle) return;
			ref.row.classList.toggle("is-collapsed", !expand);
			ref.toggle.setAttribute("aria-expanded", String(expand));
		});
	}

	private toggleCollapse(index: number): void {
		const ref = this.rows[index];
		if (!ref?.toggle) return;

		const nextExpanded = ref.row.classList.contains("is-collapsed");
		if (this.autoEnabled) this.manualState.set(index, nextExpanded);
		ref.row.classList.toggle("is-collapsed", !nextExpanded);
		ref.toggle.setAttribute("aria-expanded", String(nextExpanded));
		this.startLineAnimation();
		this.syncToggleAllButton();
	}

	/** 点击标题：跳转的同时展开该节点（收起只通过行尾箭头） */
	private expandNode(index: number): void {
		const ref = this.rows[index];
		if (!ref?.toggle) return;
		if (!ref.row.classList.contains("is-collapsed")) return;

		this.manualState.set(index, true);
		ref.row.classList.remove("is-collapsed");
		ref.toggle.setAttribute("aria-expanded", "true");
		this.startLineAnimation();
		this.syncToggleAllButton();
	}

	/* ---------- 连接线 ---------- */

	private scheduleLines(): void {
		if (this.linesFrame !== null) return;
		this.linesFrame = requestAnimationFrame(() => {
			this.linesFrame = null;
			this.drawLines();
			if (this.mindmapDialog?.open) this.drawMindmapLines();
		});
	}

	/** 折叠动画期间逐帧重画连接线，让线跟着行的展开/收起一起动 */
	private startLineAnimation(durationMs = 280): void {
		if (prefersReducedMotion()) {
			this.scheduleLines();
			return;
		}
		this.lineAnimUntil = Math.max(
			this.lineAnimUntil,
			performance.now() + durationMs,
		);
		if (this.lineAnimFrame !== null) return;

		const tick = () => {
			this.drawLines();
			if (performance.now() < this.lineAnimUntil) {
				this.lineAnimFrame = requestAnimationFrame(tick);
				return;
			}
			this.lineAnimFrame = null;
			this.lineAnimUntil = 0;
			this.drawLines();
		};
		this.lineAnimFrame = requestAnimationFrame(tick);
	}

	/** 树容器的局部坐标：视口坐标 → 容器内容坐标（含滚动） */
	private toTreeLocal(rect: DOMRect): { x: number; y: number } {
		const nav = this.treeNav;
		if (!nav) return { x: 0, y: 0 };
		const navRect = nav.getBoundingClientRect();
		return {
			x: rect.left - navRect.left + nav.scrollLeft,
			y: rect.top - navRect.top + nav.scrollTop,
		};
	}

	/**
	 * 连接线只在「根 → 目标节点」的路径上描绘（Obsidian 同款）：默认只有圆点，
	 * 悬停或阅读位置变化时才画；路径从父级圆点垂下，以圆角肘形弯入子级圆点。
	 */
	private drawLines(): void {
		const tree = this.tree;
		const svg = this.linesSvg;
		const nav = this.treeNav;
		if (!tree || !svg || !nav) return;

		/* 先归零再测量：svg 的旧高度是绝对定位溢出，会污染 scrollHeight
		   （只涨不缩的棘轮），在树里残留大片可滚动的空白 */
		svg.setAttribute("width", "0");
		svg.setAttribute("height", "0");
		svg.setAttribute("width", String(nav.clientWidth));
		svg.setAttribute(
			"height",
			String(Math.max(nav.scrollHeight, nav.clientHeight)),
		);

		const targets = new Map<number, "active" | "hover">();
		this.getTrailIndexes(this.hoverIndex).forEach((index) => {
			targets.set(index, "hover");
		});
		this.getTrailIndexes(this.activeIndex).forEach((index) => {
			targets.set(index, "active");
		});

		const keptPaths = new Set<SVGPathElement>();
		const dotCenter = (dot: HTMLElement | null) => {
			if (!dot) return null;
			const rect = dot.getBoundingClientRect();
			if (rect.width === 0 && rect.height === 0) return null;
			const local = this.toTreeLocal(rect);
			return {
				x: local.x + rect.width / 2,
				y: local.y + rect.height / 2,
				radius: rect.width / 2,
			};
		};

		/** 行是否可见：任一祖先收起即被 0fr 裁剪（offsetParent 探测不到） */
		const isVisible = (index: number): boolean => {
			let cursor = tree.nodes[index].parent;
			while (cursor >= 0) {
				if (this.rows[cursor]?.row.classList.contains("is-collapsed")) {
					return false;
				}
				cursor = tree.nodes[cursor].parent;
			}
			return true;
		};

		const rootCenter = dotCenter(this.rootDot);
		targets.forEach((kind, index) => {
			const node = tree.nodes[index];
			const start =
				node.parent >= 0
					? dotCenter(this.rows[node.parent]?.dot ?? null)
					: rootCenter;
			const end = dotCenter(this.rows[index]?.dot ?? null);
			if (!start || !end || !isVisible(index)) return;

			let path = this.linePaths[index];
			if (!path) {
				path = document.createElementNS(SVG_NAMESPACE, "path");
				this.linePaths[index] = path;
				svg.appendChild(path);
			}
			keptPaths.add(path);
			path.setAttribute(
				"class",
				`article-toc-panel__line${
					kind === "active" ? " is-active-trail" : " is-hover-trail"
				}`,
			);

			const corner = clamp(
				LINE_CORNER_RADIUS,
				0,
				Math.max(0, end.y - start.y) / 2,
			);
			const hookEnd = Math.max(
				end.x - end.radius - LINE_DOT_GAP,
				start.x + corner,
			);
			path.setAttribute(
				"d",
				`M ${start.x} ${start.y} V ${end.y - corner} Q ${start.x} ${end.y} ${start.x + corner} ${end.y} H ${hookEnd}`,
			);
		});

		this.linePaths.forEach((path, index) => {
			if (path && !keptPaths.has(path)) {
				path.remove();
				this.linePaths[index] = null;
			}
		});
	}

	/** 根到目标节点路径上的节点下标（每个节点一条入线） */
	private getTrailIndexes(index: number): number[] {
		const tree = this.tree;
		if (!tree || index < 0 || index >= tree.nodes.length) return [];

		const indexes: number[] = [];
		let cursor = index;
		while (cursor >= 0) {
			indexes.push(cursor);
			cursor = tree.nodes[cursor].parent;
		}
		return indexes;
	}

	/* ---------- 滚动同步 ---------- */

	private cachePositions(): void {
		const tree = this.tree;
		if (!tree || !this.article) return;

		const scrollY = window.scrollY;
		const articleRect = this.article.getBoundingClientRect();
		this.articleStart = articleRect.top + scrollY;
		this.articleEnd = articleRect.bottom + scrollY;
		this.railHeight = this.root.offsetHeight;
		this.headingTops = tree.nodes.map(
			(node) => node.element.getBoundingClientRect().top + scrollY,
		);
	}

	private getProgress(): number {
		const end = this.articleEnd - window.innerHeight + READING_OFFSET;
		if (end <= this.articleStart) {
			return window.scrollY + READING_OFFSET >= this.articleStart ? 1 : 0;
		}
		return clamp(
			(window.scrollY - this.articleStart) / (end - this.articleStart),
			0,
			1,
		);
	}

	/* 每次滚动实时测正文卡底部（含 License/相关文章/上下篇），避免初始化时布局
	   未稳导致的钳制点漂移；图片/字体加载引起的高度变化由 ResizeObserver 兜住 */
	private syncDock(): void {
		if (!this.railHeight) return;
		const anchor =
			document.querySelector<HTMLElement>("#post-container") ?? this.article;
		if (!anchor) return;

		const anchorBottom = anchor.getBoundingClientRect().bottom + window.scrollY;
		const limit =
			anchorBottom - this.railHeight - RAIL_BOTTOM_GAP - this.railBaseTop;
		/* 面板底边不许越过正文卡底：正常时停在 CSS 的 top，越过后随文档滚走 */
		const maxTop = limit + this.railBaseTop - window.scrollY;
		const nextTop = Math.min(this.railBaseTop, maxTop);
		if (nextTop === this.appliedRailTop) return;

		this.appliedRailTop = nextTop;
		this.root.style.top = `${nextTop}px`;
	}

	private getActiveIndex(): number {
		const tree = this.tree;
		if (!tree || this.headingTops.length === 0) return -1;
		const readingPosition = window.scrollY + READING_OFFSET;
		let lower = 0;
		let upper = this.headingTops.length - 1;
		let result = 0;
		while (lower <= upper) {
			const middle = Math.floor((lower + upper) / 2);
			if (this.headingTops[middle] <= readingPosition) {
				result = middle;
				lower = middle + 1;
			} else {
				upper = middle - 1;
			}
		}
		return result;
	}

	private scheduleUpdate(): void {
		if (this.animationFrame !== null) return;
		this.animationFrame = requestAnimationFrame(() => {
			this.animationFrame = null;
			this.update();
		});
	}

	private scheduleMeasure(): void {
		if (this.measureFrame !== null) return;
		this.measureFrame = requestAnimationFrame(() => {
			this.measureFrame = null;
			if (!this.tree) return;
			this.cachePositions();
			this.scheduleLines();
			this.activeIndex = -1;
			this.update();
		});
	}

	private update(): void {
		if (!this.tree) return;

		this.syncDock();

		const progressPercent = Math.round(this.getProgress() * 100);
		if (progressPercent !== this.lastProgressPercent) {
			this.lastProgressPercent = progressPercent;
			this.progressRegion?.setAttribute(
				"aria-valuenow",
				String(progressPercent),
			);
			if (this.progressLabel)
				this.progressLabel.textContent = `${progressPercent}%`;
		}

		const nextActiveIndex = this.getActiveIndex();
		if (nextActiveIndex === this.activeIndex) return;
		this.activeIndex = nextActiveIndex;
		this.syncActive();
	}

	private syncActive(): void {
		const tree = this.tree;
		if (!tree) return;

		this.rows.forEach((ref, index) => {
			const isActive = index === this.activeIndex;
			ref.row.classList.toggle("is-active", isActive);
			if (isActive) ref.link.setAttribute("aria-current", "location");
			else ref.link.removeAttribute("aria-current");
		});

		this.rebuildActiveChain();
		if (this.applyAutoAccordion()) this.startLineAnimation();
		this.syncToggleAllButton();

		this.scheduleLines();
		this.scheduleActiveRowScroll();
	}

	private scheduleActiveRowScroll(): void {
		if (this.activeScrollTimer) clearTimeout(this.activeScrollTimer);
		this.activeScrollTimer = setTimeout(() => {
			this.activeScrollTimer = null;
			const nav = this.treeNav;
			const ref = this.rows[this.activeIndex];
			if (!nav || !ref) return;
			const navRect = nav.getBoundingClientRect();
			const rowRect = ref.row.getBoundingClientRect();
			const isVisible =
				rowRect.top >= navRect.top && rowRect.bottom <= navRect.bottom;
			if (isVisible) return;
			const targetScroll =
				ref.row.offsetTop - nav.clientHeight / 2 + ref.row.clientHeight / 2;
			nav.scrollTo({
				top: Math.max(0, targetScroll),
				behavior: prefersReducedMotion() ? "auto" : "smooth",
			});
		}, ACTIVE_SCROLL_THROTTLE);
	}

	/* ---------- 导航 ---------- */

	private navigateTo(index: number): void {
		const tree = this.tree;
		if (!tree) return;

		window.tocInternalNavigation = true;
		let targetTop: number;
		let hashId: string | null = null;
		if (index < 0) {
			targetTop = tree.titleElement
				? tree.titleElement.getBoundingClientRect().top +
					window.scrollY -
					READING_OFFSET
				: 0;
		} else {
			const node = tree.nodes[index];
			targetTop = this.headingTops[index] - READING_OFFSET;
			hashId = node.id;
		}

		if (hashId) {
			const destination = new URL(window.location.href);
			destination.hash = hashId;
			window.history.pushState(null, "", destination);
		}
		window.scrollTo({
			top: Math.max(0, targetTop),
			behavior: prefersReducedMotion() ? "auto" : "smooth",
		});
	}

	/* ---------- 思维导图弹窗 ---------- */

	private openMindmap(): void {
		const tree = this.tree;
		const dialog = this.mindmapDialog;
		if (!tree || !dialog || !this.mindmapTree) return;

		/* 每次打开回到 1:1，缩放只在当次浏览里持续 */
		this.mindmapZoom = 1;
		this.applyMindmapZoom();
		this.panState = null;
		this.mindmapPanDragged = false;
		this.renderMindmap();
		dialog.showModal();
		requestAnimationFrame(() => this.drawMindmapLines());
	}

	/**
	 * 嵌套递归布局（markmap 同款观感）：父节点所在行与其子树子列垂直居中对齐，
	 * 组内小间距、组间大间距——间距全部用 em 表达，缩放只改树容器 font-size。
	 */
	private renderMindmap(): void {
		const tree = this.tree;
		if (!tree || !this.mindmapTree) return;

		this.mindmapNodePills = [];
		this.mindmapRootPill = null;
		this.mindmapPaths = [];

		const treeEl = document.createElement("div");
		treeEl.className = "article-toc-mindmap__tree";

		const rootPill = this.buildMindmapPill(-1, tree.title, true);
		treeEl.appendChild(rootPill);
		this.mindmapRootPill = rootPill;

		const roots = tree.nodes.filter((node) => node.parent < 0);
		if (roots.length > 0) {
			const children = document.createElement("div");
			children.className = "article-toc-mindmap__children";
			roots.forEach((node) => {
				this.buildMindmapBranch(node, children);
			});
			treeEl.appendChild(children);
		}

		if (this.mindmapLinesSvg) {
			this.mindmapTree.replaceChildren(this.mindmapLinesSvg, treeEl);
		} else {
			this.mindmapTree.replaceChildren(treeEl);
		}
	}

	/** 一棵子树 = 「节点胶囊 + 子级竖列」的水平组合 */
	private buildMindmapBranch(node: TocNode, parent: HTMLElement): void {
		const branch = document.createElement("div");
		branch.className = "article-toc-mindmap__branch";
		branch.appendChild(this.buildMindmapPill(node.index, node.text, false));

		if (node.children.length > 0) {
			const children = document.createElement("div");
			children.className = "article-toc-mindmap__children";
			node.children.forEach((childIndex) => {
				const child = this.tree?.nodes[childIndex];
				if (child) this.buildMindmapBranch(child, children);
			});
			branch.appendChild(children);
		}
		parent.appendChild(branch);
	}

	private buildMindmapPill(
		index: number,
		text: string,
		isRoot: boolean,
	): HTMLButtonElement {
		const pill = document.createElement("button");
		pill.type = "button";
		pill.className = isRoot
			? "article-toc-mindmap__node article-toc-mindmap__node--root"
			: "article-toc-mindmap__node";
		if (index >= 0) pill.dataset.tocMindmapIndex = String(index);
		pill.title = text;
		const dot = document.createElement("span");
		if (!isRoot) dot.className = "article-toc-mindmap__node-dot";
		const textEl = document.createElement("span");
		textEl.className = "article-toc-mindmap__node-text";
		textEl.textContent = text;
		pill.append(dot, textEl);
		if (index >= 0) this.mindmapNodePills[index] = pill;
		return pill;
	}

	/** 缩放改树容器 font-size：em 体系整体缩放，布局尺寸随之变化，滚动区自然正确 */
	private applyMindmapZoom(): void {
		this.mindmapTree?.style.setProperty(
			"--mindmap-zoom",
			String(this.mindmapZoom),
		);
	}

	private setMindmapZoom(zoom: number): void {
		this.mindmapZoom = clamp(zoom, MINDMAP_ZOOM_MIN, MINDMAP_ZOOM_MAX);
		this.applyMindmapZoom();
		this.drawMindmapLines();
	}

	/** 画布式缩放：以光标为锚点，缩放前后光标下的内容点保持不动 */
	private zoomMindmapAt(
		factor: number,
		clientX: number,
		clientY: number,
	): void {
		const canvas = this.mindmapCanvas;
		if (!canvas) return;

		const oldZoom = this.mindmapZoom;
		const newZoom = clamp(oldZoom * factor, MINDMAP_ZOOM_MIN, MINDMAP_ZOOM_MAX);
		if (newZoom === oldZoom) return;

		const rect = canvas.getBoundingClientRect();
		const contentX = clientX - rect.left + canvas.scrollLeft;
		const contentY = clientY - rect.top + canvas.scrollTop;

		this.mindmapZoom = newZoom;
		this.applyMindmapZoom();

		/* em 体系下布局尺寸随 font-size 等比缩放，内容点坐标同比例放大 */
		const ratio = newZoom / oldZoom;
		canvas.scrollLeft = contentX * ratio - (clientX - rect.left);
		canvas.scrollTop = contentY * ratio - (clientY - rect.top);
		this.drawMindmapLines();
	}

	private toggleMindmapFullscreen(): void {
		const panel = this.mindmapDialog?.querySelector<HTMLElement>(
			".article-toc-mindmap__panel",
		);
		if (!panel) return;
		if (document.fullscreenElement) {
			void document.exitFullscreen();
		} else {
			void panel.requestFullscreen();
		}
	}

	private drawMindmapLines(): void {
		const tree = this.tree;
		const svg = this.mindmapLinesSvg;
		const canvas = this.mindmapCanvas;
		if (!tree || !svg || !canvas) return;

		/* 同 drawLines：先归零排除自身（与旧 path）对滚动尺寸的污染 */
		svg.setAttribute("width", "0");
		svg.setAttribute("height", "0");
		svg.replaceChildren();
		this.mindmapPaths = [];
		svg.setAttribute("width", String(canvas.scrollWidth));
		svg.setAttribute("height", String(canvas.scrollHeight));

		const canvasRect = canvas.getBoundingClientRect();
		const pillCenter = (pill: HTMLElement | null) => {
			if (!pill) return null;
			const rect = pill.getBoundingClientRect();
			if (rect.width === 0 && rect.height === 0) return null;
			return {
				left: rect.left - canvasRect.left + canvas.scrollLeft,
				right: rect.right - canvasRect.left + canvas.scrollLeft,
				y: rect.top - canvasRect.top + canvas.scrollTop + rect.height / 2,
			};
		};

		const rootBox = pillCenter(this.mindmapRootPill);
		tree.nodes.forEach((node) => {
			const start =
				node.parent >= 0
					? pillCenter(this.mindmapNodePills[node.parent] ?? null)
					: rootBox;
			const end = pillCenter(this.mindmapNodePills[node.index] ?? null);
			if (!start || !end) return;

			const path = document.createElementNS(SVG_NAMESPACE, "path");
			path.classList.add("article-toc-mindmap__line");
			/* markmap 同款共享主干：水平出父节点 → 中点处垂直转弯 → 水平入子节点，
			   各兄弟路径的公共段重叠，视觉上是一根主干分出多条分支 */
			const branchX = (start.right + end.left) / 2;
			const corner = Math.min(
				LINE_CORNER_RADIUS,
				Math.abs(end.y - start.y) / 2,
				Math.max(0, end.left - branchX),
			);
			const turn =
				corner < 0.5
					? [`M ${start.right} ${start.y}`, `H ${end.left}`]
					: end.y > start.y
						? [
								`M ${start.right} ${start.y}`,
								`H ${branchX - corner}`,
								`Q ${branchX} ${start.y} ${branchX} ${start.y + corner}`,
								`V ${end.y - corner}`,
								`Q ${branchX} ${end.y} ${branchX + corner} ${end.y}`,
								`H ${end.left}`,
							]
						: [
								`M ${start.right} ${start.y}`,
								`H ${branchX - corner}`,
								`Q ${branchX} ${start.y} ${branchX} ${start.y - corner}`,
								`V ${end.y + corner}`,
								`Q ${branchX} ${end.y} ${branchX + corner} ${end.y}`,
								`H ${end.left}`,
							];
			path.setAttribute("d", turn.join(" "));
			svg.appendChild(path);
			this.mindmapPaths[node.index] = path;
		});
	}

	/** 导图悬停高亮：根到悬停节点整条链的连线、节点边框与文字（Obsidian 路径语义） */
	private setMindmapTrail(index: number): void {
		this.clearMindmapTrail();
		const tree = this.tree;
		if (!tree || index < 0) return;

		let cursor = index;
		while (cursor >= 0) {
			this.mindmapNodePills[cursor]?.classList.add("is-trail");
			this.mindmapPaths[cursor]?.classList.add("is-active");
			cursor = tree.nodes[cursor].parent;
		}
	}

	private clearMindmapTrail(): void {
		this.mindmapNodePills.forEach((pill) => {
			pill?.classList.remove("is-trail");
		});
		this.mindmapPaths.forEach((path) => {
			path?.classList.remove("is-active");
		});
	}

	/* ---------- 事件绑定 ---------- */

	private bindInteractions(): void {
		const { signal } = this.abortController;

		this.autoButton?.addEventListener(
			"click",
			() => this.setAutoEnabled(!this.autoEnabled),
			{ signal },
		);
		this.toggleAllButton?.addEventListener("click", () => this.toggleAll(), {
			signal,
		});
		this.mindmapButton?.addEventListener("click", () => this.openMindmap(), {
			signal,
		});
		this.mindmapZoomOutButton?.addEventListener(
			"click",
			() => this.setMindmapZoom(this.mindmapZoom - MINDMAP_ZOOM_STEP),
			{ signal },
		);
		this.mindmapZoomInButton?.addEventListener(
			"click",
			() => this.setMindmapZoom(this.mindmapZoom + MINDMAP_ZOOM_STEP),
			{ signal },
		);
		this.mindmapResetButton?.addEventListener(
			"click",
			() => this.setMindmapZoom(1),
			{ signal },
		);
		this.mindmapFullscreenButton?.addEventListener(
			"click",
			() => this.toggleMindmapFullscreen(),
			{ signal },
		);

		this.treeNav?.addEventListener(
			"click",
			(event) => {
				const target = event.target as HTMLElement | null;
				const toggle = target?.closest<HTMLElement>("[data-toc-toggle]");
				if (toggle) {
					event.preventDefault();
					this.toggleCollapse(Number(toggle.dataset.tocToggle));
					return;
				}
				const link = target?.closest<HTMLElement>("[data-toc-navigate]");
				if (link) {
					event.preventDefault();
					const index = Number(link.dataset.tocNavigate);
					this.navigateTo(index);
					this.expandNode(index);
				}
			},
			{ signal },
		);

		this.treeNav?.addEventListener(
			"mouseover",
			(event) => {
				const row = (event.target as HTMLElement | null)?.closest<HTMLElement>(
					"[data-toc-index]",
				);
				const index = row ? Number(row.dataset.tocIndex) : -1;
				if (index === this.hoverIndex) return;
				this.hoverIndex = index;
				this.scheduleLines();
			},
			{ signal },
		);
		this.treeNav?.addEventListener(
			"mouseleave",
			() => {
				if (this.hoverIndex === -1) return;
				this.hoverIndex = -1;
				this.scheduleLines();
			},
			{ signal },
		);

		this.mindmapCanvas?.addEventListener(
			"wheel",
			(event) => {
				event.preventDefault();
				const factor =
					event.deltaY < 0 ? MINDMAP_WHEEL_FACTOR : 1 / MINDMAP_WHEEL_FACTOR;
				this.zoomMindmapAt(factor, event.clientX, event.clientY);
			},
			{ passive: false, signal },
		);

		/* 画布拖拽平移：按下先只记录起点（不接管指针，保证胶囊正常点击），
		   移动超过阈值才 setPointerCapture 进入平移，随后到来的 click 被吞掉 */
		const canvas = this.mindmapCanvas;
		if (canvas) {
			canvas.addEventListener(
				"pointerdown",
				(event) => {
					if (event.button !== 0) return;
					this.panState = {
						pointerId: event.pointerId,
						startX: event.clientX,
						startY: event.clientY,
						scrollLeft: canvas.scrollLeft,
						scrollTop: canvas.scrollTop,
					};
					this.mindmapPanDragged = false;
				},
				{ signal },
			);
			canvas.addEventListener(
				"pointermove",
				(event) => {
					const state = this.panState;
					if (!state || event.pointerId !== state.pointerId) return;
					const dx = event.clientX - state.startX;
					const dy = event.clientY - state.startY;
					if (!this.mindmapPanDragged) {
						if (Math.hypot(dx, dy) <= MINDMAP_PAN_THRESHOLD) return;
						this.mindmapPanDragged = true;
						canvas.setPointerCapture(event.pointerId);
						canvas.classList.add("is-panning");
					}
					canvas.scrollLeft = state.scrollLeft - dx;
					canvas.scrollTop = state.scrollTop - dy;
				},
				{ signal },
			);
			const endPan = (event: PointerEvent) => {
				if (!this.panState || event.pointerId !== this.panState.pointerId) {
					return;
				}
				this.panState = null;
				canvas.classList.remove("is-panning");
			};
			canvas.addEventListener("pointerup", endPan, { signal });
			canvas.addEventListener("pointercancel", endPan, { signal });
		}

		this.mindmapDialog?.addEventListener(
			"click",
			(event) => {
				if (this.mindmapPanDragged) {
					this.mindmapPanDragged = false;
					return;
				}
				const target = event.target as HTMLElement | null;
				if (target?.closest("[data-toc-mindmap-close]")) {
					this.mindmapDialog?.close();
					return;
				}
				const pill = target?.closest<HTMLElement>("[data-toc-mindmap-index]");
				if (pill) {
					this.navigateTo(Number(pill.dataset.tocMindmapIndex));
					this.mindmapDialog?.close();
				}
			},
			{ signal },
		);

		this.mindmapCanvas?.addEventListener(
			"mouseover",
			(event) => {
				const pill = (event.target as HTMLElement | null)?.closest<HTMLElement>(
					"[data-toc-mindmap-index]",
				);
				if (!pill) return;
				this.setMindmapTrail(Number(pill.dataset.tocMindmapIndex));
			},
			{ signal },
		);
		this.mindmapCanvas?.addEventListener(
			"mouseleave",
			() => this.clearMindmapTrail(),
			{ signal },
		);
	}
}

export class ArticleTocPanelRuntime {
	private readonly abortController = new AbortController();
	private controller: ArticleTocPanelController | null = null;

	public start(): void {
		// 首次加载 + 每次导航各挂一次，容器替换前拆掉：时序统一交给 swup-lifecycle
		definePageIsland({
			name: "article-toc-panel",
			mount: () => this.initialize(),
			unmount: () => this.destroyCurrent(),
		});
		// 加密文章解密后正文标题才出现，需要补建一次（initialize 自带幂等）
		document.addEventListener("password:decrypted", () => this.initialize(), {
			signal: this.abortController.signal,
		});
	}

	public destroy(): void {
		this.abortController.abort();
		this.destroyCurrent();
	}

	private initialize(): void {
		this.destroyCurrent();
		const root = document.getElementById("article-toc-panel");
		if (!root) return;

		const controller = new ArticleTocPanelController(root);
		if (controller.init()) this.controller = controller;
	}

	private destroyCurrent(): void {
		this.controller?.destroy();
		this.controller = null;
	}
}
