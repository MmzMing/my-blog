import type { APIRoute, GetStaticPaths } from "astro";
import { siteConfig } from "@/config";
import { getPublicKnowledgePosts, toKnowledgeArticle } from "@/utils/knowledge";

export const prerender = true;

export const getStaticPaths: GetStaticPaths = async () => {
	const posts = await getPublicKnowledgePosts();
	return posts.map((post) => ({
		params: { slug: post.id },
		props: { post },
	}));
};

export const GET: APIRoute = ({ props, site }) => {
	const post = props.post;
	const base = site ?? new URL(siteConfig.site_url);
	const article = toKnowledgeArticle(post, base);
	const frontmatter = [
		"---",
		`title: ${JSON.stringify(article.title)}`,
		`description: ${JSON.stringify(article.description)}`,
		`published: ${article.published}`,
		...(article.updated ? [`updated: ${article.updated}`] : []),
		`category: ${JSON.stringify(article.category)}`,
		`tags: ${JSON.stringify(article.tags)}`,
		`topics: ${JSON.stringify(article.topics)}`,
		`canonical: ${article.url}`,
		"---",
		"",
	].join("\n");
	return new Response(`${frontmatter}${post.body || ""}\n`, {
		headers: {
			"Content-Type": "text/markdown; charset=utf-8",
			"Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
		},
	});
};
