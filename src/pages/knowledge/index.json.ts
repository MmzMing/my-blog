import type { APIRoute } from "astro";
import { siteConfig } from "@/config";
import { getPublicKnowledgePosts, toKnowledgeArticle } from "@/utils/knowledge";

export const prerender = true;

export const GET: APIRoute = async ({ site }) => {
	const base = site ?? new URL(siteConfig.site_url);
	const posts = await getPublicKnowledgePosts();
	const articles = posts.map((post) => toKnowledgeArticle(post, base));
	return new Response(
		`${JSON.stringify(
			{
				type: "BlogKnowledgeIndex",
				version: 1,
				site: new URL("/", base).toString(),
				generatedAt: new Date().toISOString(),
				articles,
			},
			null,
			2,
		)}\n`,
		{
			headers: {
				"Content-Type": "application/json; charset=utf-8",
				"Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
			},
		},
	);
};
