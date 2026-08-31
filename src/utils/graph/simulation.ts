import {
	forceCollide,
	forceLink,
	forceManyBody,
	forceRadial,
	forceSimulation,
	type Simulation,
} from "d3";
import { type Scene, TIER_RING } from "./scene";
import type { KGLinkKind, SceneLink, SceneNode } from "./types";

const LINK_DISTANCE: Record<KGLinkKind, number> = {
	"post-heading": 64,
	"tag-post": 72,
	"category-tag": 110,
	"category-post": 96,
	"tag-tag": 150,
};

const LINK_STRENGTH: Record<KGLinkKind, number> = {
	"post-heading": 0.5,
	"tag-post": 0.42,
	"category-tag": 0.3,
	"category-post": 0.35,
	"tag-tag": 0.06,
};

/** 斥力按层分档：标题最多，斥力本应最小，但它们共享同一个父节点，
    太小会整摞重叠，所以标题层反而要给足斥力 */
const CHARGE: Record<string, number> = {
	category: -900,
	tag: -320,
	post: -180,
	heading: -190,
};

/** 碰撞附加间距：标题层挤在同一篇文章周围，需要更宽的缓冲 */
const COLLIDE_PAD: Record<string, number> = {
	category: 4,
	tag: 4,
	post: 4,
	heading: 9,
};

const RADIAL_STRENGTH: Record<string, number> = {
	category: 0.22,
	tag: 0.13,
	post: 0.09,
	heading: 0.08,
};

const active = (node: SceneNode): boolean => node.filtered && node.revealed;

/**
 * 分类扇区力：把节点往所属分类的方位角推。
 * 与 forceRadial 组合出「有机感的日晕图」—— 半径由层级决定、角度由分类决定，
 * 但具体位置仍交给物理，不是刻板的同心圆。
 */
function forceSector(scene: Scene, strength: number) {
	let nodes: SceneNode[] = [];
	const force = (alpha: number): void => {
		const cx = scene.width / 2;
		const cy = scene.height / 2;
		for (const node of nodes) {
			if (!active(node)) continue;
			const target = scene.sectorAngle.get(node.data.categoryId);
			if (target === undefined) continue;
			const dx = (node.x ?? 0) - cx;
			const dy = (node.y ?? 0) - cy;
			const r = Math.hypot(dx, dy) || 1;
			let delta = target - Math.atan2(dy, dx);
			while (delta > Math.PI) delta -= Math.PI * 2;
			while (delta < -Math.PI) delta += Math.PI * 2;
			// 切向加速度，把节点沿圆周扫向目标角
			const k = strength * alpha * delta * r;
			node.vx = (node.vx ?? 0) + (-dy / r) * k;
			node.vy = (node.vy ?? 0) + (dx / r) * k;
		}
	};
	force.initialize = (input: SceneNode[]): void => {
		nodes = input;
	};
	return force;
}

/**
 * 标题扇形力：同一篇文章的小标题围绕文章均分角度排开，像枝叶绕枝展开。
 * 连线弹簧只约束距离不约束角度，不加这个力的话，同篇文章的标题
 * 会无序地绕文章公转、挤成一团；给每个标题分配唯一的目标角后
 * 聚团从根上不可能发生。
 */
function forceHeadingFan(scene: Scene, strength: number) {
	let nodes: SceneNode[] = [];
	const groups: { post: SceneNode; headings: SceneNode[] }[] = [];

	const build = (): void => {
		groups.length = 0;
		const byPost = new Map<SceneNode, SceneNode[]>();
		for (const node of nodes) {
			if (node.tier !== "heading") continue;
			let post: SceneNode | undefined;
			for (const parentId of node.parents) {
				const parent = scene.nodeMap.get(parentId);
				if (parent?.tier === "post") {
					post = parent;
					break;
				}
			}
			if (!post) continue;
			const list = byPost.get(post) ?? [];
			byPost.set(post, list);
			list.push(node);
		}
		for (const [post, headings] of byPost) groups.push({ post, headings });
	};

	const force = (alpha: number): void => {
		const cx = scene.width / 2;
		const cy = scene.height / 2;
		for (const { post, headings } of groups) {
			if (!active(post)) continue;
			// 扇面基准角取「背离画布中心」的方向，让枝叶朝外侧展开
			const baseAngle = Math.atan2((post.y ?? 0) - cy, (post.x ?? 0) - cx);
			let count = 0;
			for (const heading of headings) if (active(heading)) count++;
			if (count === 0) continue;
			let slot = 0;
			for (const heading of headings) {
				if (!active(heading)) continue;
				// 单个标题直接落在径向外侧；多个则绕文章一整圈均分
				const target =
					count === 1 ? baseAngle : baseAngle + (slot / count) * Math.PI * 2;
				slot++;
				const dx = (heading.x ?? 0) - (post.x ?? 0);
				const dy = (heading.y ?? 0) - (post.y ?? 0);
				let delta = target - Math.atan2(dy, dx);
				while (delta > Math.PI) delta -= Math.PI * 2;
				while (delta < -Math.PI) delta += Math.PI * 2;
				// 切向加速度：(-dy, dx)/r 是单位切向量，乘 r 换算成弧长位移
				const k = strength * alpha * delta;
				heading.vx = (heading.vx ?? 0) - dy * k;
				heading.vy = (heading.vy ?? 0) + dx * k;
			}
		}
	};
	force.initialize = (input: SceneNode[]): void => {
		nodes = input;
		build();
	};
	return force;
}

export type GraphSimulation = {
	sim: Simulation<SceneNode, SceneLink>;
	reheat(alpha?: number): void;
	resize(): void;
	/** 拖拽开始：用 alphaTarget 保温，否则 alpha 衰减到阈值后整图冻结，
	    被拖的节点跟着鼠标走但其余节点毫无反应（对齐旧控制器的 0.22） */
	startDrag(): void;
	/** 拖拽结束：撤掉保温目标，让布局自然收敛 */
	endDrag(): void;
	/** 可见集变化后重算连线强度（d3 在 initialize 时缓存，不会每帧重读） */
	refreshLinks(): void;
	destroy(): void;
};

export function createSimulation(scene: Scene): GraphSimulation {
	const radiusFor = (node: SceneNode): number => {
		const R = Math.min(scene.width, scene.height) * 0.42;
		return TIER_RING[node.tier] * R;
	};

	// 不可见边强度归零：节点留在原地不参与布局，但保留坐标
	const linkStrength = (link: SceneLink): number =>
		link.visible ? LINK_STRENGTH[link.kind] : 0;

	const linkForce = forceLink<SceneNode, SceneLink>(scene.links)
		.id((node) => node.data.id)
		.distance((link) => LINK_DISTANCE[link.kind])
		.strength(linkStrength);

	const sim = forceSimulation<SceneNode, SceneLink>(scene.nodes)
		.force("link", linkForce)
		.force(
			"charge",
			forceManyBody<SceneNode>()
				.strength((node) => (active(node) ? CHARGE[node.tier] : 0))
				.distanceMax(420)
				.theta(1.1),
		)
		.force(
			"collide",
			forceCollide<SceneNode>()
				.radius((node) =>
					active(node) ? node.radius + COLLIDE_PAD[node.tier] : 0,
				)
				// 节点数比旧图翻 6 倍，碰撞是最大单项开销，1 次迭代足够
				.iterations(1)
				.strength(0.86),
		)
		.force(
			"radial",
			forceRadial<SceneNode>(
				radiusFor,
				scene.width / 2,
				scene.height / 2,
			).strength((node) => (active(node) ? RADIAL_STRENGTH[node.tier] : 0)),
		)
		.force("sector", forceSector(scene, 0.06))
		.force("headingFan", forceHeadingFan(scene, 0.09))
		.alphaDecay(0.035)
		.velocityDecay(0.42);

	return {
		sim,
		reheat(alpha = 0.25) {
			// 用下限而不是固定值，避免把已收敛的图打回混沌
			sim.alpha(Math.max(sim.alpha(), alpha)).restart();
		},
		resize() {
			const radial = sim.force("radial") as ReturnType<
				typeof forceRadial<SceneNode>
			> | null;
			radial
				?.x(scene.width / 2)
				.y(scene.height / 2)
				.radius(radiusFor);
			sim.alpha(Math.max(sim.alpha(), 0.2)).restart();
		},
		startDrag() {
			sim.alphaTarget(0.22).restart();
		},
		endDrag() {
			sim.alphaTarget(0);
		},
		refreshLinks() {
			// 重新赋同一个 accessor 即可触发 d3 内部的 initializeStrength()
			linkForce.strength(linkStrength);
		},
		destroy() {
			sim.stop();
		},
	};
}
