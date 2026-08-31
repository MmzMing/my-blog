import { type Quadtree, quadtree, select, zoom, zoomIdentity } from "d3";
import type { KGData } from "@/utils/knowledge-graph-data";
import { navigateToPage } from "@/utils/navigation-utils";
import { preloadUrl } from "@/utils/swup-lifecycle";
import { clamp, easeOutCubic, type Point } from "./geometry";
import { computeMindmapLayout, MINDMAP_LINE_PHASES } from "./mindmap";
import { createPlayback } from "./playback";
import { createRenderer } from "./renderer";
import {
	applyFilters,
	buildScene,
	defaultFilters,
	type Scene,
	seedPositions,
} from "./scene";
import { createSimulation } from "./simulation";
import type {
	GraphController,
	GraphStrings,
	GraphTier,
	KGSelection,
	KGSelectionGroup,
	SceneNode,
} from "./types";

const MIN_ZOOM = 0.35;
const MAX_ZOOM = 6;
/** 悬停多久后预载目标页 */
const PRELOAD_DELAY = 400;

/* ── 脑图切换动效时间线（毫秒）── */
/** 单层节点滑入时长 */
const MINDMAP_NODE_MS = 700;
/** 层间错峰：分类 → 标签 → 文章 → 标题 依次起跑 */
const MINDMAP_TIER_STAGGER = 170;
/** 连线开始描绘的时刻（与节点滑入部分重叠，衔接更自然） */
const MINDMAP_LINE_START = 320;
/** 每一波连线的时长（共三波：分类-标签 → 标签-文章 → 文章-标题） */
const MINDMAP_LINE_PHASE_MS = 420;
/** 节点滑入的层序，与 stagger 对应 */
const MINDMAP_TIER_ORDER: GraphTier[] = ["category", "tag", "post", "heading"];

/**
 * 详情面板的下钻数据：按选中节点的层级给出相邻层列表。
 * - 分类 → 该分类的所有标签 + 所有文档
 * - 标签 → 挂该标签的所有文档 + 这些文档的所有标题
 * - 文档 → 该文档的所有标题
 * - 标题 → 所属文档 + 同文档的全部标题
 * 文章归属走 categoryId / postId 字段而非边表：无标签文章没有
 * category-post 直连边，按边收集会漏。
 */
function buildSelectionDetail(scene: Scene, node: SceneNode): KGSelection {
	const childTier = (tier: SceneNode["tier"]): SceneNode[] =>
		scene.byTier[tier].filter((child) => node.children.has(child.data.id));
	const toGroup = (
		tier: SceneNode["tier"],
		items: SceneNode[],
	): KGSelectionGroup[] =>
		items.length > 0 ? [{ tier, items: items.map((item) => item.data) }] : [];

	const groups: KGSelectionGroup[] = [];
	if (node.tier === "category") {
		groups.push(...toGroup("tag", childTier("tag")));
		groups.push(
			...toGroup(
				"post",
				scene.byTier.post.filter(
					(post) => post.data.categoryId === node.data.id,
				),
			),
		);
	} else if (node.tier === "tag") {
		const posts = childTier("post");
		const postIds = new Set(posts.map((post) => post.data.postId));
		groups.push(...toGroup("post", posts));
		groups.push(
			...toGroup(
				"heading",
				scene.byTier.heading.filter(
					(heading) =>
						heading.data.postId !== undefined &&
						postIds.has(heading.data.postId),
				),
			),
		);
	} else if (node.tier === "post") {
		groups.push(
			...toGroup(
				"heading",
				scene.byTier.heading.filter(
					(heading) => heading.data.postId === node.data.postId,
				),
			),
		);
	} else {
		const posts = scene.byTier.post.filter(
			(post) => post.data.postId === node.data.postId,
		);
		const postIds = new Set(posts.map((post) => post.data.postId));
		groups.push(...toGroup("post", posts));
		groups.push(
			...toGroup(
				"heading",
				scene.byTier.heading.filter(
					(heading) =>
						heading.data.postId !== undefined &&
						postIds.has(heading.data.postId),
				),
			),
		);
	}

	return { node: node.data, groups };
}

export function mountKnowledgeGraph(
	root: HTMLElement,
	data: KGData,
	strings: GraphStrings,
): GraphController {
	const surface = root.querySelector<HTMLElement>("[data-kg-surface]");
	const canvas = root.querySelector<HTMLCanvasElement>("[data-kg-canvas]");
	const status = root.querySelector<HTMLElement>("[data-kg-status]");
	const tooltip = root.querySelector<HTMLElement>("[data-kg-tooltip]");
	const tipTitle = root.querySelector<HTMLElement>("[data-kg-tip-title]");
	const tipMeta = root.querySelector<HTMLElement>("[data-kg-tip-meta]");
	if (!surface || !canvas || !status || !tooltip || !tipTitle || !tipMeta) {
		throw new Error("Knowledge graph: missing required elements");
	}

	const scene = buildScene(data);
	let filters = defaultFilters(scene);
	const renderer = createRenderer(
		canvas,
		surface,
		scene,
		filters,
		zoomIdentity,
	);

	renderer.measure();
	seedPositions(scene, scene.width, scene.height);
	applyFilters(scene, filters);

	const simulation = createSimulation(scene);
	const playback = createPlayback(scene, () => {
		emitPlayback();
		requestDraw();
	});

	const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
	let reducedMotion = motion.matches;
	renderer.setReducedMotion(reducedMotion);
	playback.setReducedMotion(reducedMotion);

	let destroyed = false;
	let rafId = 0;
	let lastTime = 0;
	let inViewport = true;
	let dirty = true;
	let tree: Quadtree<SceneNode> | null = null;
	let treeStale = true;
	let dragNode: SceneNode | null = null;
	let dragMoved = false;
	let dragOrigin: Point | null = null;
	let emptyDown: Point | null = null;
	let preloadTimer = 0;
	/** 脑图入场补间：一次性记录起点/终点，RAF 里按时间推进 */
	let layoutAnim: {
		t0: number;
		starts: Map<string, Point>;
		targets: Map<string, Point>;
	} | null = null;

	const requestDraw = (): void => {
		dirty = true;
	};

	/* ── 命中检测：quadtree 取代线性扫描 ── */
	const rebuildTree = (): void => {
		tree = quadtree<SceneNode>()
			.x((node) => node.x ?? 0)
			.y((node) => node.y ?? 0)
			.addAll(scene.nodes.filter((node) => node.filtered && node.reveal > 0.2));
		treeStale = false;
	};

	const maxRadius = Math.max(...scene.nodes.map((node) => node.radius));

	const clientToGraph = (point: Point): Point => {
		const rect = canvas.getBoundingClientRect();
		const [x, y] = renderer
			.getTransform()
			.invert([point.x - rect.left, point.y - rect.top]);
		return { x, y };
	};

	const findNode = (point: Point): SceneNode | null => {
		if (!tree || treeStale) rebuildTree();
		if (!tree) return null;
		const p = clientToGraph(point);
		const k = renderer.getTransform().k;
		const slack = maxRadius + 10 / k;
		let best: SceneNode | null = null;
		let bestDistance = Number.POSITIVE_INFINITY;

		tree.visit((node, x0, y0, x1, y1) => {
			if (!("length" in node) || node.length === undefined) {
				let leaf = node as { data: SceneNode; next?: unknown };
				do {
					const candidate = leaf.data;
					const distance = Math.hypot(
						p.x - (candidate.x ?? 0),
						p.y - (candidate.y ?? 0),
					);
					if (
						distance <= candidate.radius + 10 / k &&
						distance < bestDistance
					) {
						best = candidate;
						bestDistance = distance;
					}
					leaf = leaf.next as typeof leaf;
				} while (leaf);
			}
			return (
				x0 > p.x + slack ||
				x1 < p.x - slack ||
				y0 > p.y + slack ||
				y1 < p.y - slack
			);
		});
		return best;
	};

	/* ── 对外事件：传输条与面板据此刷新 ── */
	function emitPlayback(): void {
		root.dispatchEvent(
			new CustomEvent("kg:playback", { detail: playback.getState() }),
		);
	}

	const emitStats = (): void => {
		let visible = 0;
		for (const node of scene.nodes) if (node.filtered) visible++;
		root.dispatchEvent(
			new CustomEvent("kg:stats", {
				detail: {
					visible,
					total: scene.nodes.length,
					links: scene.links.length,
				},
			}),
		);
	};

	/* ── 脑图布局 ── */

	/** 重排脑图；animated=false 时瞬时落位（切筛选后重排 / 减少动画偏好） */
	const relayoutMindmap = (animated: boolean): void => {
		const targets = computeMindmapLayout(scene);
		if (!animated) {
			layoutAnim = null;
			for (const [id, target] of targets) {
				const node = scene.nodeMap.get(id);
				if (node) {
					node.x = target.x;
					node.y = target.y;
				}
			}
			scene.lineProgress = 1;
			treeStale = true;
			requestDraw();
			return;
		}
		const starts = new Map<string, Point>();
		for (const id of targets.keys()) {
			const node = scene.nodeMap.get(id);
			if (node) starts.set(id, { x: node.x ?? 0, y: node.y ?? 0 });
		}
		layoutAnim = { t0: performance.now(), starts, targets };
		// 连线整体复位为未描绘，等节点滑入后从左到右逐波生长
		scene.lineProgress = 0;
		startLoop();
	};

	/** RAF 里推进脑图入场：节点按层错峰滑入，连线三波描绘 */
	const updateLayoutAnim = (now: number): void => {
		const anim = layoutAnim;
		if (!anim) return;
		const elapsed = now - anim.t0;
		for (const [id, target] of anim.targets) {
			const node = scene.nodeMap.get(id);
			const start = anim.starts.get(id);
			if (!node || !start) continue;
			const delay =
				MINDMAP_TIER_ORDER.indexOf(node.tier) * MINDMAP_TIER_STAGGER;
			const eased = easeOutCubic(
				clamp((elapsed - delay) / MINDMAP_NODE_MS, 0, 1),
			);
			node.x = start.x + (target.x - start.x) * eased;
			node.y = start.y + (target.y - start.y) * eased;
		}
		scene.lineProgress = clamp(
			(elapsed - MINDMAP_LINE_START) /
				(MINDMAP_LINE_PHASE_MS * MINDMAP_LINE_PHASES),
			0,
			1,
		);
		treeStale = true;
		dirty = true;
		const totalNodes =
			(MINDMAP_TIER_ORDER.length - 1) * MINDMAP_TIER_STAGGER + MINDMAP_NODE_MS;
		const total = Math.max(
			totalNodes,
			MINDMAP_LINE_START + MINDMAP_LINE_PHASE_MS * MINDMAP_LINE_PHASES,
		);
		if (elapsed >= total) layoutAnim = null;
	};

	const toggleLayout = (): void => {
		if (scene.mode === "graph") {
			scene.mode = "mindmap";
			// 脑图布局是确定性的：停掉物理，避免把节点拉回力导向位置
			simulation.sim.stop();
			for (const node of scene.nodes) {
				node.fx = null;
				node.fy = null;
			}
			relayoutMindmap(!reducedMotion);
			// 四列布局按画布全幅计算，重置视图到恒等变换才能完整呈现，
			// 否则残留力导向模式的缩放平移会让列跑出视野
			select(canvas).call(zoomBehavior.transform, zoomIdentity);
		} else {
			scene.mode = "graph";
			layoutAnim = null;
			scene.lineProgress = 1;
			// 切回力导向：重新点火让节点从四列位置有机流回
			simulation.reheat(0.3);
		}
		root.dispatchEvent(
			new CustomEvent("kg:layout", { detail: { mode: scene.mode } }),
		);
		requestDraw();
		startLoop();
	};

	/* ── 缩放 / 平移 ── */
	const zoomBehavior = zoom<HTMLCanvasElement, unknown>()
		.scaleExtent([MIN_ZOOM, MAX_ZOOM])
		.filter((event: Event) => {
			if (event.type === "wheel") return true;
			// 双击命中节点时不让 zoom 接管，否则「双击打开」会同时放大一级
			const point =
				event instanceof MouseEvent
					? { x: event.clientX, y: event.clientY }
					: null;
			if (event.type === "dblclick") return !point || !findNode(point);
			return !point || !findNode(point);
		})
		.on("zoom", (event) => {
			renderer.setTransform(event.transform);
			requestDraw();
		});

	select(canvas).call(zoomBehavior);
	select(canvas).on("dblclick.zoom", null);

	const fitView = (): void => {
		const visible = scene.nodes.filter(
			(node) => node.filtered && node.reveal > 0.2 && node.x != null,
		);
		if (visible.length === 0) return;
		let minX = Number.POSITIVE_INFINITY;
		let maxX = Number.NEGATIVE_INFINITY;
		let minY = Number.POSITIVE_INFINITY;
		let maxY = Number.NEGATIVE_INFINITY;
		for (const node of visible) {
			const pad = node.radius + 40;
			minX = Math.min(minX, (node.x ?? 0) - pad);
			maxX = Math.max(maxX, (node.x ?? 0) + pad);
			minY = Math.min(minY, (node.y ?? 0) - pad);
			maxY = Math.max(maxY, (node.y ?? 0) + pad);
		}
		const w = Math.max(1, maxX - minX);
		const h = Math.max(1, maxY - minY);
		// 下限很重要：243 个节点在全屏画布上不设下限会缩成中央一小团
		const scale = clamp(
			Math.min((scene.width - 80) / w, (scene.height - 80) / h),
			0.55,
			1.6,
		);
		const cx = (minX + maxX) / 2;
		const cy = (minY + maxY) / 2;
		select(canvas).call(
			zoomBehavior.transform,
			zoomIdentity
				.translate(scene.width / 2 - cx * scale, scene.height / 2 - cy * scale)
				.scale(scale),
		);
	};

	/* ── tooltip ── */
	const showTooltip = (node: SceneNode, local: Point): void => {
		tipTitle.textContent = node.data.name;
		const parts = [strings.tier[node.tier]];
		if (node.tier === "category" || node.tier === "tag") {
			parts.push(strings.posts.replace("{count}", String(node.data.value)));
		} else if (node.tier === "post" && node.data.value > 0) {
			parts.push(strings.sections.replace("{count}", String(node.data.value)));
		}
		parts.push(
			strings.relations.replace("{count}", String(node.neighbors.size)),
		);
		tipMeta.textContent = parts.join(" · ");
		tooltip.hidden = false;
		tooltip.setAttribute("aria-hidden", "false");
		const left = clamp(
			local.x + 14,
			8,
			Math.max(8, scene.width - tooltip.offsetWidth - 8),
		);
		const top = clamp(
			local.y + 14,
			8,
			Math.max(8, scene.height - tooltip.offsetHeight - 8),
		);
		tooltip.style.left = `${left}px`;
		tooltip.style.top = `${top}px`;
	};

	const hideTooltip = (): void => {
		tooltip.hidden = true;
		tooltip.setAttribute("aria-hidden", "true");
	};

	const setHovered = (node: SceneNode | null, local?: Point): void => {
		if (scene.hovered === node && !local) return;
		scene.hovered = node;
		canvas.classList.toggle("is-node-hovered", Boolean(node));
		if (node && local) showTooltip(node, local);
		else if (!node) hideTooltip();
		requestDraw();

		window.clearTimeout(preloadTimer);
		if (node?.data.url) {
			preloadTimer = window.setTimeout(
				() => preloadUrl(node.data.url),
				PRELOAD_DELAY,
			);
		}
	};

	const setSelected = (node: SceneNode | null): void => {
		if (scene.selected) scene.selected.selected = false;
		scene.selected = node;
		if (node) node.selected = true;
		status.textContent = node ? node.data.name : strings.loaded;
		// 详情面板据此渲染；控制器不 import i18n，载荷只带纯数据
		root.dispatchEvent(
			new CustomEvent<KGSelection | null>("kg:select", {
				detail: node ? buildSelectionDetail(scene, node) : null,
			}),
		);
		requestDraw();
	};

	/* ── 指针 ── */
	const localPoint = (event: PointerEvent): Point => {
		const rect = canvas.getBoundingClientRect();
		return { x: event.clientX - rect.left, y: event.clientY - rect.top };
	};

	const onPointerDown = (event: PointerEvent): void => {
		if (event.button !== 0) return;
		const node = findNode({ x: event.clientX, y: event.clientY });
		if (!node) {
			// 记录空白起点：松手时位移小于阈值视为「点击空白 = 取消选中」
			emptyDown = { x: event.clientX, y: event.clientY };
			return;
		}
		emptyDown = null;
		event.preventDefault();
		canvas.setPointerCapture(event.pointerId);
		dragNode = node;
		dragMoved = false;
		dragOrigin = { x: event.clientX, y: event.clientY };
		if (scene.mode === "mindmap") {
			// 脑图布局不走物理：拖拽直接改坐标（见 onPointerMove），不点火
			setHovered(node, localPoint(event));
			return;
		}
		const p = clientToGraph({ x: event.clientX, y: event.clientY });
		node.fx = p.x;
		node.fy = p.y;
		canvas.classList.add("is-dragging");
		simulation.startDrag();
		setHovered(node, localPoint(event));
	};

	const onPointerMove = (event: PointerEvent): void => {
		if (dragNode) {
			const p = clientToGraph({ x: event.clientX, y: event.clientY });
			if (scene.mode === "mindmap") {
				dragNode.x = p.x;
				dragNode.y = p.y;
			} else {
				dragNode.fx = p.x;
				dragNode.fy = p.y;
			}
			if (
				dragOrigin &&
				Math.hypot(event.clientX - dragOrigin.x, event.clientY - dragOrigin.y) >
					5
			) {
				dragMoved = true;
			}
			treeStale = true;
			showTooltip(dragNode, localPoint(event));
			requestDraw();
			return;
		}
		const node = findNode({ x: event.clientX, y: event.clientY });
		setHovered(node, node ? localPoint(event) : undefined);
	};

	const onPointerUp = (event: PointerEvent): void => {
		// 空白处的轻点（非拖拽平移）= 取消选中
		if (!dragNode) {
			if (
				emptyDown &&
				Math.hypot(event.clientX - emptyDown.x, event.clientY - emptyDown.y) < 5
			) {
				setSelected(null);
			}
			emptyDown = null;
			return;
		}
		const node = dragNode;
		if (canvas.hasPointerCapture(event.pointerId)) {
			canvas.releasePointerCapture(event.pointerId);
		}
		// Shift 拖拽 = 永久钉住，否则松手释放
		if (!event.shiftKey) {
			node.fx = null;
			node.fy = null;
		}
		dragNode = null;
		dragOrigin = null;
		canvas.classList.remove("is-dragging");
		if (scene.mode !== "mindmap") simulation.endDrag();
		// 单击 = 选中，不再直接导航（四层图里随手一点就跳走是敌对行为）
		if (!dragMoved) setSelected(scene.selected === node ? null : node);
		dragMoved = false;
	};

	const onPointerLeave = (): void => {
		if (!dragNode) setHovered(null);
	};

	// 双击 = 导航
	const onDblClick = (event: MouseEvent): void => {
		const node = findNode({ x: event.clientX, y: event.clientY });
		if (node?.data.url) {
			event.preventDefault();
			navigateToPage(node.data.url);
			return;
		}
		fitView();
	};

	const onKeyDown = (event: KeyboardEvent): void => {
		if (event.key === "Escape") {
			setSelected(null);
			setHovered(null);
			return;
		}
		if (event.key === "0") {
			event.preventDefault();
			fitView();
			return;
		}
		if (event.key === "p") {
			event.preventDefault();
			playback.toggle();
			return;
		}
		if (event.key === "Enter" && scene.selected?.data.url) {
			event.preventDefault();
			navigateToPage(scene.selected.data.url);
		}
	};

	/* ── RAF ── */
	const shouldRun = (): boolean =>
		inViewport && document.visibilityState === "visible";

	const frame = (time: number): void => {
		if (destroyed) return;
		const dt = lastTime === 0 ? 16 : Math.min(64, time - lastTime);
		lastTime = time;

		if (playback.tick(dt)) {
			treeStale = true;
			dirty = true;
		}
		if (layoutAnim) updateLayoutAnim(time);

		const alpha = simulation.sim.alpha();
		if (alpha > simulation.sim.alphaMin()) {
			treeStale = true;
			dirty = true;
		}
		// 粒子需要持续重绘；关掉后收敛即停，静态页面 CPU 降到约 1.5%
		if (filters.particles && !reducedMotion) dirty = true;

		if (dirty) {
			renderer.draw(time);
			dirty = false;
		}
		rafId = requestAnimationFrame(frame);
	};

	const startLoop = (): void => {
		if (rafId || destroyed || !shouldRun()) return;
		lastTime = 0;
		rafId = requestAnimationFrame(frame);
	};

	const stopLoop = (): void => {
		cancelAnimationFrame(rafId);
		rafId = 0;
	};

	/* ── 观察者 ── */
	const resizeObserver = new ResizeObserver(() => {
		if (destroyed || surface.offsetWidth === 0) return;
		const prevW = scene.width;
		const prevH = scene.height;
		renderer.measure();
		if (prevW !== scene.width || prevH !== scene.height) {
			simulation.resize();
			treeStale = true;
		}
		requestDraw();
	});
	resizeObserver.observe(surface);

	const themeObserver = new MutationObserver(() => {
		renderer.refreshTheme();
		requestDraw();
	});
	themeObserver.observe(document.documentElement, {
		attributes: true,
		attributeFilter: ["class", "data-theme"],
	});

	const visibilityObserver = new IntersectionObserver((entries) => {
		inViewport = entries[0]?.isIntersecting ?? false;
		if (inViewport) startLoop();
		else stopLoop();
	});
	visibilityObserver.observe(surface);

	const onDocVisibility = (): void => {
		if (shouldRun()) startLoop();
		else stopLoop();
	};
	document.addEventListener("visibilitychange", onDocVisibility);

	const onMotionChange = (): void => {
		reducedMotion = motion.matches;
		renderer.setReducedMotion(reducedMotion);
		playback.setReducedMotion(reducedMotion);
		requestDraw();
	};
	motion.addEventListener("change", onMotionChange);

	canvas.addEventListener("pointerdown", onPointerDown);
	canvas.addEventListener("pointermove", onPointerMove);
	canvas.addEventListener("pointerup", onPointerUp);
	canvas.addEventListener("pointercancel", onPointerUp);
	canvas.addEventListener("pointerleave", onPointerLeave);
	canvas.addEventListener("dblclick", onDblClick);
	canvas.addEventListener("keydown", onKeyDown);

	/* ── 首帧：先跑一批 tick 让布局接近收敛，再 fit ── */
	simulation.sim.stop();
	for (let i = 0; i < 220; i++) simulation.sim.tick();
	fitView();
	surface.dataset.state = "ready";
	status.textContent = strings.loaded;
	emitStats();
	emitPlayback();
	renderer.draw(performance.now());

	if (reducedMotion) {
		requestDraw();
	} else {
		// 入场自动从头播一遍揭示动画
		playback.restart();
		simulation.reheat(0.12);
		startLoop();
	}

	return {
		destroy() {
			if (destroyed) return;
			destroyed = true;
			stopLoop();
			window.clearTimeout(preloadTimer);
			simulation.destroy();
			resizeObserver.disconnect();
			themeObserver.disconnect();
			visibilityObserver.disconnect();
			document.removeEventListener("visibilitychange", onDocVisibility);
			motion.removeEventListener("change", onMotionChange);
			select(canvas).on(".zoom", null);
			canvas.removeEventListener("pointerdown", onPointerDown);
			canvas.removeEventListener("pointermove", onPointerMove);
			canvas.removeEventListener("pointerup", onPointerUp);
			canvas.removeEventListener("pointercancel", onPointerUp);
			canvas.removeEventListener("pointerleave", onPointerLeave);
			canvas.removeEventListener("dblclick", onDblClick);
			canvas.removeEventListener("keydown", onKeyDown);
		},
		patchFilters(patch) {
			filters = { ...filters, ...patch };
			renderer.setFilters(filters);
			applyFilters(scene, filters);
			treeStale = true;
			if (scene.mode === "mindmap") {
				// 脑图模式不点火物理：可见集变了直接瞬时重排四列
				relayoutMindmap(false);
			} else {
				// 可见集变了要重算连线强度，否则新出现的边没有约束
				simulation.refreshLinks();
				simulation.reheat(0.2);
			}
			emitStats();
			requestDraw();
			startLoop();
		},
		getFilters() {
			return filters;
		},
		playback: {
			toggle: () => {
				playback.toggle();
				startLoop();
			},
			restart: () => {
				playback.restart();
				startLoop();
			},
			getState: () => playback.getState(),
		},
		resetView() {
			fitView();
			requestDraw();
		},
		select(id: string | null) {
			setSelected(id === null ? null : (scene.nodeMap.get(id) ?? null));
		},
		toggleLayout() {
			toggleLayout();
		},
	};
}
