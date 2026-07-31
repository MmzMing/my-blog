import { aiSearchConfig } from "./config/aiSearchConfig";
import { handleCloudflareAiSearch } from "./workers/cloudflare/ai-search/runtime";

export { RateLimiter } from "./workers/cloudflare/ai-search/durable-rate-limiter";

const STATIC_SECURITY_HEADERS = {
	"Content-Security-Policy-Report-Only": [
		"default-src 'self'",
		"base-uri 'self'",
		"object-src 'none'",
		"frame-ancestors 'self'",
		"form-action 'self' https:",
		"img-src 'self' data: blob: https:",
		"font-src 'self' data: https:",
		"style-src 'self' 'unsafe-inline' https:",
		"script-src 'self' 'unsafe-inline' 'unsafe-eval' https:",
		"connect-src 'self' https: wss:",
		"media-src 'self' blob: https:",
		"frame-src https:",
		"worker-src 'self' blob:",
	].join("; "),
	"Permissions-Policy":
		"camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
	"Referrer-Policy": "strict-origin-when-cross-origin",
	"Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
	"X-Content-Type-Options": "nosniff",
	"X-Frame-Options": "SAMEORIGIN",
} satisfies Record<string, string>;

function withStaticSecurityHeaders(response: Response): Response {
	const headers = new Headers(response.headers);
	for (const [name, value] of Object.entries(STATIC_SECURITY_HEADERS)) {
		headers.set(name, value);
	}
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}

function plainNotFound(): Response {
	return new Response(
		`<!DOCTYPE html>
<html lang="zh-CN">
<head>
	<meta charset="UTF-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1" />
	<title>404</title>
	<style>
		body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,sans-serif;background:#0b0b0b;color:#eee}
		main{text-align:center;padding:2rem}
		h1{font-size:4rem;margin:0;opacity:.25}
		p{margin:1rem 0 1.5rem;opacity:.75}
		a{color:inherit;text-decoration:underline}
	</style>
</head>
<body>
	<main>
		<h1>404</h1>
		<p>页面不存在</p>
		<a href="/">返回首页</a>
	</main>
</body>
</html>`,
		{
			status: 404,
			headers: {
				"Content-Type": "text/html; charset=utf-8",
				"Cache-Control": "no-cache",
			},
		},
	);
}

export default {
	async fetch(request, env): Promise<Response> {
		const url = new URL(request.url);
		if (url.pathname === "/api/ai-chat") {
			if (!aiSearchConfig.enabled) {
				return Response.json({ error: "Not Found" }, { status: 404 });
			}
			return handleCloudflareAiSearch(request, env);
		}
		if (env.ASSETS) {
			return withStaticSecurityHeaders(await env.ASSETS.fetch(request));
		}
		return withStaticSecurityHeaders(plainNotFound());
	},
} satisfies ExportedHandler<Env>;
