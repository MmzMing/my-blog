import I18nKey from "@i18n/i18nKey";
import { i18n } from "@i18n/translation";
import { siteConfig } from "@/config";
import type { ArchiveGroup, ArchivePost, ArchiveViews } from "@/types/archive";
import type { PostForList } from "@/utils/content-utils";
import { formatDateI18n } from "@/utils/date-utils";
import { getPostUrlBySlug } from "@/utils/url-utils";

/** 三种索引共用文章数据，分组只在构建期计算，浏览器只负责切换与开合。 */
export function buildArchiveViews(entries: PostForList[]): ArchiveViews {
	const locale = siteConfig.lang.replace("_", "-");
	const dateFormatter = new Intl.DateTimeFormat("en-US", {
		timeZone: siteConfig.timezone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	});
	const monthFormatter = new Intl.DateTimeFormat(locale, {
		timeZone: siteConfig.timezone,
		month: "long",
	});
	const years = new Map<string, ArchiveGroup>();
	const months = new Map<string, ArchiveGroup>();
	const categories = new Map<string, ArchiveGroup>();
	const tags = new Map<string, ArchiveGroup>();

	function appendTerm(
		groups: Map<string, ArchiveGroup>,
		term: string,
		post: ArchivePost,
		prefix: string,
	): void {
		const existing = groups.get(term);
		if (existing) {
			existing.children.push(post);
			existing.count += 1;
			return;
		}
		groups.set(term, {
			kind: "group",
			id: `${prefix}-${groups.size}`,
			label: term,
			count: 1,
			isOpen: false,
			children: [post],
		});
	}

	const sortedEntries = [...entries].sort(
		(a, b) => b.data.published.getTime() - a.data.published.getTime(),
	);
	for (const entry of sortedEntries) {
		const parts = dateFormatter.formatToParts(entry.data.published);
		const year = parts.find((part) => part.type === "year")?.value ?? "";
		const month = parts.find((part) => part.type === "month")?.value ?? "";
		const day = parts.find((part) => part.type === "day")?.value ?? "";
		const post: ArchivePost = {
			kind: "post",
			id: entry.id,
			title: entry.data.title,
			url: getPostUrlBySlug(entry.id),
			date: `${month}.${day}`,
			dateLabel: formatDateI18n(entry.data.published),
			isoDate: entry.data.published.toISOString(),
			category: entry.data.category?.trim() ?? "",
			tags: [
				...new Set(entry.data.tags.map((tag) => tag.trim()).filter(Boolean)),
			],
		};
		let yearGroup = years.get(year);
		if (!yearGroup) {
			yearGroup = {
				kind: "group",
				id: `year-${year}`,
				label: year,
				count: 0,
				isOpen: true,
				children: [],
			};
			years.set(year, yearGroup);
		}
		yearGroup.count += 1;
		const monthKey = `${year}-${month}`;
		let monthGroup = months.get(monthKey);
		if (!monthGroup) {
			monthGroup = {
				kind: "group",
				id: `month-${monthKey}`,
				label: monthFormatter.format(entry.data.published),
				count: 0,
				isOpen: true,
				children: [],
			};
			months.set(monthKey, monthGroup);
			yearGroup.children.push(monthGroup);
		}
		monthGroup.children.push(post);
		monthGroup.count += 1;
		appendTerm(
			categories,
			post.category || i18n(I18nKey.uncategorized),
			post,
			"category",
		);
		for (const tag of post.tags.length ? post.tags : [i18n(I18nKey.noTags)])
			appendTerm(tags, tag, post, "tag");
	}
	const categoryGroups = [...categories.values()].sort((a, b) =>
		a.label.localeCompare(b.label, locale),
	);
	const tagGroups = [...tags.values()].sort(
		(a, b) => b.count - a.count || a.label.localeCompare(b.label, locale),
	);
	if (categoryGroups[0]) categoryGroups[0].isOpen = true;
	if (tagGroups[0]) tagGroups[0].isOpen = true;
	return {
		time: [...years.values()],
		category: categoryGroups,
		tag: tagGroups,
	};
}
