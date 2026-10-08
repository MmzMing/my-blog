/**
 * 相关文章卡片数据层。
 *
 * 评分逻辑与旧 RelatedPosts.astro 一致：同 tag +2、同 category +1、排除自身，
 * 同分按发布时间倒序，取前 limit 篇后逐篇构建封面。
 * 面板（ArticleTocPanel）与底部（RelatedPosts）两个消费者共用，避免重复计算。
 */

import type { CollectionEntry } from "astro:content";
import type { CoverImageSource } from "@/types/cover-image";
import { getSortedPosts } from "@/utils/content-utils";
import { buildCoverImage } from "@/utils/cover-image";
import { formatDateToYYYYMMDD } from "@/utils/date-utils";
import { processCoverImageSync } from "@/utils/image-utils";
import { getFileDirFromPath, getPostUrlBySlug } from "@/utils/url-utils";

export interface RelatedPostCard {
	id: string;
	title: string;
	category: string | undefined;
	/** YYYY-MM-DD */
	dateText: string;
	url: string;
	cover: CoverImageSource | null;
}

/* 面板卡宽 18rem（288px）；底部窄屏在主栏内（主栏 max-w-5xl，内容至多 ~60rem） */
export const RELATED_COVER_WIDTHS = [320, 480, 640, 960];
export const RELATED_COVER_SIZES =
	"(min-width: 96rem) 18rem, (min-width: 64rem) 60rem, calc(100vw - 3rem)";

interface GetRelatedOptions {
	currentId: string;
	tags?: string[];
	category?: string;
	limit?: number;
	posts?: CollectionEntry<"posts">[];
	widths?: number[];
	sizes?: string;
}

export async function getRelatedPostCards(
	opts: GetRelatedOptions,
): Promise<RelatedPostCard[]> {
	const {
		currentId,
		tags = [],
		category,
		limit = 3,
		posts = await getSortedPosts(),
		widths = RELATED_COVER_WIDTHS,
		sizes = RELATED_COVER_SIZES,
	} = opts;

	const tagged = tags.map((t) => t.trim());
	const scored = posts
		.filter((p) => p.id !== currentId)
		.map((p) => {
			let score = 0;
			const common = (p.data.tags ?? []).filter((t) =>
				tagged.includes(t.trim()),
			);
			score += common.length * 2;
			if (category && p.data.category === category) score += 1;
			return { p, score };
		})
		.filter((x) => x.score > 0)
		.sort((a, b) =>
			b.score !== a.score
				? b.score - a.score
				: new Date(b.p.data.published) > new Date(a.p.data.published)
					? 1
					: -1,
		);

	const picked = scored.slice(0, limit).map((x) => x.p);

	return Promise.all(
		picked.map(async (p) => {
			const cover = await buildCoverImage({
				image: processCoverImageSync(p.data.image, p.id),
				basePath: getFileDirFromPath(p.filePath || ""),
				widths,
				sizes,
			});
			return {
				id: p.id,
				title: p.data.title,
				category: p.data.category?.trim() || undefined,
				dateText: formatDateToYYYYMMDD(p.data.published),
				url: getPostUrlBySlug(p.id),
				cover,
			} satisfies RelatedPostCard;
		}),
	);
}
