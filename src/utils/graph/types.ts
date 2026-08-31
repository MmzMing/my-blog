import type { SimulationLinkDatum, SimulationNodeDatum } from "d3";
import type {
	GraphTier,
	KGLinkKind,
	KGMeta,
	KGNode,
} from "@/utils/knowledge-graph-data";

export type { GraphTier, KGLinkKind, KGMeta };

export interface SceneNode extends SimulationNodeDatum {
	readonly data: KGNode;
	readonly tier: GraphTier;
	radius: number;
	/** 全部邻接（无向） */
	neighbors: Set<string>;
	/** 上层邻接，级联筛选用 */
	parents: Set<string>;
	children: Set<string>;
	degree: number;
	/** 通过筛选（面板写） */
	filtered: boolean;
	/** 命中搜索关键词 */
	matched: boolean;
	/** 回放已揭示（playback 写） */
	revealed: boolean;
	/** 0..1 揭示进度，纯游标时间函数，可双向擦洗 */
	reveal: number;
	selected: boolean;
	/** -1 = 不在聚焦子图内；0 = 选中节点；1.. = 跳数 */
	focusDistance: number;
	x?: number;
	y?: number;
	vx?: number;
	vy?: number;
	fx?: number | null;
	fy?: number | null;
	index?: number;
}

export interface SceneLink extends SimulationLinkDatum<SceneNode> {
	readonly kind: KGLinkKind;
	readonly value: number;
	index: number;
	source: string | SceneNode;
	target: string | SceneNode;
	visible: boolean;
}

export type ThemeColors = {
	surface: string;
	text: string;
	muted: string;
	nodes: string[];
};

export type FilterState = {
	tiers: Record<GraphTier, boolean>;
	/** 选中的分类节点 id；空集视为全选 */
	categories: Set<string>;
	query: string;
	minPosts: number;
	showCooccurrence: boolean;
	particles: boolean;
};

export type PlaybackState = {
	playing: boolean;
	/** 归一化播放头 0..1 */
	position: number;
};

export type GraphStrings = {
	loaded: string;
	failed: string;
	tier: Record<GraphTier, string>;
	posts: string;
	sections: string;
	relations: string;
};

/** 详情面板的一组关联节点：同层列表，顺序按 byTier 的既定排序 */
export type KGSelectionGroup = {
	tier: GraphTier;
	items: KGNode[];
};

/** kg:select 事件载荷：选中节点 + 按层级分组的下钻信息 */
export type KGSelection = {
	node: KGNode;
	groups: KGSelectionGroup[];
};

export interface GraphController {
	destroy(): void;
	patchFilters(patch: Partial<FilterState>): void;
	getFilters(): FilterState;
	playback: {
		toggle(): void;
		restart(): void;
		getState(): PlaybackState;
	};
	resetView(): void;
	/** 选中节点（传 id）；传 null 取消选中 */
	select(id: string | null): void;
}
