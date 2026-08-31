import type { Point } from "./geometry";
import type { Scene } from "./scene";
import type { GraphTier, KGLinkKind, SceneNode } from "./types";

/** 脑图布局：分类 → 标签 → 文章 → 标题 四列从左到右排列。
 *  列内按层级归属分带：标签 / 文章落在其分类的纵向带宽内均分，
 *  标题围绕所属文章紧凑堆叠 —— 形成真·脑图的树状分支观感。
 *  布局是确定性的纯函数：同一次会话里切筛选后重排结果稳定。 */

/** 各层横坐标（相对画布宽度的比例） */
const TIER_X: Record<GraphTier, number> = {
	category: 0.12,
	tag: 0.38,
	post: 0.64,
	heading: 0.9,
};

/** 标题在文章旁的堆叠间距 */
const HEADING_GAP = 16;
/** 上下留白 */
const PAD = 56;

export function computeMindmapLayout(scene: Scene): Map<string, Point> {
	const pos = new Map<string, Point>();
	const w = scene.width;
	const h = scene.height;
	const innerTop = PAD;
	const innerH = Math.max(1, h - PAD * 2);
	const visible = (nodes: SceneNode[]): SceneNode[] =>
		nodes.filter((node) => node.filtered);

	// ── 分类列：纵向均分 ──
	const categories = visible(scene.byTier.category);
	const categoryIndex = new Map(
		categories.map((node, index) => [node.data.id, index]),
	);
	const bandHeight = innerH / Math.max(1, categories.length);
	categories.forEach((node, index) => {
		pos.set(node.data.id, {
			x: w * TIER_X.category,
			y: innerTop + (index + 0.5) * bandHeight,
		});
	});

	// ── 标签 / 文章列：在所属分类的带宽内均分 ──
	for (const tier of ["tag", "post"] as const) {
		const groups = new Map<string, SceneNode[]>();
		for (const node of visible(scene.byTier[tier])) {
			const list = groups.get(node.data.categoryId) ?? [];
			list.push(node);
			groups.set(node.data.categoryId, list);
		}
		for (const [categoryId, list] of groups) {
			const index = categoryIndex.get(categoryId);
			// 找不到归属分类（被筛掉）时退回整列均分，不挤在一个点上
			const top =
				index === undefined
					? innerTop
					: innerTop + index * bandHeight + bandHeight * 0.12;
			const height = index === undefined ? innerH : bandHeight * 0.76;
			list.forEach((node, j) => {
				pos.set(node.data.id, {
					x: w * TIER_X[tier],
					y: top + ((j + 0.5) / list.length) * height,
				});
			});
		}
	}

	// ── 标题列：围绕所属文章垂直堆叠 ──
	const postById = new Map<string, SceneNode>();
	for (const post of visible(scene.byTier.post)) {
		if (post.data.postId) postById.set(post.data.postId, post);
	}
	const headingsByPost = new Map<string, SceneNode[]>();
	for (const heading of visible(scene.byTier.heading)) {
		const postId = heading.data.postId;
		if (!postId) continue;
		const list = headingsByPost.get(postId) ?? [];
		list.push(heading);
		headingsByPost.set(postId, list);
	}
	for (const [postId, list] of headingsByPost) {
		const post = postById.get(postId);
		const cy = post ? (pos.get(post.data.id)?.y ?? h / 2) : h / 2;
		list.forEach((heading, j) => {
			pos.set(heading.data.id, {
				x: w * TIER_X.heading,
				y: cy + (j - (list.length - 1) / 2) * HEADING_GAP,
			});
		});
	}

	return pos;
}

/** 连线从左到右分三波描绘：分类-标签 → 标签-文章 → 文章-标题 */
const LINK_STAGE: Record<KGLinkKind, number> = {
	"category-tag": 0,
	"category-post": 0,
	"tag-post": 1,
	"tag-tag": 1,
	"post-heading": 2,
};

export const MINDMAP_LINE_PHASES = 3;

/** 播放头（0..1）映射到单条边的生长进度：先到先画，波内同速 */
export function mindmapLinkGrow(progress: number, kind: KGLinkKind): number {
	const p = progress * MINDMAP_LINE_PHASES - LINK_STAGE[kind];
	return p <= 0 ? 0 : p >= 1 ? 1 : p;
}
