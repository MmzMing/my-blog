import { type CollectionEntry, getCollection, render } from "astro:content";
import I18nKey from "@i18n/i18nKey";
import { i18n } from "@i18n/translation";
import {
	buildKnowledgeGraphData,
	type KGData,
} from "@utils/knowledge-graph-data";
import { getCategoryUrl, getPostUrlBySlug, getTagUrl } from "@utils/url-utils";
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
};

export async function getTagList(): Promise<Tag[]> {
	const allBlogPosts = await getAllPosts();

	const countMap: { [key: string]: number } = {};
	allBlogPosts.forEach((post) => {
		post.data.tags.forEach((tag) => {
			if (!countMap[tag]) countMap[tag] = 0;
			countMap[tag]++;
		});
	});

	// sort tags by count descending
	const keys: string[] = Object.keys(countMap).sort((a, b) => {
		return countMap[b] - countMap[a];
	});

	return keys.map((key) => ({ name: key, count: countMap[key] }));
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
			tagUrl: getTagUrl,
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
					url: getTagUrl(tagName),
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
