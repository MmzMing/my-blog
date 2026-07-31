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

export default {
	async fetch(request, env): Promise<Response> {
		const url = new URL(request.url);
		if (url.pathname === "/api/ai-chat") {
			if (!aiSearchConfig.enabled) {
				return Response.json({ error: "Not Found" }, { status: 404 });
			}
			return handleCloudflareAiSearch(request, env);
		}
		return withStaticSecurityHeaders(await env.ASSETS.fetch(request));
	},
} satisfies ExportedHandler<Env>;
