import type { CollectionEntry } from "astro:content";
import GithubSlugger from "github-slugger";
import { getSortedPosts } from "@/utils/content-utils";
import { getPostUrlBySlug } from "@/utils/url-utils";

export type WikiPost = CollectionEntry<"posts">;

export type WikiSection = {
	id: string;
	level: number;
	heading: string;
	content: string;
	excerpt: string;
};

export type WikiArticleSummary = {
	id: string;
	title: string;
	description: string;
	published: string;
	updated?: string;
	url: string;
	jsonUrl: string;
	markdownUrl: string;
	category: string;
	tags: string[];
	headings: string[];
	excerpt: string;
	characterCount: number;
};

export type WikiArticle = WikiArticleSummary & {
	content: string;
	sections: WikiSection[];
};

export type WikiIndex = {
	type: "BlogWikiIndex";
	version: 1;
	site: string;
	generatedAt: string;
	articles: WikiArticleSummary[];
};

const HEADING_PATTERN = /^(#{1,6})[ \t]+(.+?)[ \t]*#?[ \t]*$/;
const FENCE_PATTERN = /^\s*(```|~~~)/;
const DEFAULT_EXCERPT_LENGTH = 320;
export const WIKI_CACHE_CONTROL =
	"public, max-age=3600, stale-while-revalidate=86400";

function encodeSlug(slug: string): string {
	return slug
		.split("/")
		.filter(Boolean)
		.map((segment) => encodeURIComponent(segment))
		.join("/");
}

function toWikiPath(slug: string, extension: ".json" | ".md"): string {
	return `/wiki/articles/${encodeSlug(slug)}${extension}`;
}

function truncate(text: string, maximumCharacters: number): string {
	const characters = Array.from(text);
	return characters.length > maximumCharacters
		? `${characters
				.slice(0, maximumCharacters - 1)
				.join("")
				.trimEnd()}…`
		: text;
}

/** 将 Markdown 转成适合机器摘要的纯文本，保留正文语义而去除展示标记。 */
export function stripMarkdown(markdown: string): string {
	return markdown
		.replace(/```[\s\S]*?```/g, " ")
		.replace(/~~~[\s\S]*?~~~/g, " ")
		.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
		.replace(/<[^>]+>/g, " ")
		.replace(/^\s{0,3}#{1,6}\s+/gm, "")
		.replace(/^\s*>\s?/gm, "")
		.replace(/^\s*[-*+]\s+/gm, "")
		.replace(/^\s*\d+[.)]\s+/gm, "")
		.replace(/[*_~`]/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

function getHeading(line: string): { level: number; heading: string } | null {
	const match = line.match(HEADING_PATTERN);
	if (!match) return null;
	return {
		level: match[1].length,
		heading: match[2]
			.trim()
			.replace(/[ \t]+#+$/, "")
			.trim(),
	};
}

function buildSections(markdown: string, title: string): WikiSection[] {
	const slugger = new GithubSlugger();
	const sections: Array<{
		level: number;
		heading: string;
		content: string;
		excerpt: string;
	}> = [];
	let current = { level: 0, heading: title, lines: [] as string[] };
	let inFence = false;

	const flush = () => {
		const content = current.lines.join("\n").trim();
		if (!content) return;
		sections.push({
			level: current.level,
			heading: current.heading,
			content,
			excerpt: truncate(stripMarkdown(content), DEFAULT_EXCERPT_LENGTH),
		});
	};

	for (const line of markdown.split("\n")) {
		if (FENCE_PATTERN.test(line)) inFence = !inFence;
		const heading = inFence ? null : getHeading(line);
		if (!heading) {
			current.lines.push(line);
			continue;
		}

		flush();
		current = { ...heading, lines: [] };
	}
	flush();

	return sections.map((section) => ({
		...section,
		id: slugger.slug(section.heading),
	}));
}

function getContentView(post: WikiPost): {
	content: string;
	sections: WikiSection[];
	headings: string[];
	excerpt: string;
	characterCount: number;
} {
	const content = post.body?.trim() ?? "";
	const sections = buildSections(content, post.data.title);
	const plainText = stripMarkdown(content);
	return {
		content,
		sections,
		headings: sections
			.filter((section) => section.level > 0)
			.map((section) => section.heading),
		excerpt: truncate(
			post.data.description?.trim() || plainText,
			DEFAULT_EXCERPT_LENGTH,
		),
		characterCount: Array.from(plainText).length,
	};
}

function resolveSite(site: URL | string): URL {
	return new URL(site);
}

export function isPublicWikiPost(post: WikiPost): boolean {
	return (
		post.data.draft !== true &&
		!post.data.password &&
		post.data.wikiExclude !== true
	);
}

export async function getWikiPosts(): Promise<WikiPost[]> {
	const posts = await getSortedPosts();
	return posts.filter(isPublicWikiPost);
}

function createSummary(
	post: WikiPost,
	base: URL,
	view: ReturnType<typeof getContentView>,
): WikiArticleSummary {
	const published = post.data.published.toISOString();
	const updated = post.data.updated?.toISOString();
	return {
		id: post.id,
		title: post.data.title,
		description: post.data.description?.trim() || view.excerpt,
		published,
		...(updated ? { updated } : {}),
		url: new URL(getPostUrlBySlug(post.id), base).toString(),
		jsonUrl: new URL(toWikiPath(post.id, ".json"), base).toString(),
		markdownUrl: new URL(toWikiPath(post.id, ".md"), base).toString(),
		category: post.data.category?.trim() || "",
		tags: (post.data.tags ?? []).map((tag) => tag.trim()).filter(Boolean),
		headings: view.headings,
		excerpt: view.excerpt,
		characterCount: view.characterCount,
	};
}

export function toWikiArticleSummary(
	post: WikiPost,
	site: URL | string,
): WikiArticleSummary {
	const base = resolveSite(site);
	return createSummary(post, base, getContentView(post));
}

export function toWikiArticle(post: WikiPost, site: URL | string): WikiArticle {
	const view = getContentView(post);
	return {
		...createSummary(post, resolveSite(site), view),
		content: view.content,
		sections: view.sections,
	};
}

export function createWikiIndex(
	posts: WikiPost[],
	site: URL | string,
	generatedAt = new Date().toISOString(),
): WikiIndex {
	const base = resolveSite(site);
	return {
		type: "BlogWikiIndex",
		version: 1,
		site: new URL("/", base).toString(),
		generatedAt,
		articles: posts.map((post) => toWikiArticleSummary(post, base)),
	};
}

export function createJsonResponse(value: unknown): Response {
	return new Response(`${JSON.stringify(value, null, 2)}\n`, {
		headers: {
			"Content-Type": "application/json; charset=utf-8",
			"Cache-Control": WIKI_CACHE_CONTROL,
		},
	});
}

export function createMarkdownResponse(article: WikiArticle): Response {
	const frontmatter = [
		"---",
		`title: ${JSON.stringify(article.title)}`,
		`description: ${JSON.stringify(article.description)}`,
		`published: ${article.published}`,
		...(article.updated ? [`updated: ${article.updated}`] : []),
		`category: ${JSON.stringify(article.category)}`,
		`tags: ${JSON.stringify(article.tags)}`,
		`canonical: ${article.url}`,
		"---",
		"",
	].join("\n");

	return new Response(`${frontmatter}${article.content}\n`, {
		headers: {
			"Content-Type": "text/markdown; charset=utf-8",
			"Cache-Control": WIKI_CACHE_CONTROL,
		},
	});
}
