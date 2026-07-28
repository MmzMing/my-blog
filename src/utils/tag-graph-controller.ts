import {
	type D3ZoomEvent,
	forceCollide,
	forceLink,
	forceManyBody,
	forceSimulation,
	forceX,
	forceY,
	type Simulation,
	type SimulationLinkDatum,
	type SimulationNodeDatum,
	select,
	type ZoomBehavior,
	type ZoomTransform,
	zoom,
	zoomIdentity,
} from "d3";
import { navigateToPage } from "@/utils/navigation-utils";
import type {
	TagGraphData,
	TagGraphLink,
	TagGraphNode,
} from "@/utils/tag-graph-data";

const TWO_PI = Math.PI * 2;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const PARTICLE_SPEED = 0.00115;
const MIN_ZOOM = 0.45;
const MAX_ZOOM = 5;

interface GraphNode extends TagGraphNode, SimulationNodeDatum {
	degree: number;
	fx?: number | null;
	fy?: number | null;
	group: number;
	index?: number;
	neighbors: Set<string>;
	radius: number;
	vx?: number;
	vy?: number;
	x?: number;
	y?: number;
}

interface GraphLink extends SimulationLinkDatum<GraphNode> {
	index: number;
	source: string | GraphNode;
	target: string | GraphNode;
	value: number;
}

interface Point {
	x: number;
	y: number;
}

interface ThemeColors {
	muted: string;
	nodes: string[];
	surface: string;
	text: string;
}

export interface TagGraphController {
	destroy(): void;
}

function parseGraph(root: HTMLElement): TagGraphData | null {
	const raw = root.dataset.graph;
	if (!raw) return null;

	try {
		const graph = JSON.parse(raw) as TagGraphData;
		if (!Array.isArray(graph.nodes) || !Array.isArray(graph.links)) return null;
		return graph;
	} catch {
		return null;
	}
}

function endpointId(endpoint: string | GraphNode): string {
	return typeof endpoint === "string" ? endpoint : endpoint.id;
}

function assignGraphGroups(
	nodes: GraphNode[],
	links: GraphLink[],
): GraphNode[][] {
	const nodeMap = new Map(nodes.map((node) => [node.id, node]));
	for (const link of links) {
		const source = nodeMap.get(endpointId(link.source));
		const target = nodeMap.get(endpointId(link.target));
		if (!source || !target) continue;
		source.neighbors.add(target.id);
		target.neighbors.add(source.id);
		source.degree += link.value;
		target.degree += link.value;
	}

	const visited = new Set<string>();
	const groups: GraphNode[][] = [];
	for (const node of nodes) {
		if (visited.has(node.id)) continue;
		const group: GraphNode[] = [];
		const stack = [node];
		visited.add(node.id);

		while (stack.length > 0) {
			const current = stack.pop();
			if (!current) continue;
			group.push(current);
			for (const neighborId of current.neighbors) {
				if (visited.has(neighborId)) continue;
				const neighbor = nodeMap.get(neighborId);
				if (!neighbor) continue;
				visited.add(neighborId);
				stack.push(neighbor);
			}
		}
		groups.push(group);
	}

	groups.sort(
		(a, b) =>
			b.length - a.length ||
			a[0].name.toLowerCase().localeCompare(b[0].name.toLowerCase()),
	);
	groups.forEach((group, groupIndex) => {
		group.forEach((node) => {
			node.group = groupIndex;
		});
	});
	return groups;
}

function getCssVariable(style: CSSStyleDeclaration, name: string): string {
	return style.getPropertyValue(name).trim();
}

function getClientPoint(event: Event): Point | null {
	if (event instanceof MouseEvent) {
		return { x: event.clientX, y: event.clientY };
	}
	if (event instanceof TouchEvent) {
		const touch = event.touches[0] ?? event.changedTouches[0];
		return touch ? { x: touch.clientX, y: touch.clientY } : null;
	}
	return null;
}

function curvePoint(
	source: Point,
	control: Point,
	target: Point,
	t: number,
): Point {
	const inverse = 1 - t;
	return {
		x:
			inverse * inverse * source.x +
			2 * inverse * t * control.x +
			t * t * target.x,
		y:
			inverse * inverse * source.y +
			2 * inverse * t * control.y +
			t * t * target.y,
	};
}

class CanvasTagGraph implements TagGraphController {
	private readonly canvas: HTMLCanvasElement;
	private readonly context: CanvasRenderingContext2D;
	private readonly coreNodeIds = new Set<string>();
	private readonly groups: GraphNode[][];
	private readonly links: GraphLink[];
	private readonly mediaQuery = window.matchMedia(
		"(prefers-reduced-motion: reduce)",
	);
	private readonly nodeMap: Map<string, GraphNode>;
	private readonly nodes: GraphNode[];
	private readonly resizeObserver: ResizeObserver;
	private readonly root: HTMLElement;
	private readonly simulation: Simulation<GraphNode, GraphLink>;
	private readonly status: HTMLElement;
	private readonly surface: HTMLElement;
	private readonly themeObserver: MutationObserver;
	private readonly tooltip: HTMLElement;
	private readonly tooltipMeta: HTMLElement;
	private readonly tooltipTitle: HTMLElement;
	private readonly visibilityObserver: IntersectionObserver;
	private readonly zoomBehavior: ZoomBehavior<HTMLCanvasElement, unknown>;

	private animationFrame = 0;
	private clusterCenters: Point[] = [];
	private destroyed = false;
	private devicePixelRatio = 1;
	private dragMoved = false;
	private draggedNode: GraphNode | null = null;
	private dragOrigin: Point | null = null;
	private height = 0;
	private hoveredNode: GraphNode | null = null;
	private inViewport = true;
	private keyboardIndex = -1;
	private maxLinkValue = 1;
	private pointerInside = false;
	private theme: ThemeColors;
	private transform: ZoomTransform = zoomIdentity;
	private userAdjustedView = false;
	private width = 0;

	constructor(root: HTMLElement, graph: TagGraphData) {
		this.root = root;
		this.surface = this.requireElement<HTMLElement>("[data-tag-graph-surface]");
		this.canvas = this.requireElement<HTMLCanvasElement>(
			"[data-tag-graph-canvas]",
		);
		this.status = this.requireElement<HTMLElement>("[data-tag-graph-status]");
		this.tooltip = this.requireElement<HTMLElement>("[data-tag-graph-tooltip]");
		this.tooltipTitle = this.requireElement<HTMLElement>(
			"[data-tag-graph-tooltip-title]",
		);
		this.tooltipMeta = this.requireElement<HTMLElement>(
			"[data-tag-graph-tooltip-meta]",
		);

		const context = this.canvas.getContext("2d");
		if (!context) throw new Error("Canvas 2D context is unavailable");
		this.context = context;
		this.theme = this.readTheme();

		const values = graph.nodes.map((node) => node.value);
		const minValue = Math.min(...values);
		const maxValue = Math.max(...values);
		const minRoot = Math.sqrt(minValue);
		const range = Math.max(1, Math.sqrt(maxValue) - minRoot);
		this.nodes = graph.nodes.map((node) => ({
			...node,
			degree: 0,
			group: 0,
			neighbors: new Set<string>(),
			radius: 7 + ((Math.sqrt(node.value) - minRoot) / range) * 11,
		}));
		this.nodeMap = new Map(this.nodes.map((node) => [node.id, node]));
		this.links = graph.links
			.filter(
				(link) =>
					this.nodeMap.has(link.source) && this.nodeMap.has(link.target),
			)
			.map((link: TagGraphLink, index) => ({ ...link, index }));
		this.maxLinkValue = Math.max(1, ...this.links.map((link) => link.value));
		this.groups = assignGraphGroups(this.nodes, this.links);
		for (const group of this.groups) {
			const coreNode = [...group].sort(
				(a, b) =>
					b.value - a.value ||
					b.degree - a.degree ||
					a.name.localeCompare(b.name),
			)[0];
			if (coreNode) this.coreNodeIds.add(coreNode.id);
		}

		this.measure();
		this.seedNodePositions();
		this.simulation = this.createSimulation();
		this.zoomBehavior = this.createZoomBehavior();
		select(this.canvas).call(this.zoomBehavior);

		this.resizeObserver = new ResizeObserver(() => this.handleResize());
		this.resizeObserver.observe(this.surface);
		this.themeObserver = new MutationObserver(() => {
			this.theme = this.readTheme();
			this.draw(performance.now());
		});
		this.themeObserver.observe(document.documentElement, {
			attributeFilter: ["class", "data-theme"],
			attributes: true,
		});
		this.visibilityObserver = new IntersectionObserver((entries) => {
			this.inViewport = entries[0]?.isIntersecting ?? false;
			this.syncActivity();
		});
		this.visibilityObserver.observe(this.surface);

		this.bindEvents();
		this.surface.dataset.state = "ready";
		this.canvas.dataset.initialized = "true";
		this.status.textContent = "关系图谱已加载";

		if (this.mediaQuery.matches) {
			this.simulation.stop();
			for (let index = 0; index < 180; index++) this.simulation.tick();
			this.fitGraph();
			this.draw(performance.now());
		} else {
			this.startAnimation();
			this.simulation.restart();
		}
	}

	destroy(): void {
		if (this.destroyed) return;
		this.destroyed = true;
		cancelAnimationFrame(this.animationFrame);
		this.animationFrame = 0;
		this.simulation.stop();
		this.resizeObserver.disconnect();
		this.themeObserver.disconnect();
		this.visibilityObserver.disconnect();
		select(this.canvas).on(".zoom", null);
		this.canvas.removeEventListener("pointerdown", this.handlePointerDown);
		this.canvas.removeEventListener("pointermove", this.handlePointerMove);
		this.canvas.removeEventListener("pointerup", this.handlePointerUp);
		this.canvas.removeEventListener("pointercancel", this.handlePointerUp);
		this.canvas.removeEventListener("pointerleave", this.handlePointerLeave);
		this.canvas.removeEventListener("keydown", this.handleKeydown);
		this.canvas.removeEventListener("focus", this.handleFocus);
		this.canvas.removeEventListener("blur", this.handleBlur);
		document.removeEventListener(
			"visibilitychange",
			this.handleDocumentVisibility,
		);
		this.mediaQuery.removeEventListener("change", this.handleMotionPreference);
	}

	private bindEvents(): void {
		this.canvas.addEventListener("pointerdown", this.handlePointerDown);
		this.canvas.addEventListener("pointermove", this.handlePointerMove);
		this.canvas.addEventListener("pointerup", this.handlePointerUp);
		this.canvas.addEventListener("pointercancel", this.handlePointerUp);
		this.canvas.addEventListener("pointerleave", this.handlePointerLeave);
		this.canvas.addEventListener("keydown", this.handleKeydown);
		this.canvas.addEventListener("focus", this.handleFocus);
		this.canvas.addEventListener("blur", this.handleBlur);
		document.addEventListener(
			"visibilitychange",
			this.handleDocumentVisibility,
		);
		this.mediaQuery.addEventListener("change", this.handleMotionPreference);
	}

	private createSimulation(): Simulation<GraphNode, GraphLink> {
		const linkForce = forceLink<GraphNode, GraphLink>(this.links)
			.id((node) => node.id)
			.distance((link) => 92 - Math.min(30, link.value * 10))
			.strength((link) => 0.18 + (link.value / this.maxLinkValue) * 0.25);

		return forceSimulation<GraphNode>(this.nodes)
			.force("link", linkForce)
			.force(
				"charge",
				forceManyBody<GraphNode>()
					.strength((node) => -70 - node.radius * 5)
					.distanceMax(320),
			)
			.force(
				"collide",
				forceCollide<GraphNode>()
					.radius((node) => node.radius + 8)
					.strength(0.92)
					.iterations(2),
			)
			.force(
				"x",
				forceX<GraphNode>((node) => this.getClusterCenter(node).x).strength(
					0.085,
				),
			)
			.force(
				"y",
				forceY<GraphNode>((node) => this.getClusterCenter(node).y).strength(
					0.085,
				),
			)
			.alphaDecay(0.035)
			.velocityDecay(0.42)
			.on("end", () => {
				if (!this.userAdjustedView) this.fitGraph();
				this.draw(performance.now());
			});
	}

	private createZoomBehavior(): ZoomBehavior<HTMLCanvasElement, unknown> {
		return zoom<HTMLCanvasElement, unknown>()
			.scaleExtent([MIN_ZOOM, MAX_ZOOM])
			.filter((event: Event) => {
				if (event.type === "wheel" || event.type === "dblclick") return true;
				const point = getClientPoint(event);
				return !point || !this.findNodeFromClientPoint(point);
			})
			.on("zoom", (event: D3ZoomEvent<HTMLCanvasElement, unknown>) => {
				this.transform = event.transform;
				if (event.sourceEvent) this.userAdjustedView = true;
				this.draw(performance.now());
			});
	}

	private draw(time: number): void {
		if (this.destroyed || this.width <= 0 || this.height <= 0) return;
		const context = this.context;
		context.setTransform(
			this.devicePixelRatio,
			0,
			0,
			this.devicePixelRatio,
			0,
			0,
		);
		context.clearRect(0, 0, this.width, this.height);
		context.fillStyle = this.theme.surface;
		context.fillRect(0, 0, this.width, this.height);

		context.save();
		context.translate(this.transform.x, this.transform.y);
		context.scale(this.transform.k, this.transform.k);
		this.drawLinks(context, time);
		this.drawNodes(context);
		this.drawLabels(context);
		context.restore();
	}

	private drawLinks(context: CanvasRenderingContext2D, time: number): void {
		const hasFocus = this.hoveredNode !== null;
		for (const link of this.links) {
			const source = this.resolveNode(link.source);
			const target = this.resolveNode(link.target);
			if (
				!source ||
				!target ||
				source.x == null ||
				source.y == null ||
				target.x == null ||
				target.y == null
			)
				continue;
			const highlighted = this.isHighlightedLink(link);
			const control = this.getCurveControl(source, target, link.index);

			context.beginPath();
			context.moveTo(source.x, source.y);
			context.quadraticCurveTo(control.x, control.y, target.x, target.y);
			context.strokeStyle = this.nodeColor(source);
			context.globalAlpha = hasFocus ? (highlighted ? 0.72 : 0.055) : 0.2;
			context.lineWidth =
				(0.75 + (link.value / this.maxLinkValue) * 1.5) / this.transform.k;
			context.stroke();

			if (!this.mediaQuery.matches) {
				const particleCount = highlighted && hasFocus ? 4 : 1;
				for (
					let particleIndex = 0;
					particleIndex < particleCount;
					particleIndex++
				) {
					const phase =
						time * PARTICLE_SPEED +
						link.index * 0.71 +
						(particleIndex / particleCount) * TWO_PI;
					const progress = (Math.sin(phase) + 1) / 2;
					const particle = curvePoint(
						{ x: source.x, y: source.y },
						control,
						{ x: target.x, y: target.y },
						progress,
					);
					context.beginPath();
					context.arc(
						particle.x,
						particle.y,
						(highlighted ? 2.5 : 1.7) / this.transform.k,
						0,
						TWO_PI,
					);
					context.fillStyle = this.nodeColor(source);
					context.globalAlpha = hasFocus ? (highlighted ? 0.95 : 0.08) : 0.6;
					context.fill();
				}
			}
		}
		context.globalAlpha = 1;
	}

	private drawNodes(context: CanvasRenderingContext2D): void {
		const hasFocus = this.hoveredNode !== null;
		for (const node of this.nodes) {
			if (node.x == null || node.y == null) continue;
			const highlighted = this.isHighlightedNode(node);
			const hovered = node === this.hoveredNode;
			context.beginPath();
			context.arc(
				node.x,
				node.y,
				node.radius + (hovered ? 2.5 / this.transform.k : 0),
				0,
				TWO_PI,
			);
			context.fillStyle = this.nodeColor(node);
			context.globalAlpha = hasFocus && !highlighted ? 0.12 : 0.96;
			context.fill();
		}
		context.globalAlpha = 1;
	}

	private drawLabels(context: CanvasRenderingContext2D): void {
		const hasFocus = this.hoveredNode !== null;
		for (const node of this.nodes) {
			if (node.x == null || node.y == null || !this.shouldDrawLabel(node))
				continue;
			const highlighted = this.isHighlightedNode(node);
			const hovered = node === this.hoveredNode;
			const idleCore = !hasFocus && this.coreNodeIds.has(node.id);
			const baseSize = idleCore
				? Math.min(46, 22 + Math.sqrt(node.value) * 5)
				: Math.min(18, 10.5 + Math.sqrt(node.value) * 2.25);
			const fontSize =
				(hovered ? baseSize + 2 : baseSize) / this.transform.k ** 0.72;
			const text = this.fitLabel(
				context,
				node.name,
				180 / this.transform.k,
				fontSize,
			);
			const y = idleCore
				? node.y
				: node.y + node.radius + fontSize + 4 / this.transform.k;

			context.font = `${hovered || idleCore ? 800 : 700} ${fontSize}px sans-serif`;
			context.textAlign = "center";
			context.textBaseline = "middle";
			context.lineJoin = "round";
			context.strokeStyle = this.theme.surface;
			context.lineWidth = (idleCore ? 5 : 4) / this.transform.k;
			context.globalAlpha = idleCore
				? 0.24
				: hasFocus && !highlighted
					? 0.08
					: 0.94;
			context.strokeText(text, node.x, y);
			context.fillStyle = idleCore
				? this.nodeColor(node)
				: hovered
					? this.theme.text
					: this.theme.muted;
			context.globalAlpha = idleCore
				? 0.42
				: hasFocus && !highlighted
					? 0.08
					: 0.94;
			context.fillText(text, node.x, y);
		}
		context.globalAlpha = 1;
	}

	private fitLabel(
		context: CanvasRenderingContext2D,
		label: string,
		maxWidth: number,
		fontSize: number,
	): string {
		context.font = `700 ${fontSize}px sans-serif`;
		if (context.measureText(label).width <= maxWidth) return label;
		let shortened = label;
		while (
			shortened.length > 2 &&
			context.measureText(`${shortened}…`).width > maxWidth
		) {
			shortened = shortened.slice(0, -1);
		}
		return `${shortened}…`;
	}

	private shouldDrawLabel(node: GraphNode): boolean {
		if (!this.hoveredNode) return this.coreNodeIds.has(node.id);
		return this.isHighlightedNode(node);
	}

	private isHighlightedNode(node: GraphNode): boolean {
		return (
			this.hoveredNode === null ||
			node === this.hoveredNode ||
			this.hoveredNode.neighbors.has(node.id)
		);
	}

	private isHighlightedLink(link: GraphLink): boolean {
		if (!this.hoveredNode) return false;
		const sourceId = endpointId(link.source);
		const targetId = endpointId(link.target);
		return sourceId === this.hoveredNode.id || targetId === this.hoveredNode.id;
	}

	private getCurveControl(
		source: GraphNode,
		target: GraphNode,
		index: number,
	): Point {
		const sourceX = source.x ?? 0;
		const sourceY = source.y ?? 0;
		const targetX = target.x ?? 0;
		const targetY = target.y ?? 0;
		const dx = targetX - sourceX;
		const dy = targetY - sourceY;
		const length = Math.max(1, Math.hypot(dx, dy));
		const direction = index % 2 === 0 ? 1 : -1;
		const curve = Math.min(18, length * 0.08) * direction;
		return {
			x: (sourceX + targetX) / 2 + (-dy / length) * curve,
			y: (sourceY + targetY) / 2 + (dx / length) * curve,
		};
	}

	private resolveNode(endpoint: string | GraphNode): GraphNode | undefined {
		return typeof endpoint === "string" ? this.nodeMap.get(endpoint) : endpoint;
	}

	private nodeColor(node: GraphNode): string {
		return (
			this.theme.nodes[node.group % this.theme.nodes.length] ?? this.theme.text
		);
	}

	private readTheme(): ThemeColors {
		const style = getComputedStyle(this.surface);
		const text = getCssVariable(style, "--tag-graph-text");
		const nodes = Array.from({ length: 8 }, (_, index) =>
			getCssVariable(style, `--tag-graph-node-${index + 1}`),
		).filter(Boolean);
		return {
			muted: getCssVariable(style, "--tag-graph-muted") || text,
			nodes: nodes.length > 0 ? nodes : [text],
			surface: getCssVariable(style, "--tag-graph-surface"),
			text,
		};
	}

	private measure(): void {
		const rect = this.surface.getBoundingClientRect();
		this.width = Math.max(1, Math.round(rect.width));
		this.height = Math.max(1, Math.round(rect.height));
		this.devicePixelRatio = Math.min(2, window.devicePixelRatio || 1);
		this.canvas.width = Math.round(this.width * this.devicePixelRatio);
		this.canvas.height = Math.round(this.height * this.devicePixelRatio);
		this.updateClusterCenters();
	}

	private updateClusterCenters(): void {
		const count = this.groups.length;
		const radius = count <= 1 ? 0 : Math.min(this.width, this.height) * 0.25;
		this.clusterCenters = this.groups.map((_, index) => {
			const angle = -Math.PI / 2 + (index / Math.max(1, count)) * TWO_PI;
			return {
				x: this.width / 2 + Math.cos(angle) * radius,
				y: this.height / 2 + Math.sin(angle) * radius,
			};
		});
	}

	private getClusterCenter(node: GraphNode): Point {
		return (
			this.clusterCenters[node.group] ?? {
				x: this.width / 2,
				y: this.height / 2,
			}
		);
	}

	private seedNodePositions(): void {
		for (const group of this.groups) {
			for (let index = 0; index < group.length; index++) {
				const node = group[index];
				const center = this.getClusterCenter(node);
				const radius = 18 + Math.sqrt(index) * 24;
				const angle = index * GOLDEN_ANGLE;
				node.x = center.x + Math.cos(angle) * radius;
				node.y = center.y + Math.sin(angle) * radius;
			}
		}
	}

	private handleResize(): void {
		if (
			this.destroyed ||
			this.surface.offsetWidth === 0 ||
			this.surface.offsetHeight === 0
		)
			return;
		const previousWidth = this.width;
		const previousHeight = this.height;
		this.measure();
		if (previousWidth === this.width && previousHeight === this.height) {
			this.draw(performance.now());
			return;
		}
		if (!this.mediaQuery.matches && this.inViewport) {
			this.simulation.alpha(0.28).restart();
		}
		this.draw(performance.now());
	}

	private fitGraph(): void {
		if (this.nodes.length === 0) return;
		const positions = this.nodes.filter(
			(node): node is GraphNode & { x: number; y: number } =>
				node.x != null && node.y != null,
		);
		if (positions.length === 0) return;

		const minX = Math.min(
			...positions.map((node) => node.x - node.radius - 24),
		);
		const maxX = Math.max(
			...positions.map((node) => node.x + node.radius + 24),
		);
		const minY = Math.min(
			...positions.map((node) => node.y - node.radius - 36),
		);
		const maxY = Math.max(
			...positions.map((node) => node.y + node.radius + 36),
		);
		const graphWidth = Math.max(1, maxX - minX);
		const graphHeight = Math.max(1, maxY - minY);
		const scale = Math.max(
			MIN_ZOOM,
			Math.min(
				1.25,
				(this.width - 48) / graphWidth,
				(this.height - 48) / graphHeight,
			),
		);
		const centerX = (minX + maxX) / 2;
		const centerY = (minY + maxY) / 2;
		const transform = zoomIdentity
			.translate(
				this.width / 2 - centerX * scale,
				this.height / 2 - centerY * scale,
			)
			.scale(scale);
		select(this.canvas).call(this.zoomBehavior.transform, transform);
	}

	private clientToGraph(point: Point): Point {
		const rect = this.canvas.getBoundingClientRect();
		const local: [number, number] = [point.x - rect.left, point.y - rect.top];
		const [x, y] = this.transform.invert(local);
		return { x, y };
	}

	private graphToLocal(node: GraphNode): Point {
		const [x, y] = this.transform.apply([node.x ?? 0, node.y ?? 0]);
		return { x, y };
	}

	private findNodeFromClientPoint(point: Point): GraphNode | null {
		const graphPoint = this.clientToGraph(point);
		let nearest: GraphNode | null = null;
		let nearestDistance = Number.POSITIVE_INFINITY;
		for (const node of this.nodes) {
			if (node.x == null || node.y == null) continue;
			const distance = Math.hypot(graphPoint.x - node.x, graphPoint.y - node.y);
			const hitRadius = node.radius + 8 / this.transform.k;
			if (distance <= hitRadius && distance < nearestDistance) {
				nearest = node;
				nearestDistance = distance;
			}
		}
		return nearest;
	}

	private setHoveredNode(node: GraphNode | null, localPoint?: Point): void {
		if (this.hoveredNode === node && !localPoint) return;
		this.hoveredNode = node;
		if (node) {
			this.canvas.classList.add("is-node-hovered");
			this.showTooltip(node, localPoint ?? this.graphToLocal(node));
		} else {
			this.canvas.classList.remove("is-node-hovered");
			this.hideTooltip();
		}
		this.draw(performance.now());
	}

	private showTooltip(node: GraphNode, point: Point): void {
		this.tooltipTitle.textContent = node.name;
		this.tooltipMeta.textContent = `${node.value} 篇文章 · 关联 ${node.neighbors.size} 个标签`;
		this.tooltip.hidden = false;
		this.tooltip.setAttribute("aria-hidden", "false");
		const tooltipWidth = this.tooltip.offsetWidth;
		const tooltipHeight = this.tooltip.offsetHeight;
		const left = Math.min(
			Math.max(8, point.x + 14),
			Math.max(8, this.width - tooltipWidth - 8),
		);
		const top = Math.min(
			Math.max(8, point.y + 14),
			Math.max(8, this.height - tooltipHeight - 8),
		);
		this.tooltip.style.left = `${left}px`;
		this.tooltip.style.top = `${top}px`;
	}

	private hideTooltip(): void {
		this.tooltip.hidden = true;
		this.tooltip.setAttribute("aria-hidden", "true");
	}

	private startAnimation(): void {
		if (this.animationFrame || this.destroyed || this.mediaQuery.matches)
			return;
		const frame = (time: number) => {
			if (this.destroyed || !this.shouldAnimate()) {
				this.animationFrame = 0;
				return;
			}
			this.draw(time);
			this.animationFrame = requestAnimationFrame(frame);
		};
		this.animationFrame = requestAnimationFrame(frame);
	}

	private shouldAnimate(): boolean {
		return this.inViewport && document.visibilityState === "visible";
	}

	private syncActivity(): void {
		if (this.shouldAnimate()) {
			if (!this.mediaQuery.matches) {
				this.startAnimation();
				if (this.simulation.alpha() > this.simulation.alphaMin()) {
					this.simulation.restart();
				}
			}
			this.draw(performance.now());
			return;
		}

		cancelAnimationFrame(this.animationFrame);
		this.animationFrame = 0;
		this.simulation.stop();
	}

	private navigateToNode(node: GraphNode): void {
		if (node.url) navigateToPage(node.url);
	}

	private requireElement<T extends Element>(selector: string): T {
		const element = this.root.querySelector<T>(selector);
		if (!element) throw new Error(`Missing tag graph element: ${selector}`);
		return element;
	}

	private readonly handlePointerDown = (event: PointerEvent): void => {
		if (event.button !== 0) return;
		const node = this.findNodeFromClientPoint({
			x: event.clientX,
			y: event.clientY,
		});
		if (!node) return;
		event.preventDefault();
		this.canvas.setPointerCapture(event.pointerId);
		this.draggedNode = node;
		this.dragMoved = false;
		this.dragOrigin = { x: event.clientX, y: event.clientY };
		const graphPoint = this.clientToGraph({
			x: event.clientX,
			y: event.clientY,
		});
		node.fx = graphPoint.x;
		node.fy = graphPoint.y;
		this.canvas.classList.add("is-dragging");
		this.userAdjustedView = true;
		if (!this.mediaQuery.matches) this.simulation.alphaTarget(0.22).restart();
		this.setHoveredNode(node, {
			x: event.clientX - this.canvas.getBoundingClientRect().left,
			y: event.clientY - this.canvas.getBoundingClientRect().top,
		});
	};

	private readonly handlePointerMove = (event: PointerEvent): void => {
		this.pointerInside = true;
		const rect = this.canvas.getBoundingClientRect();
		const localPoint = {
			x: event.clientX - rect.left,
			y: event.clientY - rect.top,
		};
		if (this.draggedNode) {
			const graphPoint = this.clientToGraph({
				x: event.clientX,
				y: event.clientY,
			});
			this.draggedNode.fx = graphPoint.x;
			this.draggedNode.fy = graphPoint.y;
			if (
				this.dragOrigin &&
				Math.hypot(
					event.clientX - this.dragOrigin.x,
					event.clientY - this.dragOrigin.y,
				) > 5
			) {
				this.dragMoved = true;
			}
			this.showTooltip(this.draggedNode, localPoint);
			this.draw(performance.now());
			return;
		}

		const node = this.findNodeFromClientPoint({
			x: event.clientX,
			y: event.clientY,
		});
		this.setHoveredNode(node, node ? localPoint : undefined);
	};

	private readonly handlePointerUp = (event: PointerEvent): void => {
		const node = this.draggedNode;
		if (!node) return;
		if (this.canvas.hasPointerCapture(event.pointerId)) {
			this.canvas.releasePointerCapture(event.pointerId);
		}
		node.fx = null;
		node.fy = null;
		this.draggedNode = null;
		this.dragOrigin = null;
		this.canvas.classList.remove("is-dragging");
		if (!this.mediaQuery.matches) this.simulation.alphaTarget(0);
		if (!this.dragMoved) this.navigateToNode(node);
		this.dragMoved = false;
	};

	private readonly handlePointerLeave = (): void => {
		this.pointerInside = false;
		if (!this.draggedNode && document.activeElement !== this.canvas) {
			this.setHoveredNode(null);
		}
	};

	private readonly handleKeydown = (event: KeyboardEvent): void => {
		if (this.nodes.length === 0) return;
		const previousIndex = this.keyboardIndex;
		if (event.key === "ArrowRight" || event.key === "ArrowDown") {
			this.keyboardIndex = (this.keyboardIndex + 1) % this.nodes.length;
		} else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
			this.keyboardIndex =
				(this.keyboardIndex - 1 + this.nodes.length) % this.nodes.length;
		} else if (event.key === "Home") {
			this.keyboardIndex = 0;
		} else if (event.key === "End") {
			this.keyboardIndex = this.nodes.length - 1;
		} else if (event.key === "Enter" || event.key === " ") {
			if (this.keyboardIndex >= 0) {
				event.preventDefault();
				this.navigateToNode(this.nodes[this.keyboardIndex]);
			}
			return;
		} else if (event.key === "Escape") {
			this.keyboardIndex = -1;
			this.setHoveredNode(null);
			return;
		} else {
			return;
		}

		event.preventDefault();
		if (this.keyboardIndex !== previousIndex) {
			const node = this.nodes[this.keyboardIndex];
			this.setHoveredNode(node, this.graphToLocal(node));
		}
	};

	private readonly handleFocus = (): void => {
		if (
			this.pointerInside ||
			this.keyboardIndex >= 0 ||
			this.nodes.length === 0
		)
			return;
		this.keyboardIndex = 0;
		const node = this.nodes[0];
		this.setHoveredNode(node, this.graphToLocal(node));
	};

	private readonly handleBlur = (): void => {
		this.keyboardIndex = -1;
		if (!this.pointerInside) this.setHoveredNode(null);
	};

	private readonly handleDocumentVisibility = (): void => {
		this.syncActivity();
	};

	private readonly handleMotionPreference = (): void => {
		if (this.mediaQuery.matches) {
			cancelAnimationFrame(this.animationFrame);
			this.animationFrame = 0;
			this.simulation.stop();
			for (let index = 0; index < 80; index++) this.simulation.tick();
			this.draw(performance.now());
			return;
		}
		this.startAnimation();
	};
}

export function mountTagGraph(root: HTMLElement): TagGraphController {
	const graph = parseGraph(root);
	const surface = root.querySelector<HTMLElement>("[data-tag-graph-surface]");
	const status = root.querySelector<HTMLElement>("[data-tag-graph-status]");
	if (!graph || graph.nodes.length === 0) {
		if (surface) surface.dataset.state = graph ? "empty" : "error";
		if (status) {
			status.textContent = graph ? "暂无标签关系" : "关系图谱数据无效";
		}
		return { destroy() {} };
	}
	return new CanvasTagGraph(root, graph);
}
