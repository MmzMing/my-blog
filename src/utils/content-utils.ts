import { type CollectionEntry, getCollection, render } from "astro:content";
import I18nKey from "@i18n/i18nKey";
import { i18n } from "@i18n/translation";
import {
	buildKnowledgeGraphData,
	type KGData,
} from "@utils/knowledge-graph-data";
import {
	getCategoryUrl,
	getPostUrlBySlug,
	getTagArchiveUrl,
	getTagUrl,
} from "@utils/url-utils";
import type { MarkdownHeading } from "astro";
import { siteConfig } from "@/config";

let cachedPosts: CollectionEntry<"posts">[] | null = null;
let cachedHeadings: Map<string, MarkdownHeading[]> | null = null;

async function getAllPosts(): Promise<CollectionEntry<"posts">[]> {
	if (cachedPosts) return cachedPosts;
	cachedPosts = await getCollection("posts", ({ data }) => {
		return import.meta.env.PROD ? data.draft !== true : true;
	});
	return cachedPosts;
}

async function getRawSortedPosts(): Promise<CollectionEntry<"posts">[]> {
	const allBlogPosts = await getAllPosts();

	const sorted = allBlogPosts.sort((a, b) => {
		// 首先按置顶状态排序，置顶文章在前
		if (a.data.pinned && !b.data.pinned) return -1;
		if (!a.data.pinned && b.data.pinned) return 1;

		// 如果置顶状态相同，则按发布日期排序
		const dateA = new Date(a.data.published);
		const dateB = new Date(b.data.published);
		return dateA > dateB ? -1 : 1;
	});
	return sorted;
}

export async function getSortedPosts(): Promise<CollectionEntry<"posts">[]> {
	const sorted = await getRawSortedPosts();

	for (let i = 1; i < sorted.length; i++) {
		sorted[i].data.nextSlug = sorted[i - 1].id;
		sorted[i].data.nextTitle = sorted[i - 1].data.title;
	}
	for (let i = 0; i < sorted.length - 1; i++) {
		sorted[i].data.prevSlug = sorted[i + 1].id;
		sorted[i].data.prevTitle = sorted[i + 1].data.title;
	}

	return sorted;
}

export type PostForList = {
	id: string;
	data: CollectionEntry<"posts">["data"];
};

export async function getSortedPostsList(): Promise<PostForList[]> {
	const sortedFullPosts = await getRawSortedPosts();

	// delete post.body
	const sortedPostsList = sortedFullPosts.map((post) => ({
		id: post.id,
		data: post.data,
	}));

	return sortedPostsList;
}

export type Tag = {
	name: string;
	count: number;
	/** 该标签的落地地址：够篇数的走标签枢纽页，碎片化标签退回归档页过滤 */
	url: string;
};

/**
 * 标签枢纽页的最低篇数门槛。
 *
 * 本站 26 篇文章却有 59 个标签，其中约 45 个只挂着 1 篇文章。给它们全部建页会产出一批
 * 「只有 1 张卡片」的薄页面（与那篇文章自身的列表项高度重复），稀释抓取配额、拉低
 * 站点质量信号。低于门槛的标签不建页，链接退回归档页过滤。
 * 页面路由（src/pages/tags/[tag].astro）与链接生成必须共用本常量。
 */
export const MIN_TAG_HUB_POSTS = 2;

/** 按篇数决定标签该指向枢纽页还是归档页 */
export function resolveTagLink(tag: string, count: number): string {
	return count >= MIN_TAG_HUB_POSTS ? getTagUrl(tag) : getTagArchiveUrl(tag);
}

export async function getTagList(): Promise<Tag[]> {
	const allBlogPosts = await getAllPosts();

	const countMap: { [key: string]: number } = {};
	allBlogPosts.forEach((post) => {
		// 同一篇文章里重复写同一个标签只算一次，否则计数虚高会误开枢纽页
		const uniqueTags = new Set(
			post.data.tags.map((tag) => tag.trim()).filter(Boolean),
		);
		uniqueTags.forEach((tag) => {
			if (!countMap[tag]) countMap[tag] = 0;
			countMap[tag]++;
		});
	});

	// sort tags by count descending
	const keys: string[] = Object.keys(countMap).sort((a, b) => {
		return countMap[b] - countMap[a];
	});

	return keys.map((key) => ({
		name: key,
		count: countMap[key],
		url: resolveTagLink(key, countMap[key]),
	}));
}

/** 有独立枢纽页的标签（篇数达到门槛），按篇数倒序 */
export async function getTagHubList(): Promise<Tag[]> {
	const tags = await getTagList();
	return tags.filter((tag) => tag.count >= MIN_TAG_HUB_POSTS);
}

/** 取某个标签下的文章，按发布时间倒序（草稿已排除） */
export async function getPostsByTag(
	tag: string,
): Promise<CollectionEntry<"posts">[]> {
	const target = tag.trim();
	const allPosts = await getAllPosts();
	return allPosts
		.filter((post) => post.data.tags.some((item) => item.trim() === target))
		.sort((a, b) =>
			a.data.published > b.data.published
				? -1
				: a.data.published < b.data.published
					? 1
					: 0,
		);
}

/** 取某个分类下的文章，按发布时间倒序（草稿已排除） */
export async function getPostsByCategory(
	category: string,
): Promise<CollectionEntry<"posts">[]> {
	const target = category.trim();
	const allPosts = await getAllPosts();
	return allPosts
		.filter((post) => (post.data.category ?? "").trim() === target)
		.sort((a, b) =>
			a.data.published > b.data.published
				? -1
				: a.data.published < b.data.published
					? 1
					: 0,
		);
}

/**
 * 标签共现表：tag → 与之同现次数最多的其他标签。
 * 标签枢纽页用它做横向互链，把同主题的枢纽串起来（顺带解决枢纽页之间的孤岛问题）。
 */
export async function getRelatedTagMap(limit = 8): Promise<Map<string, Tag[]>> {
	const allPosts = await getAllPosts();
	const tagList = await getTagList();
	const hubList = tagList.filter((tag) => tag.count >= MIN_TAG_HUB_POSTS);
	const hubByName = new Map(hubList.map((tag) => [tag.name, tag]));
	const cooccur = new Map<string, Map<string, number>>();

	for (const post of allPosts) {
		const tags = [...new Set(post.data.tags.map((tag) => tag.trim()))].filter(
			(tag) => hubByName.has(tag),
		);
		for (const current of tags) {
			const bucket = cooccur.get(current) ?? new Map<string, number>();
			for (const other of tags) {
				if (other === current) continue;
				bucket.set(other, (bucket.get(other) ?? 0) + 1);
			}
			cooccur.set(current, bucket);
		}
	}

	const result = new Map<string, Tag[]>();
	for (const tag of hubList) {
		const bucket = cooccur.get(tag.name) ?? new Map<string, number>();
		const related = [...bucket.entries()]
			.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
			.slice(0, limit)
			.map(([name]) => hubByName.get(name))
			.filter((item): item is Tag => Boolean(item));
		result.set(tag.name, related);
	}
	return result;
}

/**
 * 提取全部文章的标题，按 collection id 索引。
 *
 * 必须走 `render(entry)` 而不是正则扫 `entry.body`：slug 由 rehype-slug 在同一条
 * rehype 链上生成，只有这样锚点才和文章页 DOM 里的 id 逐字一致。自己用
 * github-slugger 复算会在去重后缀（`-1`/`-2`）、标题内 inline code、KaTeX 上漂移，
 * 产出跳不到位置的深链。
 *
 * 串行而非 Promise.all —— render 会跑完整 markdown 链（KaTeX / mermaid /
 * plantuml / expressive-code），并发会把子进程打满。
 */
export async function getAllPostHeadings(): Promise<
	Map<string, MarkdownHeading[]>
> {
	if (cachedHeadings) return cachedHeadings;

	const posts = await getAllPosts();
	const startedAt = performance.now();
	const headingMap = new Map<string, MarkdownHeading[]>();

	for (const post of posts) {
		const { headings } = await render(post);
		headingMap.set(post.id, headings);
	}

	// 构建期一次性日志：render() 走全 markdown 链，耗时需要可观测
	console.info(
		`[knowledge-graph] 提取 ${posts.length} 篇文章标题耗时 ${Math.round(
			performance.now() - startedAt,
		)}ms`,
	);

	cachedHeadings = headingMap;
	return headingMap;
}

/** 四层知识图谱数据：分类 → 标签 → 文章 → H2 小标题 */
export async function getKnowledgeGraphData(): Promise<KGData> {
	const posts = await getAllPosts();
	const headingMap = await getAllPostHeadings();

	// 图谱里标签节点也要遵循「够篇数才有枢纽页」的门槛，否则一堆节点会指向归档页
	const tagCounts = new Map<string, number>();
	for (const post of posts) {
		const uniqueTags = new Set(
			post.data.tags.map((tag) => tag.trim()).filter(Boolean),
		);
		for (const tag of uniqueTags) {
			tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
		}
	}

	return buildKnowledgeGraphData(
		posts.map((post) => ({
			id: post.id,
			title: post.data.title,
			url: getPostUrlBySlug(post.id),
			published: post.data.published,
			category: post.data.category,
			tags: post.data.tags,
			headings: (headingMap.get(post.id) ?? []).map((heading) => ({
				depth: heading.depth,
				slug: heading.slug,
				text: heading.text,
			})),
		})),
		{
			uncategorizedName: i18n(I18nKey.uncategorized),
			categoryUrl: getCategoryUrl,
			tagUrl: (tagName: string) =>
				resolveTagLink(tagName, tagCounts.get(tagName.trim()) ?? 0),
			siteStartDate: siteConfig.siteStartDate,
		},
	);
}

export type Category = {
	name: string;
	count: number;
	url: string;
};

export type CategoryTag = Tag & {
	url: string;
};

export type CategoryTagGroup = Category & {
	tags: CategoryTag[];
};

export async function getCategoryList(): Promise<Category[]> {
	const allBlogPosts = await getAllPosts();
	const count: { [key: string]: number } = {};
	allBlogPosts.forEach((post) => {
		if (!post.data.category) {
			const ucKey = i18n(I18nKey.uncategorized);
			count[ucKey] = count[ucKey] ? count[ucKey] + 1 : 1;
			return;
		}

		const categoryName =
			typeof post.data.category === "string"
				? post.data.category.trim()
				: String(post.data.category).trim();

		count[categoryName] = count[categoryName] ? count[categoryName] + 1 : 1;
	});

	const lst = Object.keys(count).sort((a, b) => {
		return (
			count[b] - count[a] || a.toLowerCase().localeCompare(b.toLowerCase())
		);
	});

	const ret: Category[] = [];
	for (const c of lst) {
		ret.push({
			name: c,
			count: count[c],
			url: getCategoryUrl(c),
		});
	}
	return ret;
}

export async function getCategoryTagGroups(): Promise<CategoryTagGroup[]> {
	const allBlogPosts = await getAllPosts();
	const groupMap = new Map<
		string,
		{ count: number; tagCounts: Map<string, number> }
	>();
	const uncategorized = i18n(I18nKey.uncategorized);

	// 标签枢纽页是按全站篇数决定是否存在的，所以这里要单独统计全局篇数，
	// 不能用 group.tagCounts（那是分类内的局部计数，会把够篇数的标签误判成碎片标签）
	const globalTagCounts = new Map<string, number>();

	for (const post of allBlogPosts) {
		const categoryName = post.data.category?.trim() || uncategorized;
		const group = groupMap.get(categoryName) ?? {
			count: 0,
			tagCounts: new Map<string, number>(),
		};

		group.count++;
		const postTags = new Set(
			post.data.tags.map((tag) => tag.trim()).filter(Boolean),
		);
		for (const tag of postTags) {
			group.tagCounts.set(tag, (group.tagCounts.get(tag) ?? 0) + 1);
			globalTagCounts.set(tag, (globalTagCounts.get(tag) ?? 0) + 1);
		}
		groupMap.set(categoryName, group);
	}

	return [...groupMap.entries()]
		.map(([name, group]) => ({
			name,
			count: group.count,
			url: getCategoryUrl(name),
			tags: [...group.tagCounts.entries()]
				.map(([tagName, count]) => ({
					name: tagName,
					count,
					url: resolveTagLink(tagName, globalTagCounts.get(tagName) ?? count),
				}))
				.sort(
					(a, b) =>
						b.count - a.count ||
						a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
				),
		}))
		.sort(
			(a, b) =>
				b.count - a.count ||
				a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
		);
}
