import type { APIRoute } from "astro";
import { llmsConfig, siteConfig } from "@/config";
import { topicDefinitions } from "@/config/topics";
import { getPublicKnowledgePosts, toKnowledgeArticle } from "@/utils/knowledge";

export const prerender = true;

export const GET: APIRoute = async ({ site }) => {
	const base = site ?? new URL(siteConfig.site_url);
	const posts = await getPublicKnowledgePosts();
	const articles = posts.map((post) => toKnowledgeArticle(post, base));
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
		`## ${llmsConfig.topics.heading}`,
		"",
		...topicDefinitions.map(
			(topic) => `- ${topic.title}：${topic.description}`,
		),
		"",
		`## ${llmsConfig.featuredArticles.heading}`,
		"",
		...articles.map(
			(article) =>
				`- [${article.title}](${article.url}): ${article.description} (Markdown: ${article.markdownUrl}; JSON: ${article.jsonUrl})`,
		),
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
