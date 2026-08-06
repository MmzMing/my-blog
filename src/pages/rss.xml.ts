import { getImage } from "astro:assets";
import rss, { type RSSFeedItem } from "@astrojs/rss";
import I18nKey from "@i18n/i18nKey";
import { i18n } from "@i18n/translation";
import { getSortedPosts } from "@utils/content-utils";
import { formatDateI18nWithTime } from "@utils/date-utils";
import { url } from "@utils/url-utils";
import type { APIContext, ImageMetadata } from "astro";
import { marked, Renderer, type Tokens } from "marked";
import sanitizeHtml from "sanitize-html";
import { siteConfig } from "@/config";
import pkg from "../../package.json";

const postImages = import.meta.glob<ImageMetadata>(
	"../content/posts/**/*.{png,jpg,jpeg,webp}",
	{ eager: true, import: "default" },
);

function stripInvalidXmlChars(str: string): string {
	return str.replace(
		// biome-ignore lint/suspicious/noControlCharactersInRegex: https://www.w3.org/TR/xml/#charsets
		/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F\uFDD0-\uFDEF\uFFFE\uFFFF]/g,
		"",
	);
}

function normalizeModulePath(path: string): string {
	const segments: string[] = [];
	for (const segment of path.replaceAll("\\", "/").split("/")) {
		if (!segment || segment === ".") continue;
		if (segment === "..") {
			if (segments.length > 0 && segments.at(-1) !== "..") {
				segments.pop();
			} else {
				segments.push(segment);
			}
			continue;
		}
		segments.push(segment);
	}
	return segments.join("/");
}

function resolvePostImage(
	postId: string,
	source: string,
): ImageMetadata | null {
	if (
		!source ||
		source.startsWith("/") ||
		source.startsWith("#") ||
		/^[a-z][a-z\d+.-]*:/i.test(source)
	) {
		return null;
	}

	let cleanSource = source.split(/[?#]/, 1)[0];
	try {
		cleanSource = decodeURIComponent(cleanSource);
	} catch {
		// Keep malformed percent-encoded paths unchanged and let the lookup miss safely.
	}
	const postDirectory = postId.includes("/")
		? postId.slice(0, postId.lastIndexOf("/") + 1)
		: "";
	const normalizedPath = normalizeModulePath(
		`../content/posts/${postDirectory}${cleanSource}`,
	);
	return postImages[normalizedPath] ?? null;
}

async function createImageUrlMap(
	postId: string,
	markdown: string,
	site: URL,
): Promise<Map<string, string>> {
	const sources = new Set<string>();
	for (const match of markdown.matchAll(
		/!\[[^\]]*\]\(([^)\s]+)(?:\s+[^)]*)?\)/g,
	)) {
		sources.add(match[1]);
	}

	const entries = await Promise.all(
		[...sources].map(async (source) => {
			const image = resolvePostImage(postId, source);
			if (!image) return [source, source] as const;

			const optimized = await getImage({
				src: image,
				width: Math.min(image.width, 1280),
				format: "webp",
				quality: 80,
			});
			return [source, new URL(optimized.src, site).toString()] as const;
		}),
	);
	return new Map(entries);
}

function toAbsoluteUrl(value: string, base: URL): string {
	if (!value || value.startsWith("#")) return value;
	try {
		return new URL(value, base).toString();
	} catch {
		return value;
	}
}

async function renderRssContent(
	postId: string,
	markdown: string,
	postUrl: URL,
	site: URL,
): Promise<string> {
	const imageUrls = await createImageUrlMap(postId, markdown, site);
	const renderer = new Renderer();
	const renderImage = renderer.image.bind(renderer);
	renderer.image = (token: Tokens.Image) =>
		renderImage({
			...token,
			href: imageUrls.get(token.href) ?? toAbsoluteUrl(token.href, postUrl),
		});

	const html = await marked.parse(markdown, {
		gfm: true,
		renderer,
	});
	return stripInvalidXmlChars(
		sanitizeHtml(html, {
			allowedTags: sanitizeHtml.defaults.allowedTags.concat(["img"]),
			allowedAttributes: {
				a: ["href", "title"],
				img: ["src", "alt", "title", "width", "height", "loading"],
				code: ["class"],
			},
			transformTags: {
				a: (tagName, attributes) => ({
					tagName,
					attribs: {
						...attributes,
						href: toAbsoluteUrl(attributes.href ?? "", postUrl),
					},
				}),
				img: (tagName, attributes) => ({
					tagName,
					attribs: {
						...attributes,
						src: toAbsoluteUrl(attributes.src ?? "", postUrl),
						loading: "lazy",
					},
				}),
			},
		}),
	);
}

function wrapContentInCdata(xml: string, contents: string[]): string {
	let index = 0;
	return xml.replace(/<content:encoded>[\s\S]*?<\/content:encoded>/g, () => {
		const content = contents[index++] ?? "";
		const cdataSafeContent = content.replaceAll("]]>", "]]]]><![CDATA[>");
		return `<content:encoded><![CDATA[${cdataSafeContent}]]></content:encoded>`;
	});
}

export async function GET(context: APIContext): Promise<Response> {
	const blog = await getSortedPosts();
	const site = new URL(context.site ?? "https://firefly.cuteleaf.cn");
	const feedItems: RSSFeedItem[] = [];
	for (const post of blog) {
		const postUrl = new URL(url(`/posts/${post.id}/`), site);
		if (post.data.password) {
			feedItems.push({
				title: post.data.title,
				pubDate: post.data.published,
				description: post.data.description || "",
				link: postUrl.toString(),
				content: i18n(I18nKey.passwordProtectedRss),
			});
			continue;
		}
		feedItems.push({
			title: post.data.title,
			pubDate: post.data.published,
			description: post.data.description || "",
			link: postUrl.toString(),
			content: await renderRssContent(post.id, post.body ?? "", postUrl, site),
		});
	}
	const response = await rss({
		title: siteConfig.title,
		description: siteConfig.description || siteConfig.title,
		site,
		customData: `<templateTheme>Firefly</templateTheme>
		<templateThemeVersion>${pkg.version}</templateThemeVersion>
		<templateThemeUrl>https://github.com/CuteLeaf/Firefly</templateThemeUrl>
		<lastBuildDate>${formatDateI18nWithTime(new Date())}</lastBuildDate>`,
		items: feedItems,
	});
	const headers = new Headers(response.headers);
	headers.set(
		"Cache-Control",
		"public, max-age=3600, stale-while-revalidate=86400",
	);
	const xml = wrapContentInCdata(
		await response.text(),
		feedItems.map((item) => item.content ?? ""),
	);
	return new Response(xml, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}
