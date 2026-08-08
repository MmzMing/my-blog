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
	return new Response(
		`${JSON.stringify(
			{
				...toKnowledgeArticle(post, base),
				content: post.body || "",
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
