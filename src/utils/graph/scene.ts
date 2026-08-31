import type { KGData, KGNode } from "@/utils/knowledge-graph-data";
import { GOLDEN_ANGLE, getCssVariable } from "./geometry";
import type {
	FilterState,
	GraphTier,
	SceneLink,
	SceneNode,
	ThemeColors,
} from "./types";

/** 层级 → 基础半径。用户确认的规格：18 / 13 / 9 / 5 */
const TIER_RADIUS: Record<GraphTier, number> = {
	category: 18,
	tag: 13,
	post: 9,
	heading: 5,
};

/** 层级 → 基础不透明度：1.0 / .85 / .7 / .55 */
export const TIER_ALPHA: Record<GraphTier, number> = {
	category: 1,
	tag: 0.85,
	post: 0.7,
	heading: 0.55,
};

/** 层级径向半径系数（× R），分类在内、标题在外 */
export const TIER_RING: Record<GraphTier, number> = {
	category: 0.1,
	tag: 0.34,
	post: 0.6,
	heading: 0.92,
};

const TIER_DEPTH: Record<GraphTier, number> = {
	category: 0,
	tag: 1,
	post: 2,
	heading: 3,
};

/** 唯一可变状态源：其他模块拿引用直接改标记，靠 dirty flag 触发重绘 */
export type Scene = {
	nodes: SceneNode[];
	links: SceneLink[];
	nodeMap: Map<string, SceneNode>;
	byTier: Record<GraphTier, SceneNode[]>;
	categoryIds: string[];
	maxLinkValue: number;
	/** 各分类的扇区角度，按 meta.categories 顺序 */
	sectorAngle: Map<string, number>;
	/* ── 运行时可变 ── */
	width: number;
	height: number;
	hovered: SceneNode | null;
	selected: SceneNode | null;
};

/** 半径带上文章数权重，让热门标签/大分类更醒目 */
function radiusOf(node: KGNode): number {
	const base = TIER_RADIUS[node.tier];
	if (node.tier === "category") return base - 2 + Math.sqrt(node.value) * 1.4;
	if (node.tier === "tag") return base - 3 + Math.sqrt(node.value) * 1.6;
	return base;
}

export function buildScene(data: KGData): Scene {
	const nodes: SceneNode[] = data.nodes.map((node) => ({
		data: node,
		tier: node.tier,
		radius: radiusOf(node),
		neighbors: new Set<string>(),
		parents: new Set<string>(),
		children: new Set<string>(),
		degree: 0,
		filtered: true,
		matched: false,
		revealed: true,
		reveal: 1,
		selected: false,
		focusDistance: -1,
	}));

	const nodeMap = new Map(nodes.map((node) => [node.data.id, node]));

	const links: SceneLink[] = data.links
		.filter((link) => nodeMap.has(link.source) && nodeMap.has(link.target))
		.map((link, index) => ({
			source: link.source,
			target: link.target,
			kind: link.kind,
			value: link.value,
			index,
			visible: true,
		}));

	// 邻接表：parents/children 按层级深度定向，级联筛选靠它
	for (const link of links) {
		const source = nodeMap.get(link.source as string);
		const target = nodeMap.get(link.target as string);
		if (!source || !target) continue;
		source.neighbors.add(target.data.id);
		target.neighbors.add(source.data.id);
		source.degree += link.value;
		target.degree += link.value;

		const sd = TIER_DEPTH[source.tier];
		const td = TIER_DEPTH[target.tier];
		if (sd < td) {
			target.parents.add(source.data.id);
			source.children.add(target.data.id);
		} else if (td < sd) {
			source.parents.add(target.data.id);
			target.children.add(source.data.id);
		}
	}

	const byTier: Record<GraphTier, SceneNode[]> = {
		category: [],
		tag: [],
		post: [],
		heading: [],
	};
	for (const node of nodes) byTier[node.tier].push(node);
	for (const tier of Object.keys(byTier) as GraphTier[]) {
		byTier[tier].sort((a, b) => b.data.value - a.data.value);
	}

	const categoryIds = data.meta.categories.map((category) => category.id);
	const sectorAngle = new Map<string, number>();
	const count = Math.max(1, categoryIds.length);
	categoryIds.forEach((id, index) => {
		sectorAngle.set(id, -Math.PI / 2 + (index / count) * Math.PI * 2);
	});

	return {
		nodes,
		links,
		nodeMap,
		byTier,
		categoryIds,
		maxLinkValue: Math.max(1, ...links.map((link) => link.value)),
		sectorAngle,
		width: 1,
		height: 1,
		hovered: null,
		selected: null,
	};
}

/** 极坐标播种：层级定半径、分类定角度。比纯螺旋收敛快得多 */
export function seedPositions(
	scene: Scene,
	width: number,
	height: number,
): void {
	const R = Math.min(width, height) * 0.42;
	const cx = width / 2;
	const cy = height / 2;
	const perTierIndex = new Map<string, number>();

	for (const node of scene.nodes) {
		const key = `${node.tier}:${node.data.categoryId}`;
		const seq = perTierIndex.get(key) ?? 0;
		perTierIndex.set(key, seq + 1);

		const sector = scene.sectorAngle.get(node.data.categoryId) ?? 0;
		// 同扇区内用黄金角散开，避免同半径上完全重合
		const spread = ((seq * GOLDEN_ANGLE) % (Math.PI / 2.4)) - Math.PI / 4.8;
		const angle = sector + spread;
		const ring = TIER_RING[node.tier] * R;
		node.x = cx + Math.cos(angle) * ring;
		node.y = cy + Math.sin(angle) * ring;
	}

	// 标题层改围绕所属文章扇形播种：上面的通用播种把它们放在外圈环上，
	// 连线力又拉回文章身边，同一篇文章的标题会挤在同一点重叠
	const postByCollectionId = new Map<string, SceneNode>();
	for (const post of scene.byTier.post) {
		if (post.data.postId) postByCollectionId.set(post.data.postId, post);
	}
	const perPostSeq = new Map<string, number>();
	for (const heading of scene.byTier.heading) {
		const postId = heading.data.postId;
		const post = postId ? postByCollectionId.get(postId) : undefined;
		if (!postId || !post) continue;
		const seq = perPostSeq.get(postId) ?? 0;
		perPostSeq.set(postId, seq + 1);
		const angle = seq * GOLDEN_ANGLE;
		const distance = 40 + (seq % 5) * 11;
		heading.x = (post.x ?? 0) + Math.cos(angle) * distance;
		heading.y = (post.y ?? 0) + Math.sin(angle) * distance;
	}
}

export function readTheme(surface: HTMLElement): ThemeColors {
	const style = getComputedStyle(surface);
	const text = getCssVariable(style, "--tag-graph-text");
	const nodes = Array.from({ length: 8 }, (_, index) =>
		getCssVariable(style, `--tag-graph-node-${index + 1}`),
	).filter(Boolean);
	return {
		// 画布底直接用站点默认黑白背景，与页面融为一体
		surface: getCssVariable(style, "--page-bg"),
		text,
		muted: getCssVariable(style, "--tag-graph-muted") || text,
		nodes: nodes.length > 0 ? nodes : [text],
	};
}

export function nodeColor(node: SceneNode, theme: ThemeColors): string {
	const index = node.data.colorIndex;
	if (index < 0) return theme.muted;
	return theme.nodes[index % theme.nodes.length] ?? theme.text;
}

export function defaultFilters(scene: Scene): FilterState {
	return {
		tiers: { category: true, tag: true, post: true, heading: false },
		categories: new Set(scene.categoryIds),
		query: "",
		minPosts: 1,
		showCooccurrence: false,
		particles: true,
	};
}

/**
 * 计算 filtered 标记。
 *
 * 级联规则：节点通过 = 自身条件通过 && 至少一个上层 parent 通过。
 * 没有这条，关掉「文章」层会留下 179 个孤立标题节点变成噪点。
 * 自顶向下一次 BFS，243 节点开销可忽略。
 */
export function applyFilters(scene: Scene, state: FilterState): void {
	const query = state.query.trim().toLowerCase();
	const order: GraphTier[] = ["category", "tag", "post", "heading"];

	for (const tier of order) {
		for (const node of scene.byTier[tier]) {
			let pass = state.tiers[tier];

			if (pass && state.categories.size > 0) {
				pass = state.categories.has(node.data.categoryId);
			}
			// 最少文章数只约束有「文章数」语义的两层
			if (pass && (tier === "category" || tier === "tag")) {
				pass = node.data.value >= state.minPosts;
			}
			if (pass && tier !== "category") {
				let hasParent = false;
				for (const parentId of node.parents) {
					const parent = scene.nodeMap.get(parentId);
					if (parent?.filtered) {
						hasParent = true;
						break;
					}
				}
				// 上层整层被关掉时不连坐（否则关掉标签层会连带清空文章层）
				const parentTierOn = order
					.slice(0, TIER_DEPTH[tier])
					.some((upper) => state.tiers[upper]);
				pass = node.parents.size === 0 || hasParent || !parentTierOn;
			}

			node.filtered = pass;
			node.matched =
				query.length > 0 && node.data.name.toLowerCase().includes(query);
		}
	}

	for (const link of scene.links) {
		// forceLink 初始化会把 source/target 就地替换成节点对象，
		// 两种形态都要能解析，否则二次筛选时查无节点、所有边被判为不可见
		const source =
			typeof link.source === "string"
				? scene.nodeMap.get(link.source)
				: link.source;
		const target =
			typeof link.target === "string"
				? scene.nodeMap.get(link.target)
				: link.target;
		const kindOn = link.kind === "tag-tag" ? state.showCooccurrence : true;
		link.visible = Boolean(kindOn && source?.filtered && target?.filtered);
	}
}
