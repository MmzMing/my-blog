/**
 * 知识图谱数据构建器 —— 纯函数，不依赖 Astro 运行时。
 *
 * 四层层级：分类 → 标签 → 文章 → 文章内 H2 小标题。
 *
 * 标题的 slug 必须由调用方从 `render(entry)` 的 `headings` 传入，而不是在这里
 * 用 github-slugger 复算 —— rehype-slug 的去重后缀（`-1`/`-2`）、标题里的
 * inline code 与 KaTeX 都会让复算结果漂移，那会静默产出跳不到位置的 404 锚点。
 *
 * 与 `content-utils.ts` 的分层关系沿用 `buildTagGraphData` ← `getTagGraphData()`
 * 的既有约定：这里只做纯计算，Astro 侧负责取数据和拼 URL。
 */

export type GraphTier = "category" | "tag" | "post" | "heading";

export type KGLinkKind =
	| "category-tag"
	| "tag-post"
	| "post-heading"
	| "category-post"
	| "tag-tag";

export type KGInputHeading = {
	depth: number;
	slug: string;
	text: string;
};

export type KGInputPost = {
	/** content collection 的 id，用作文章节点 id 的后缀 */
	id: string;
	title: string;
	url: string;
	published: Date | string;
	/** 原始分类名；空值由构建器折叠为「未分类」 */
	category: string | null | undefined;
	tags: string[];
	headings: KGInputHeading[];
};

export type KGNode = {
	id: string;
	tier: GraphTier;
	name: string;
	url: string;
	/** 0-7 → --tag-graph-node-{n+1}；-1 = 未分类，渲染时走 muted */
	colorIndex: number;
	/** 归属分类节点 id，筛选与配色都以它为准 */
	categoryId: string;
	/** 半径映射权重：分类/标签 = 文章数，文章 = H2 数，标题 = 1 */
	value: number;
	/** 回放用毫秒时间戳；分类/标签取其下最早文章 */
	publishedAt: number;
	/** heading 专用，当前恒为 2；保留字段以便将来放开 H3 */
	depth?: number;
	/** heading/post 专用，指向所属文章的 collection id */
	postId?: string;
};

export type KGLink = {
	source: string;
	target: string;
	kind: KGLinkKind;
	/** 共现/归属次数；层级边恒为 1 */
	value: number;
};

export type KGCategoryMeta = {
	id: string;
	name: string;
	url: string;
	colorIndex: number;
	postCount: number;
	tagCount: number;
};

/**
 * 极小的元信息对象，会被内联进 HTML（约 400 字节），
 * 让筛选面板的分类图例与时间轴范围在首帧就能服务端渲染，
 * 不必等 /api/knowledge-graph.json 返回。
 */
export type KGMeta = {
	version: 1;
	categories: KGCategoryMeta[];
	counts: Record<GraphTier, number>;
	timeRange: { from: number; to: number };
	/** 构建期采纳的标题深度上限，当前为 2 */
	headingDepth: number;
};

export type KGData = {
	nodes: KGNode[];
	links: KGLink[];
	meta: KGMeta;
};

export type BuildKnowledgeGraphOptions = {
	/** 未分类的显示名，由调用方从 i18n 传入，保持纯函数无 i18n 依赖 */
	uncategorizedName: string;
	/** 分类归档页 URL 生成器 */
	categoryUrl: (name: string) => string;
	/** 标签归档页 URL 生成器 */
	tagUrl: (name: string) => string;
	/** 站点起始日期，作为时间轴下界 */
	siteStartDate?: Date | string;
	/** 采纳的标题深度，默认只取 H2 */
	headingDepth?: number;
	/** 是否生成标签共现边（默认生成，客户端默认不喂给 forceLink） */
	includeTagCooccurrence?: boolean;
};

/* ========== 内部工具 ========== */

/** id 带层前缀，避免同名碰撞（标签「设计」与分类「设计文档」） */
const PREFIX: Record<GraphTier, string> = {
	category: "c:",
	tag: "t:",
	post: "p:",
	heading: "h:",
};

function toTimestamp(value: Date | string): number {
	return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

/** 去空白、去重、排序，与 tag-graph-data.ts 的同名函数保持一致的语义 */
function normalizeTags(tags: string[] | undefined): string[] {
	const seen = new Set<string>();
	for (const tag of tags ?? []) {
		const name = tag.trim();
		if (name) seen.add(name);
	}
	return [...seen].sort();
}

function categoryNodeId(name: string): string {
	return `${PREFIX.category}${name}`;
}

function tagNodeId(name: string): string {
	return `${PREFIX.tag}${name}`;
}

function postNodeId(id: string): string {
	return `${PREFIX.post}${id}`;
}

function headingNodeId(id: string, slug: string): string {
	return `${PREFIX.heading}${id}#${slug}`;
}

type NormalizedPost = {
	source: KGInputPost;
	category: string;
	tags: string[];
	publishedAt: number;
	headings: KGInputHeading[];
};

/* ========== 主构建器 ========== */

export function buildKnowledgeGraphData(
	posts: KGInputPost[],
	options: BuildKnowledgeGraphOptions,
): KGData {
	const {
		uncategorizedName,
		categoryUrl,
		tagUrl,
		siteStartDate,
		headingDepth = 2,
		includeTagCooccurrence = true,
	} = options;

	// ── 1. 归一化 ──
	const normalized: NormalizedPost[] = posts.map((post) => ({
		source: post,
		category: post.category?.trim() || uncategorizedName,
		tags: normalizeTags(post.tags),
		publishedAt: toTimestamp(post.published),
		// 默认只收 H2；跳过 H1 与拿不到 slug 的异常项
		headings: (post.headings ?? []).filter(
			(heading) =>
				heading.depth >= 2 && heading.depth <= headingDepth && !!heading.slug,
		),
	}));

	// ── 2. 分类统计与色号 ──
	// 排序规则与 getCategoryList() 一致：文章数降序 → 名称升序，索引即色号
	const categoryStats = new Map<
		string,
		{ postCount: number; tags: Set<string>; earliest: number }
	>();
	for (const post of normalized) {
		const stat = categoryStats.get(post.category) ?? {
			postCount: 0,
			tags: new Set<string>(),
			earliest: Number.POSITIVE_INFINITY,
		};
		stat.postCount++;
		stat.earliest = Math.min(stat.earliest, post.publishedAt);
		for (const tag of post.tags) stat.tags.add(tag);
		categoryStats.set(post.category, stat);
	}

	const categoryOrder = [...categoryStats.entries()]
		.sort(
			(a, b) =>
				b[1].postCount - a[1].postCount ||
				a[0].toLowerCase().localeCompare(b[0].toLowerCase()),
		)
		.map(([name]) => name);

	// 未分类固定 -1 走 muted，不占调色板槽位
	const colorIndexOf = new Map<string, number>();
	let nextColor = 0;
	for (const name of categoryOrder) {
		colorIndexOf.set(name, name === uncategorizedName ? -1 : nextColor++);
	}

	// ── 3. 标签统计 ──
	const tagStats = new Map<
		string,
		{ postCount: number; earliest: number; perCategory: Map<string, number> }
	>();
	for (const post of normalized) {
		for (const tag of post.tags) {
			const stat = tagStats.get(tag) ?? {
				postCount: 0,
				earliest: Number.POSITIVE_INFINITY,
				perCategory: new Map<string, number>(),
			};
			stat.postCount++;
			stat.earliest = Math.min(stat.earliest, post.publishedAt);
			stat.perCategory.set(
				post.category,
				(stat.perCategory.get(post.category) ?? 0) + 1,
			);
			tagStats.set(tag, stat);
		}
	}

	/**
	 * 跨分类标签取「主分类」= 该标签下文章最多的分类。
	 * 按 categoryOrder 顺序遍历，并列时天然落到更大/更靠前的分类，结果确定。
	 */
	const dominantCategory = (perCategory: Map<string, number>): string => {
		let best = uncategorizedName;
		let bestCount = -1;
		for (const name of categoryOrder) {
			const count = perCategory.get(name);
			if (count !== undefined && count > bestCount) {
				best = name;
				bestCount = count;
			}
		}
		return best;
	};

	// ── 4. 建节点 ──
	const nodes: KGNode[] = [];

	for (const name of categoryOrder) {
		const stat = categoryStats.get(name);
		if (!stat) continue;
		nodes.push({
			id: categoryNodeId(name),
			tier: "category",
			name,
			url: categoryUrl(name),
			colorIndex: colorIndexOf.get(name) ?? -1,
			categoryId: categoryNodeId(name),
			value: stat.postCount,
			publishedAt: stat.earliest,
		});
	}

	// 标签按文章数降序 → 名称升序，保证输出稳定
	const tagOrder = [...tagStats.keys()].sort(
		(a, b) =>
			(tagStats.get(b)?.postCount ?? 0) - (tagStats.get(a)?.postCount ?? 0) ||
			a.toLowerCase().localeCompare(b.toLowerCase()),
	);

	for (const name of tagOrder) {
		const stat = tagStats.get(name);
		if (!stat) continue;
		const owner = dominantCategory(stat.perCategory);
		nodes.push({
			id: tagNodeId(name),
			tier: "tag",
			name,
			url: tagUrl(name),
			colorIndex: colorIndexOf.get(owner) ?? -1,
			categoryId: categoryNodeId(owner),
			value: stat.postCount,
			publishedAt: stat.earliest,
		});
	}

	// 文章按发布时间降序 → id 升序，与 getSortedPosts 的观感一致（此处不理置顶）
	const postOrder = [...normalized].sort(
		(a, b) =>
			b.publishedAt - a.publishedAt || a.source.id.localeCompare(b.source.id),
	);

	for (const post of postOrder) {
		const colorIndex = colorIndexOf.get(post.category) ?? -1;
		const ownerId = categoryNodeId(post.category);
		nodes.push({
			id: postNodeId(post.source.id),
			tier: "post",
			name: post.source.title,
			url: post.source.url,
			colorIndex,
			categoryId: ownerId,
			value: post.headings.length,
			publishedAt: post.publishedAt,
			postId: post.source.id,
		});

		// rehype-slug 已做过去重，这里再兜一层，避免同 id 节点覆盖
		const seenSlugs = new Set<string>();
		for (const heading of post.headings) {
			if (seenSlugs.has(heading.slug)) continue;
			seenSlugs.add(heading.slug);
			nodes.push({
				id: headingNodeId(post.source.id, heading.slug),
				tier: "heading",
				name: heading.text,
				url: `${post.source.url}#${heading.slug}`,
				colorIndex,
				categoryId: ownerId,
				value: 1,
				publishedAt: post.publishedAt,
				depth: heading.depth,
				postId: post.source.id,
			});
		}
	}

	// ── 5. 建边 ──
	const links: KGLink[] = [];

	// 分类 → 标签：value = 该分类下含此标签的文章数
	for (const name of tagOrder) {
		const stat = tagStats.get(name);
		if (!stat) continue;
		for (const [category, count] of stat.perCategory) {
			links.push({
				source: categoryNodeId(category),
				target: tagNodeId(name),
				kind: "category-tag",
				value: count,
			});
		}
	}

	for (const post of postOrder) {
		const selfId = postNodeId(post.source.id);

		// 标签 → 文章
		for (const tag of post.tags) {
			links.push({
				source: tagNodeId(tag),
				target: selfId,
				kind: "tag-post",
				value: 1,
			});
		}

		// 无标签文章会从「分类→标签→文章」链路掉出去，补一条直连边兜底。
		// 当前 20 篇文章都有标签，这条是给将来兜的。
		if (post.tags.length === 0) {
			links.push({
				source: categoryNodeId(post.category),
				target: selfId,
				kind: "category-post",
				value: 1,
			});
		}

		// 文章 → 标题
		const linkedSlugs = new Set<string>();
		for (const heading of post.headings) {
			if (linkedSlugs.has(heading.slug)) continue;
			linkedSlugs.add(heading.slug);
			links.push({
				source: selfId,
				target: headingNodeId(post.source.id, heading.slug),
				kind: "post-heading",
				value: 1,
			});
		}
	}

	// 标签共现：沿用 buildTagGraphData:92-101 的成对计数。
	// 数据里始终生成，客户端默认不喂给 forceLink（面板可开）。
	if (includeTagCooccurrence) {
		const pairs = new Map<string, number>();
		for (const post of normalized) {
			const { tags } = post;
			for (let i = 0; i < tags.length; i++) {
				for (let j = i + 1; j < tags.length; j++) {
					const key = `${tags[i]} ${tags[j]}`;
					pairs.set(key, (pairs.get(key) ?? 0) + 1);
				}
			}
		}

		const cooccurrence = [...pairs.entries()]
			.map(([key, value]) => {
				const [source, target] = key.split(" ");
				return { source, target, value };
			})
			.sort(
				(a, b) =>
					b.value - a.value ||
					a.source.localeCompare(b.source) ||
					a.target.localeCompare(b.target),
			);

		for (const pair of cooccurrence) {
			links.push({
				source: tagNodeId(pair.source),
				target: tagNodeId(pair.target),
				kind: "tag-tag",
				value: pair.value,
			});
		}
	}

	// ── 6. 时间范围与元信息 ──
	const stamps = normalized
		.map((post) => post.publishedAt)
		.filter((value) => Number.isFinite(value));
	const now = Date.now();
	const earliest = stamps.length > 0 ? Math.min(...stamps) : now;
	const latest = stamps.length > 0 ? Math.max(...stamps) : now;
	const siteStart = siteStartDate ? toTimestamp(siteStartDate) : Number.NaN;
	const from = Number.isFinite(siteStart)
		? Math.min(siteStart, earliest)
		: earliest;

	const counts: Record<GraphTier, number> = {
		category: 0,
		tag: 0,
		post: 0,
		heading: 0,
	};
	for (const node of nodes) counts[node.tier]++;

	const categories: KGCategoryMeta[] = categoryOrder.map((name) => {
		const stat = categoryStats.get(name);
		return {
			id: categoryNodeId(name),
			name,
			url: categoryUrl(name),
			colorIndex: colorIndexOf.get(name) ?? -1,
			postCount: stat?.postCount ?? 0,
			tagCount: stat?.tags.size ?? 0,
		};
	});

	return {
		nodes,
		links,
		meta: {
			version: 1,
			categories,
			counts,
			timeRange: { from, to: latest },
			headingDepth,
		},
	};
}
