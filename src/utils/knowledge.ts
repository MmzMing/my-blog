import type { CollectionEntry } from "astro:content";
import { getTopicDefinition, topicDefinitions } from "@/config/topics";
import { getSortedPosts } from "@/utils/content-utils";
import { getPostUrlBySlug } from "@/utils/url-utils";

export type PublicKnowledgePost = CollectionEntry<"posts">;

export type KnowledgeArticle = {
	id: string;
	title: string;
	description: string;
	published: string;
	updated?: string;
	url: string;
	category: string;
	tags: string[];
	topics: string[];
	headings: string[];
	excerpt: string;
	wordCount?: number;
};

const markdownHeadingPattern = /^(#{1,6})\s+(.+?)\s*#*\s*$/gm;

export function isPublicKnowledgePost(post: PublicKnowledgePost): boolean {
	return post.data.draft !== true && !post.data.password;
}

export async function getPublicKnowledgePosts(): Promise<
	PublicKnowledgePost[]
> {
	const posts = await getSortedPosts();
	return posts.filter(isPublicKnowledgePost);
}

export function extractMarkdownHeadings(markdown: string): string[] {
	return [...markdown.matchAll(markdownHeadingPattern)].map((match) =>
		match[2].trim(),
	);
}

export function stripMarkdown(markdown: string): string {
	return markdown
		.replace(/```[\s\S]*?```/g, " ")
		.replace(/`([^`]+)`/g, "$1")
		.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
		.replace(/^#{1,6}\s+/gm, "")
		.replace(/^>\s?/gm, "")
		.replace(/[*_~]/g, "")
		.replace(/<[^>]+>/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

export function getPostExcerpt(
	post: PublicKnowledgePost,
	maximumCharacters = 320,
): string {
	const source = post.data.description || stripMarkdown(post.body || "");
	return source.length > maximumCharacters
		? `${source.slice(0, maximumCharacters - 1).trimEnd()}…`
		: source;
}

export function getPostTopicSlugs(post: PublicKnowledgePost): string[] {
	const explicitTopics = (post.data.topics || [])
		.map((topic) => topic.trim())
		.filter((topic) => Boolean(getTopicDefinition(topic)));
	if (explicitTopics.length > 0) return [...new Set(explicitTopics)];

	const searchableText = [
		post.data.title,
		post.data.category || "",
		...(post.data.tags || []),
	]
		.join(" ")
		.toLowerCase();

	const inferred = topicDefinitions
		.filter((topic) =>
			topic.keywords.some((keyword) =>
				searchableText.includes(keyword.toLowerCase()),
			),
		)
		.map((topic) => topic.slug);

	return inferred.length > 0 ? inferred : ["deployment"];
}

export function toKnowledgeArticle(
	post: PublicKnowledgePost,
	siteUrl: URL | string,
): KnowledgeArticle {
	const site = new URL(siteUrl);
	const published = post.data.published.toISOString();
	const updated = post.data.updated?.toISOString();
	return {
		id: post.id,
		title: post.data.title,
		description: post.data.description || getPostExcerpt(post),
		published,
		...(updated ? { updated } : {}),
		url: new URL(getPostUrlBySlug(post.id), site).toString(),
		category: post.data.category?.trim() || "未分类",
		tags: post.data.tags || [],
		topics: getPostTopicSlugs(post),
		headings: extractMarkdownHeadings(post.body || ""),
		excerpt: getPostExcerpt(post),
		wordCount: post.body
			? post.body.trim().split(/\s+/).filter(Boolean).length
			: 0,
	};
}

export async function getTopicPosts(
	slug: string,
): Promise<PublicKnowledgePost[]> {
	const posts = await getPublicKnowledgePosts();
	return posts.filter((post) => getPostTopicSlugs(post).includes(slug));
}
