import type { ZoomTransform } from "d3";
import {
	curvePoint,
	easeOutBack,
	easeOutCubic,
	fitLabel,
	getCurveControl,
	TWO_PI,
} from "./geometry";
import { nodeColor, readTheme, type Scene, TIER_ALPHA } from "./scene";
import type { FilterState, GraphTier, SceneNode } from "./types";

const PARTICLE_SPEED = 0.00115;
const MAX_PARTICLES = 140;

/** 层级 → 节点可见的最小缩放。缩小时先收掉细节层，避免糊成一片 */
const TIER_MIN_ZOOM: Record<GraphTier, number> = {
	category: 0,
	tag: 0,
	post: 0.5,
	heading: 0.85,
};

/** 层级 → 标签出现的缩放阈值 */
const LABEL_MIN_ZOOM: Record<GraphTier, number> = {
	category: 0,
	tag: 0.7,
	post: 1.4,
	heading: 2.2,
};

/** 标签占位网格，越靠前的层级先占格 */
const LABEL_PRIORITY: GraphTier[] = ["category", "tag", "post", "heading"];

export type Renderer = {
	draw(time: number): void;
	measure(): void;
	refreshTheme(): void;
	setTransform(transform: ZoomTransform): void;
	getTransform(): ZoomTransform;
	setFilters(state: FilterState): void;
	setReducedMotion(value: boolean): void;
};

export function createRenderer(
	canvas: HTMLCanvasElement,
	surface: HTMLElement,
	scene: Scene,
	initialFilters: FilterState,
	initialTransform: ZoomTransform,
): Renderer {
	const context = canvas.getContext("2d");
	if (!context) throw new Error("Canvas 2D context is unavailable");

	let theme = readTheme(surface);
	let transform = initialTransform;
	let filters = initialFilters;
	let reducedMotion = false;
	let dpr = 1;
	/** 标签占格网格，每帧清空。用网格哈希而非矩形相交，避免 O(n²) */
	const labelCells = new Set<string>();
	let frame = 0;

	/**
	 * DPR 面积自适应：全屏后画布面积是原来的约 4 倍，
	 * 固定 min(2, dpr) 会让后备缓冲达到 8.3M 像素。压到约 4.2M 以内。
	 */
	const computeDpr = (): number => {
		const raw = window.devicePixelRatio || 1;
		const area = Math.max(1, scene.width * scene.height);
		return Math.max(1, Math.min(2, raw, Math.sqrt(4_200_000 / area)));
	};

	const measure = (): void => {
		const rect = surface.getBoundingClientRect();
		scene.width = Math.max(1, Math.round(rect.width));
		scene.height = Math.max(1, Math.round(rect.height));
		dpr = computeDpr();
		canvas.width = Math.round(scene.width * dpr);
		canvas.height = Math.round(scene.height * dpr);
	};

	const tierVisible = (tier: GraphTier): boolean =>
		filters.tiers[tier] && transform.k >= TIER_MIN_ZOOM[tier];

	const drawable = (node: SceneNode): boolean =>
		node.filtered && node.reveal > 0.01 && tierVisible(node.tier);

	/** 聚焦时的透明度权重：选中/邻居亮，其余压到很低 */
	const focusAlpha = (node: SceneNode): number => {
		if (filters.query.trim().length > 0) return node.matched ? 1 : 0.08;
		const anchor = scene.selected ?? scene.hovered;
		if (!anchor) return 1;
		if (node === anchor) return 1;
		return anchor.neighbors.has(node.data.id) ? 0.85 : 0.07;
	};

	/** 视口矩形（图坐标系），留 64px 余量避免边缘弹出 */
	const viewport = () => {
		const [x0, y0] = transform.invert([-64, -64]);
		const [x1, y1] = transform.invert([scene.width + 64, scene.height + 64]);
		return { x0, y0, x1, y1 };
	};

	/** 背景网格：画在图坐标系里，随缩放平移一起动，颜色取主题中性色 */
	const drawGrid = (): void => {
		const view = viewport();
		const spacing = 56;
		context.beginPath();
		for (
			let x = Math.floor(view.x0 / spacing) * spacing;
			x <= view.x1;
			x += spacing
		) {
			context.moveTo(x, view.y0);
			context.lineTo(x, view.y1);
		}
		for (
			let y = Math.floor(view.y0 / spacing) * spacing;
			y <= view.y1;
			y += spacing
		) {
			context.moveTo(view.x0, y);
			context.lineTo(view.x1, y);
		}
		context.strokeStyle = theme.muted;
		context.globalAlpha = 0.09;
		context.lineWidth = 1 / transform.k;
		context.stroke();
		context.globalAlpha = 1;
	};

	const drawLinks = (time: number): void => {
		const view = viewport();
		const hasFocus = Boolean(scene.selected ?? scene.hovered);
		let particles = 0;
		const particlesOn =
			filters.particles && !reducedMotion && transform.k >= 0.9;

		for (const link of scene.links) {
			if (!link.visible) continue;
			const a = link.source as SceneNode;
			const b = link.target as SceneNode;
			if (typeof a === "string" || typeof b === "string") continue;
			if (!drawable(a) || !drawable(b)) continue;
			const ax = a.x ?? 0;
			const ay = a.y ?? 0;
			const bx = b.x ?? 0;
			const by = b.y ?? 0;
			// 两端都在视口同一侧则整条剔除
			if (
				(ax < view.x0 && bx < view.x0) ||
				(ax > view.x1 && bx > view.x1) ||
				(ay < view.y0 && by < view.y0) ||
				(ay > view.y1 && by > view.y1)
			)
				continue;

			const lit =
				hasFocus &&
				(() => {
					const anchor = scene.selected ?? scene.hovered;
					return anchor === a || anchor === b;
				})();
			// 回放：连线随两端揭示进度一起生长
			const grow = Math.min(a.reveal, b.reveal);
			if (grow <= 0.01) continue;

			const control = getCurveControl(ax, ay, bx, by, link.index);

			context.beginPath();
			context.moveTo(ax, ay);
			if (grow >= 0.999) {
				context.quadraticCurveTo(control.x, control.y, bx, by);
			} else {
				// 分段采样画出部分曲线，复用 curvePoint 不需要新数学
				for (let i = 1; i <= 12; i++) {
					const p = curvePoint(
						{ x: ax, y: ay },
						control,
						{ x: bx, y: by },
						(grow * i) / 12,
					);
					context.lineTo(p.x, p.y);
				}
			}
			context.strokeStyle = nodeColor(a, theme);
			context.globalAlpha = (hasFocus ? (lit ? 0.72 : 0.05) : 0.2) * grow;
			context.lineWidth =
				(0.75 + (link.value / scene.maxLinkValue) * 1.5) / transform.k;
			context.stroke();

			if (!particlesOn || link.kind === "post-heading") continue;
			if (context.globalAlpha < 0.06) continue;
			const count = lit ? 3 : 1;
			// 非聚焦边按帧轮转，平均每 3 帧亮一次，视觉上仍连续
			if (!lit && link.index % 3 !== frame % 3) continue;
			if (particles >= MAX_PARTICLES) continue;
			for (let i = 0; i < count; i++) {
				const phase =
					time * PARTICLE_SPEED + link.index * 0.71 + (i / count) * TWO_PI;
				const progress = ((Math.sin(phase) + 1) / 2) * grow;
				const p = curvePoint(
					{ x: ax, y: ay },
					control,
					{ x: bx, y: by },
					progress,
				);
				context.beginPath();
				context.arc(p.x, p.y, (lit ? 2.5 : 1.7) / transform.k, 0, TWO_PI);
				context.fillStyle = nodeColor(a, theme);
				context.globalAlpha = (hasFocus ? (lit ? 0.95 : 0.08) : 0.6) * grow;
				context.fill();
				particles++;
			}
		}
		context.globalAlpha = 1;
	};

	const drawNodes = (): void => {
		const view = viewport();
		for (const node of scene.nodes) {
			if (!drawable(node)) continue;
			const x = node.x ?? 0;
			const y = node.y ?? 0;
			if (x < view.x0 || x > view.x1 || y < view.y0 || y > view.y1) continue;

			// 回放揭示：半径带轻微过冲，透明度线性追上
			const scale = easeOutBack(node.reveal);
			const r =
				node.radius * Math.max(0.01, scale) +
				(node === scene.hovered ? 2.5 / transform.k : 0);
			const color = nodeColor(node, theme);

			context.beginPath();
			context.arc(x, y, r, 0, TWO_PI);
			context.fillStyle = color;
			context.globalAlpha =
				TIER_ALPHA[node.tier] * focusAlpha(node) * easeOutCubic(node.reveal);
			context.fill();

			// 分类节点加 surface 色描边，形成「挖空」的层次感
			if (node.tier === "category") {
				context.lineWidth = 2.5 / transform.k;
				context.strokeStyle = theme.surface;
				context.globalAlpha *= 0.9;
				context.stroke();
			}

			// 选中环
			if (node.selected) {
				context.beginPath();
				context.arc(x, y, r + 4 / transform.k, 0, TWO_PI);
				context.strokeStyle = color;
				context.lineWidth = 2 / transform.k;
				context.globalAlpha = 1;
				context.stroke();
			}
		}
		context.globalAlpha = 1;
	};

	/** 屏幕空间网格占位，48×20px 一格。密处只留高优先级标签 */
	const claimCell = (sx: number, sy: number): boolean => {
		const key = `${Math.round(sx / 48)}:${Math.round(sy / 20)}`;
		if (labelCells.has(key)) return false;
		labelCells.add(key);
		return true;
	};

	const drawLabels = (): void => {
		labelCells.clear();
		const view = viewport();
		const anchor = scene.selected ?? scene.hovered;
		const searching = filters.query.trim().length > 0;

		for (const tier of LABEL_PRIORITY) {
			if (!filters.tiers[tier]) continue;
			for (const node of scene.byTier[tier]) {
				if (!drawable(node)) continue;
				const x = node.x ?? 0;
				const y = node.y ?? 0;
				if (x < view.x0 || x > view.x1 || y < view.y0 || y > view.y1) continue;

				const focused =
					node === anchor || (anchor?.neighbors.has(node.data.id) ?? false);
				// 显示条件：缩放够大 / 被聚焦 / 命中搜索
				if (
					transform.k < LABEL_MIN_ZOOM[tier] &&
					!focused &&
					!(searching && node.matched)
				)
					continue;

				const isCategory = tier === "category";
				const base = isCategory
					? Math.min(44, 26 + Math.sqrt(node.data.value) * 4)
					: tier === "tag"
						? Math.min(17, 11 + Math.sqrt(node.data.value) * 1.9)
						: tier === "post"
							? 12
							: 10.5;
				// 字号除以 k**0.72：放大时字不等比膨胀，观感更接近 Obsidian
				const size = base / transform.k ** 0.72;
				const ty = isCategory ? y : y + node.radius + size * 0.9;

				const [sx, sy] = transform.apply([x, ty]);
				// 分类与被聚焦节点无条件占格，其余让位
				if (!isCategory && !focused && !claimCell(sx, sy)) continue;

				context.font = `${focused || isCategory ? 800 : 700} ${size}px sans-serif`;
				context.textAlign = "center";
				context.textBaseline = "middle";
				context.lineJoin = "round";
				const text = fitLabel(context, node.data.name, 170 / transform.k);
				const alpha = focused ? 0.95 : isCategory ? 0.4 : 0.9;
				const dim = focusAlpha(node) * easeOutCubic(node.reveal);

				context.strokeStyle = theme.surface;
				context.lineWidth = (isCategory ? 5 : 4) / transform.k;
				context.globalAlpha = alpha * dim * 0.75;
				context.strokeText(text, x, ty);

				context.fillStyle = isCategory
					? nodeColor(node, theme)
					: focused
						? theme.text
						: theme.muted;
				context.globalAlpha = alpha * dim;
				context.fillText(text, x, ty);
			}
		}
		context.globalAlpha = 1;
	};

	return {
		draw(time: number) {
			if (scene.width <= 0 || scene.height <= 0) return;
			frame++;
			context.setTransform(dpr, 0, 0, dpr, 0, 0);
			context.clearRect(0, 0, scene.width, scene.height);
			context.fillStyle = theme.surface;
			context.fillRect(0, 0, scene.width, scene.height);

			context.save();
			context.translate(transform.x, transform.y);
			context.scale(transform.k, transform.k);
			drawGrid();
			drawLinks(time);
			drawNodes();
			drawLabels();
			context.restore();
		},
		measure,
		refreshTheme() {
			theme = readTheme(surface);
		},
		setTransform(next) {
			transform = next;
		},
		getTransform() {
			return transform;
		},
		setFilters(state) {
			filters = state;
		},
		setReducedMotion(value) {
			reducedMotion = value;
		},
	};
}
