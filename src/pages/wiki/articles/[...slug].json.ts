import type { APIRoute, GetStaticPaths } from "astro";
import { siteConfig } from "@/config";
import {
	createJsonResponse,
	getWikiPosts,
	toWikiArticle,
	type WikiPost,
} from "@/utils/llm-wiki";

export const prerender = true;

export const getStaticPaths: GetStaticPaths = async () => {
	const posts = await getWikiPosts();
	return posts.map((post) => ({
		params: { slug: post.id },
		props: { post },
	}));
};

export const GET: APIRoute = ({ props, site }) => {
	const post = props.post as WikiPost;
	return createJsonResponse(toWikiArticle(post, site ?? siteConfig.site_url));
};
