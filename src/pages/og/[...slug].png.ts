import type { CollectionEntry } from "astro:content";
import { getCollection } from "astro:content";
import * as fs from "node:fs";
import type { APIContext, GetStaticPaths } from "astro";
import type { FontLoader, ImagesInput } from "takumi-js";
import { setGlyphCacheMaxBytes } from "takumi-js";
import { ImageResponse } from "takumi-js/response";
import { homeConfig, siteConfig } from "@/config";
import { defaultFavicons } from "@/constants/icon";
import { formatDateI18n } from "@/utils/date-utils";
import { removeFileExtension } from "@/utils/url-utils";

export const prerender = true;

const OG_WIDTH = 1200;
const OG_HEIGHT = 630;

// 模板里 img 的 src 用的是这两个键名，渲染时由 images.sources 提供字节，
// 避免把 base64 塞进节点树
const ICON_KEY = "og-icon";
const AVATAR_KEY = "og-avatar";

const FONT_FAMILY = "AaZongYiYuan";
const FONT_PATH = "./public/fonts/AaZongYiYuan/AaZongYiYuan-2.ttf";

// 字形缓存默认 8 MiB，按 takumi 官方说明只够容纳约一千个 CJK 字形，
// 批量渲染中文标题会不断重栅格化刚被淘汰的字形。必须在首次 render 之前调用。
setGlyphCacheMaxBytes(64 * 1024 * 1024);

export const getStaticPaths: GetStaticPaths = async () => {
	if (!siteConfig.generateOgImages) {
		return [];
	}

	const allPosts = await getCollection("posts");
	const publishedPosts = allPosts.filter((post) => !post.data.draft);

	return publishedPosts.map((post) => {
		// 将 id 转换为 slug（移除扩展名）以匹配路由参数
		const slug = removeFileExtension(post.id);
		return {
			params: { slug },
			props: { post },
		};
	});
};

/** 1×1 透明 PNG，硬编码以便任何资源加载失败时都有可用占位 */
const TRANSPARENT_PNG = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
	"base64",
);

// 按来源缓存 Promise：整次构建对同一资源只读盘/请求一次，
// 失败结果同样被缓存，避免每篇文章重复打印同一条警告
const assetCache = new Map<string, Promise<Buffer>>();

async function readAsset(source: string): Promise<Buffer> {
	if (/^https?:\/\//i.test(source)) {
		const res = await fetch(source);
		if (!res.ok) {
			throw new Error(`HTTP ${res.status}`);
		}
		return Buffer.from(await res.arrayBuffer());
	}
	// 以 / 开头视为 public 下的绝对路径，否则按 src 下的相对路径解析
	const filePath = source.startsWith("/")
		? `./public${source}`
		: `./src/${source}`;
	return fs.promises.readFile(filePath);
}

function loadAsset(source: string, label: string): Promise<Buffer> {
	const cached = assetCache.get(source);
	if (cached) {
		return cached;
	}
	const task = readAsset(source).catch((err: unknown) => {
		const reason = err instanceof Error ? err.message : String(err);
		console.warn(
			`[OG] ${label} "${source}" 加载失败，已用透明图占位：${reason}`,
		);
		return TRANSPARENT_PNG;
	});
	assetCache.set(source, task);
	return task;
}

/**
 * 取尺寸最大的 PNG favicon：模板按 48×48 渲染，配置里第一个 PNG 可能只有 16×16 会发虚；
 * ICO / SVG 在位图管线里不如 PNG 稳妥，因此不参与候选。
 */
function resolveIconSource(): string {
	const largestPng = siteConfig.favicon
		.filter((favicon) => favicon.src.toLowerCase().endsWith(".png"))
		.map((favicon) => ({
			src: favicon.src,
			// sizes 形如 "48x48"，取前一段；"any" 这类解析不出数字的按 0 处理
			size: Number.parseInt(favicon.sizes ?? "", 10) || 0,
		}))
		.sort((a, b) => b.size - a.size)[0];
	if (largestPng) {
		return largestPng.src;
	}
	const fallback =
		defaultFavicons.find(
			(favicon) => favicon.theme === "dark" && favicon.sizes === "192x192",
		) ?? defaultFavicons[0];
	return fallback.src;
}

// 惰性描述符：takumi 的 FontRegistry 按 name 去重，整次构建只解析一次 data()。
// generic 让模板 fontFamily 末尾的 sans-serif 也能兜到这个字体——
// 构建期没有系统字体，中间那串 -apple-system / Segoe UI 都是解析不到的。
function buildFontLoaders(): FontLoader[] {
	if (!fs.existsSync(FONT_PATH)) {
		console.warn(
			`[OG] 字体 "${FONT_PATH}" 不存在，将回退到 takumi 内置字体，中文可能显示为空白`,
		);
		return [];
	}
	return [
		{
			name: FONT_FAMILY,
			weight: 400,
			style: "normal",
			generic: "sans-serif",
			data: () => fs.promises.readFile(FONT_PATH),
		},
	];
}

const ogFonts = buildFontLoaders();

const ogImages: ImagesInput = {
	cache: "auto",
	sources: [
		{
			src: ICON_KEY,
			data: () => loadAsset(resolveIconSource(), "站点图标"),
		},
		{
			src: AVATAR_KEY,
			data: () => loadAsset(homeConfig.avatar ?? "", "头像"),
		},
	],
};

export async function GET({
	props,
}: APIContext<{ post: CollectionEntry<"posts"> }>): Promise<Response> {
	const { post } = props;
	const { data } = post;

	const hue = siteConfig.themeColor.hue;
	const primaryColor = `hsl(${hue}, 90%, 65%)`;
	const textColor = "hsl(0, 0%, 95%)";
	const subtleTextColor = `hsl(${hue}, 10%, 75%)`;
	const backgroundColor = `hsl(${hue}, 15%, 12%)`;

	const pubDate = formatDateI18n(data.published);
	const description = data.description;

	return new ImageResponse(
		{
			type: "div",
			props: {
				style: {
					height: "100%",
					width: "100%",
					display: "flex",
					flexDirection: "column",
					backgroundColor: backgroundColor,
					fontFamily: `"${FONT_FAMILY}", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`,
					padding: "60px",
				},
				children: [
					{
						type: "div",
						props: {
							style: {
								width: "100%",
								display: "flex",
								alignItems: "center",
								gap: "20px",
							},
							children: [
								{
									type: "img",
									props: {
										src: ICON_KEY,
										width: 48,
										height: 48,
										style: { borderRadius: "10px", objectFit: "cover" },
									},
								},
								{
									type: "div",
									props: {
										style: {
											fontSize: "36px",
											fontWeight: 600,
											color: subtleTextColor,
										},
										children: siteConfig.title,
									},
								},
							],
						},
					},
					{
						type: "div",
						props: {
							style: {
								display: "flex",
								flexDirection: "column",
								justifyContent: "center",
								flexGrow: 1,
								gap: "20px",
							},
							children: [
								{
									type: "div",
									props: {
										style: {
											display: "flex",
											alignItems: "flex-start",
										},
										children: [
											{
												type: "div",
												props: {
													style: {
														width: "10px",
														height: "68px",
														backgroundColor: primaryColor,
														borderRadius: "6px",
														marginTop: "14px",
														// 标题过长时不让这根装饰竖条被挤扁
														flexShrink: 0,
													},
												},
											},
											{
												type: "div",
												props: {
													style: {
														fontSize: "72px",
														fontWeight: 700,
														lineHeight: 1.2,
														color: textColor,
														marginLeft: "25px",
														display: "-webkit-box",
														overflow: "hidden",
														textOverflow: "ellipsis",
														lineClamp: 3,
														WebkitLineClamp: 3,
														WebkitBoxOrient: "vertical",
													},
													children: data.title,
												},
											},
										],
									},
								},
								...(description
									? [
											{
												type: "div",
												props: {
													style: {
														fontSize: "32px",
														lineHeight: 1.5,
														color: subtleTextColor,
														paddingLeft: "35px",
														display: "-webkit-box",
														overflow: "hidden",
														textOverflow: "ellipsis",
														lineClamp: 2,
														WebkitLineClamp: 2,
														WebkitBoxOrient: "vertical",
													},
													children: description,
												},
											},
										]
									: []),
							],
						},
					},
					{
						type: "div",
						props: {
							style: {
								display: "flex",
								justifyContent: "space-between",
								alignItems: "center",
								width: "100%",
							},
							children: [
								{
									type: "div",
									props: {
										style: {
											display: "flex",
											alignItems: "center",
											gap: "20px",
										},
										children: [
											{
												type: "img",
												props: {
													src: AVATAR_KEY,
													width: 60,
													height: 60,
													style: {
														borderRadius: "50%",
														objectFit: "cover",
													},
												},
											},
											{
												type: "div",
												props: {
													style: {
														fontSize: "28px",
														fontWeight: 600,
														color: textColor,
													},
													children: homeConfig.name,
												},
											},
										],
									},
								},
								{
									type: "div",
									props: {
										style: { fontSize: "28px", color: subtleTextColor },
										children: pubDate,
									},
								},
							],
						},
					},
				],
			},
		},
		{
			width: OG_WIDTH,
			height: OG_HEIGHT,
			format: "png",
			// BCP-47，交给 takumi 做 CJK 排版决策
			lang: siteConfig.lang.replace("_", "-"),
			fonts: ogFonts,
			images: ogImages,
			headers: {
				"Content-Type": "image/png",
				"Cache-Control": "public, max-age=31536000, immutable",
			},
			onError: (error: unknown) => {
				const reason = error instanceof Error ? error.message : String(error);
				console.warn(`[OG] 渲染 "${post.id}" 失败：${reason}`);
			},
		},
	);
}
