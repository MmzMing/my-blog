import type { APIRoute } from "astro";
import { llmsConfig, siteConfig } from "@/config";

export const prerender = true;

export const GET: APIRoute = async ({ site }) => {
	const base = site ?? new URL(siteConfig.site_url);
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
