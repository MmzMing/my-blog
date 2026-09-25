import I18nKey from "@i18n/i18nKey";
import { i18n } from "@i18n/translation";

/**
 * 移除文件扩展名（.md, .mdx, .markdown）
 * 用于将 Astro v5 Content Layer API 的 id 转换为 URL 友好的 slug
 */
export function removeFileExtension(id: string): string {
	return id.replace(/\.(md|mdx|markdown)$/i, "");
}

function joinUrl(...parts: string[]): string {
	const joined = parts.join("/");
	return joined.replace(/\/+/g, "/");
}

export function getPostUrlBySlug(slug: string): string {
	// 移除文件扩展名（如 .md, .mdx 等）
	const slugWithoutExt = removeFileExtension(slug);
	return url(`/posts/${slugWithoutExt}/`);
}

/**
 * 标签 / 分类的 URL slug。页面路由（getStaticPaths）与链接生成必须共用本函数，
 * 否则参数名对不上会整片 404。规则：去空白、内部空白折成连字符、ASCII 转小写；
 * 中文等非 ASCII 字符原样保留（交给浏览器/服务器做百分号编码）。
 */
export function termToSlug(term: string): string {
	return term.trim().replace(/\s+/g, "-").toLowerCase();
}

/**
 * 标签枢纽页 URL。
 *
 * 注意：并非所有标签都有枢纽页——只有一个标签的文章（碎片化标签）不建页，
 * 避免产出大量薄页面。判断逻辑在 content-utils 的 getTagList() 里，
 * 结果挂在 `Tag.url` 上；需要拿链接时优先用 `tag.url` 而不是直接调本函数。
 */
export function getTagUrl(tag: string): string {
	if (!tag) return url("/archive/");
	return url(`/tags/${termToSlug(tag)}/`);
}

/** 单篇标签的退化地址：归档页按标签过滤（该页带 query 时为 noindex） */
export function getTagArchiveUrl(tag: string): string {
	if (!tag) return url("/archive/");
	return url(`/archive/?tag=${encodeURIComponent(tag.trim())}`);
}

export function getCategoryUrl(category: string | null): string {
	if (
		!category ||
		category.trim() === "" ||
		category.trim().toLowerCase() === i18n(I18nKey.uncategorized).toLowerCase()
	)
		return url("/archive/?uncategorized=true");
	return url(`/categories/${termToSlug(category)}/`);
}

/** 未分类文章的退化地址：归档页按「未分类」过滤 */
export function getUncategorizedArchiveUrl(): string {
	return url("/archive/?uncategorized=true");
}

/** 标签总览页 URL */
export function getTagIndexUrl(): string {
	return url("/tags/");
}

export function getFileDirFromPath(filePath: string): string {
	return filePath.replace(/^src\//, "").replace(/\/[^/]+$/, "");
}

export function getSearchUrl(query: string): string {
	return url(`/search/?q=${encodeURIComponent(query.trim())}`);
}

export function url(path: string): string {
	return joinUrl("", import.meta.env.BASE_URL, path);
}
