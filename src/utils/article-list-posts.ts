import { type CollectionEntry, render } from "astro:content";
import { siteConfig } from "@/config";
import { coverImageConfig } from "@/config/coverImageConfig";
import I18nKey from "@i18n/i18nKey";
import { i18n } from "@i18n/translation";
import type { ArticleListPost, UmamiPageviewConfig } from "@/types/article-list";
import { buildCoverImage } from "@/utils/cover-image";
import { getApiUrlList, processCoverImageSync } from "@/utils/image-utils";
import { getFileDirFromPath, getPostUrlBySlug, url } from "@/utils/url-utils";

/**
 * 文章卡片数据（ArticleListPost）的构建点。
 *
 * 目前由标签枢纽页与分类枢纽页使用。
 *
 * 注意：`ArticleListPage.astro` 内部仍保留着一份等价的内联实现（同一套封面取档、
 * 分类色相、卡片字段）。两份逻辑尚未合并——改动卡片字段时**必须同时改两处**，
 * 否则枢纽页与列表页的卡片会漂移（例如只在一边补了 excerpt 兜底）。
 * 合并这件事没做，是刻意的范围控制，不是遗漏。
 */

/** 普通卡片：按栅格实际占宽取档 */
export const CARD_COVER_WIDTHS = [320, 480, 640];
export const CARD_COVER_SIZES =
	"(max-width: 640px) 92vw, (max-width: 1024px) 46vw, 320px";
/** 置顶卡片：横跨内容区，单独给一组更大的候选 */
export const PINNED_COVER_WIDTHS = [640, 960, 1280];
export const PINNED_COVER_SIZES = "(max-width: 1024px) 96vw, 1024px";

const { randomCoverImage } = coverImageConfig;

/**
 * `render()` 会跑完整 markdown 链（KaTeX / mermaid / plantuml / expressive-code），
 * 是构建里最贵的一步。同一篇文章会出现在列表页、它的每个标签枢纽页、以及分类枢纽页上，
 * 卡片又都需要 render 产出的 words 与 excerpt——不做缓存的话，26 篇文章会按
 * 「文章 × 页面」的组合数反复重渲染（实测把整次构建从几分钟拉到十几分钟）。
 * 静态构建全程同一个 Node 进程，模块级缓存即可去重。
 */
const postRenderCache = new Map<
	string,
	ReturnType<typeof render>
>();

function renderPostOnce(entry: CollectionEntry<"posts">) {
	const cached = postRenderCache.get(entry.id);
	if (cached) return cached;
	const pending = render(entry);
	postRenderCache.set(entry.id, pending);
	return pending;
}

// 兜底图只服务于随机图：随机图关闭时没写 image 的文章直接不渲染封面区域
const fallbackImagePath = randomCoverImage.enable
	? randomCoverImage.fallback || ""
	: "";

export const fallbackImageUrl = fallbackImagePath ? url(fallbackImagePath) : "";
export const showCoverLoading = randomCoverImage.showLoading ?? true;

const dateFormatter = new Intl.DateTimeFormat(siteConfig.lang.replace("_", "-"), {
	year: "numeric",
	month: "2-digit",
	day: "2-digit",
});

/** 从分类名推导稳定的色相，让同一分类的卡片配色始终一致 */
export function getCategoryHue(category: string): number {
	let hash = 2166136261;
	for (let index = 0; index < category.length; index++) {
		hash ^= category.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0) % 360;
}

async function resolvePostCover(
	entry: CollectionEntry<"posts">,
	widths: number[],
	sizes: string,
) {
	const cover = await buildCoverImage({
		image: processCoverImageSync(entry.data.image, entry.id),
		basePath: getFileDirFromPath(entry.filePath || ""),
		widths,
		sizes,
	});
	if (cover) return cover;

	// 没写 image、或本地文件缺失：只有随机图开启时才退到兜底图，否则不渲染封面
	if (!fallbackImagePath) return null;
	return buildCoverImage({ image: fallbackImagePath, widths, sizes });
}

export async function createArticleListPost(
	entry: CollectionEntry<"posts">,
	coverWidths: number[] = CARD_COVER_WIDTHS,
	coverSizes: string = CARD_COVER_SIZES,
): Promise<ArticleListPost> {
	const [{ remarkPluginFrontmatter }, cover] = await Promise.all([
		renderPostOnce(entry),
		resolvePostCover(entry, coverWidths, coverSizes),
	]);
	const rawCategory = entry.data.category?.trim();
	const category = rawCategory || i18n(I18nKey.uncategorized);
	const tags = (entry.data.tags || []).map((tag) => tag.trim()).filter(Boolean);

	return {
		id: entry.id,
		title: entry.data.title,
		url: getPostUrlBySlug(entry.id),
		publishedIso: entry.data.published.toISOString(),
		publishedTimestamp: entry.data.published.getTime(),
		publishedText: dateFormatter.format(entry.data.published),
		category,
		categoryHue: getCategoryHue(category),
		tags,
		description:
			entry.data.description ||
			remarkPluginFrontmatter.excerpt ||
			i18n(I18nKey.noDescriptionFallback),
		pinned: !!entry.data.pinned,
		password: !!entry.data.password,
		wordCount: Number(remarkPluginFrontmatter.words) || 0,
		cover,
		apiUrls: getApiUrlList(entry.data.image, entry.id),
	};
}

/** 批量构建；串行避免同时跑多条 markdown 渲染链 */
export async function createArticleListPosts(
	entries: CollectionEntry<"posts">[],
	coverWidths: number[] = CARD_COVER_WIDTHS,
	coverSizes: string = CARD_COVER_SIZES,
): Promise<ArticleListPost[]> {
	const posts: ArticleListPost[] = [];
	for (const entry of entries) {
		posts.push(await createArticleListPost(entry, coverWidths, coverSizes));
	}
	return posts;
}

/** 列表页的 Umami 浏览量配置 */
export function getUmamiPageviews(): UmamiPageviewConfig {
	const umamiConfig = siteConfig.analytics?.umamiAnalytics;
	return {
		enabled:
			!!umamiConfig?.pageviews?.enabled &&
			!!umamiConfig.shareId &&
			!!umamiConfig.scriptUrl,
		apiBase: umamiConfig?.scriptUrl ? new URL(umamiConfig.scriptUrl).origin : "",
		shareId: umamiConfig?.shareId || "",
	};
}
