import { getWikiPosts } from "@utils/llm-wiki";
import { getPostUrlBySlug } from "@utils/url-utils";
import type { APIRoute } from "astro";
import { llmsConfig, siteConfig } from "@/config";

export const prerender = true;

/** 转义 Markdown 链接文本中的方括号，避免破坏链接语法。 */
function escapeLinkText(text: string): string {
	return text.replaceAll("[", "\\[").replaceAll("]", "\\]");
}

export const GET: APIRoute = async ({ site }) => {
	const base = site ?? new URL(siteConfig.site_url);

	const posts = (await getWikiPosts()).slice(0, llmsConfig.featuredPosts.limit);

	const lines = [
		`# ${siteConfig.title}`,
		"",
		`> ${siteConfig.description || siteConfig.title}`,
		"",
		`## ${llmsConfig.author.heading}`,
		"",
		llmsConfig.author.description,
		"",
		`## ${llmsConfig.machineEntrypoints.heading}`,
		"",
		...llmsConfig.machineEntrypoints.items.map(
			(entry) => `- ${entry.label}: ${new URL(entry.path, base).href}`,
		),
		"",
		`## ${llmsConfig.featuredPosts.heading}`,
		"",
		...posts.map((post) => {
			const title = escapeLinkText(post.data.title);
			const link = `- [${title}](${new URL(getPostUrlBySlug(post.id), base).href})`;
			const description = post.data.description?.trim();
			return description ? `${link}: ${description}` : link;
		}),
		"",
		`## ${llmsConfig.usage.heading}`,
		"",
		llmsConfig.usage.description,
	];

	return new Response(`${lines.join("\n")}\n`, {
		headers: {
			"Content-Type": "text/plain; charset=utf-8",
			"Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
		},
	});
};
