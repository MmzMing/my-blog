import type { PaginationItem } from "@/types/article-list";

function createPageItems(start: number, end: number): PaginationItem[] {
	return Array.from({ length: end - start + 1 }, (_, index) => ({
		kind: "page" as const,
		page: start + index,
	}));
}

export function clampArticleListPage(page: number, totalPages: number): number {
	const normalizedTotal = Math.max(1, Math.floor(totalPages));
	return Math.max(1, Math.min(normalizedTotal, Math.floor(page) || 1));
}

export function getArticleListPaginationItems(
	currentPage: number,
	totalPages: number,
	maxVisiblePages: number,
): PaginationItem[] {
	const total = Math.max(1, Math.floor(totalPages));
	const maxVisible = Math.max(3, Math.floor(maxVisiblePages));
	const current = clampArticleListPage(currentPage, total);

	if (total <= maxVisible) return createPageItems(1, total);

	const edgeWindowSize = maxVisible - 1;
	const edgeThreshold = Math.ceil(maxVisible / 2);

	if (current <= edgeThreshold) {
		return [
			...createPageItems(1, edgeWindowSize),
			{ kind: "ellipsis" },
			{ kind: "page", page: total },
		];
	}

	if (current >= total - edgeThreshold + 1) {
		return [
			{ kind: "page", page: 1 },
			{ kind: "ellipsis" },
			...createPageItems(total - edgeWindowSize + 1, total),
		];
	}

	const middleWindowSize = maxVisible - 2;
	const middleStart = current - Math.floor(middleWindowSize / 2);
	return [
		{ kind: "page", page: 1 },
		{ kind: "ellipsis" },
		...createPageItems(middleStart, middleStart + middleWindowSize - 1),
		{ kind: "ellipsis" },
		{ kind: "page", page: total },
	];
}
