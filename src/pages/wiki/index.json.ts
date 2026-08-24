import type { APIRoute } from "astro";
import { siteConfig } from "@/config";
import {
	createJsonResponse,
	createWikiIndex,
	getWikiPosts,
} from "@/utils/llm-wiki";

export const prerender = true;

export const GET: APIRoute = async ({ site }) => {
	const posts = await getWikiPosts();
	return createJsonResponse(
		createWikiIndex(posts, site ?? siteConfig.site_url),
	);
};
