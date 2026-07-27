<script lang="ts">
import I18nKey from "@i18n/i18nKey";
import { i18n } from "@i18n/translation";
import { onMount } from "svelte";
import Icon from "@/components/common/Icon.svelte";
import { coverImageConfig } from "@/config/coverImageConfig";
import {
	getUmamiPageviewLookup,
	normalizeUmamiPageviewPath,
} from "@/utils/umami-pageviews";

type ArticleListView = "list" | "grid";

type ArticleListTag = {
	name: string;
	url: string;
};

type ArticleListImageSource = {
	type: string;
	srcset: string;
};

export type ArticleListPost = {
	id: string;
	title: string;
	url: string;
	publishedIso: string;
	publishedText: string;
	category: string;
	categoryUrl: string;
	tags: ArticleListTag[];
	description: string;
	imageUrl: string;
	imageSources: ArticleListImageSource[];
	imageApiUrls: string[];
	imageReferrerPolicy: string;
	pinned: boolean;
	password: boolean;
};

type UmamiPageviewConfig = {
	apiBase: string;
	enabled: boolean;
	shareId: string;
};

interface Props {
	posts: ArticleListPost[];
	defaultView?: ArticleListView;
	postsPerPage?: number;
	umamiPageviews?: UmamiPageviewConfig;
}

let {
	posts,
	defaultView = "list",
	postsPerPage = 15,
	umamiPageviews,
}: Props = $props();

let containerRef = $state<HTMLElement | null>(null);
let view = $state<ArticleListView>(defaultView);
let currentPage = $state(1);
let pageviewLookup = $state<Map<string, number> | null>(null);
let loadedImageIds = $state<Set<string>>(new Set());

const showLoadingSkeleton =
	coverImageConfig.randomCoverImage.showLoading ?? true;
const pendingCoverCache = new Map<string, string>();
let coverCacheHandle: number | null = null;
let coverCacheUsesIdleCallback = false;

const totalPages = $derived(
	Math.max(1, Math.ceil(posts.length / postsPerPage)),
);
const paginatedPosts = $derived(
	posts.slice((currentPage - 1) * postsPerPage, currentPage * postsPerPage),
);

function isArticleListView(
	value: string | null | undefined,
): value is ArticleListView {
	return value === "list" || value === "grid";
}

function flushCoverCache() {
	coverCacheHandle = null;
	for (const [postId, imageUrl] of pendingCoverCache) {
		try {
			sessionStorage.setItem(`cover_img_${postId}`, imageUrl);
		} catch {}
	}
	pendingCoverCache.clear();
}

function queueCoverCache(postId: string, imageUrl: string) {
	pendingCoverCache.set(postId, imageUrl);
	if (coverCacheHandle !== null) return;

	if ("requestIdleCallback" in window) {
		coverCacheUsesIdleCallback = true;
		coverCacheHandle = window.requestIdleCallback(flushCoverCache, {
			timeout: 1000,
		});
		return;
	}

	coverCacheUsesIdleCallback = false;
	coverCacheHandle = window.setTimeout(flushCoverCache, 200);
}

function markImageLoaded(image: HTMLImageElement, postId: string) {
	if (!image.classList.contains("is-loaded")) {
		image.classList.add("is-loaded");
		queueCoverCache(postId, image.currentSrc || image.src);
	}
	if (postId && !loadedImageIds.has(postId)) {
		loadedImageIds = new Set(loadedImageIds).add(postId);
	}
}

function handleImageLoad(event: Event, postId: string) {
	markImageLoaded(event.currentTarget as HTMLImageElement, postId);
}

function handleImageError(event: Event, apiUrls: string[]) {
	const image = event.currentTarget as HTMLImageElement;
	const nextIndex = Number(image.dataset.apiIndex || "0") + 1;

	if (nextIndex < apiUrls.length) {
		image.dataset.apiIndex = String(nextIndex);
		image.src = apiUrls[nextIndex];
		return;
	}

	const media = image.closest(".article-list-card__media");
	media?.classList.add("is-hidden");
	media?.closest(".article-list-card")?.classList.remove("has-image");
}

function handleLayoutChange(event: Event) {
	const layout = (event as CustomEvent<{ layout?: string }>).detail?.layout;
	if (!isArticleListView(layout) || layout === view) return;
	view = layout;
}

function goToPage(page: number) {
	const nextPage = Math.max(1, Math.min(totalPages, page));
	if (nextPage === currentPage) return;

	if (containerRef) {
		window.scrollTo(
			0,
			Math.max(0, window.scrollY + containerRef.getBoundingClientRect().top),
		);
	}

	requestAnimationFrame(() => {
		currentPage = nextPage;
	});
}

function generatePageNumbers(
	current: number,
	total: number,
): (number | string)[] {
	const delta = 2;
	const rangeWithDots: (number | string)[] = [];

	if (total <= 7) {
		for (let i = 1; i <= total; i++) rangeWithDots.push(i);
		return rangeWithDots;
	}

	const left = Math.max(2, current - delta);
	const right = Math.min(total - 1, current + delta);

	rangeWithDots.push(1);
	if (left > 2) rangeWithDots.push("...");
	for (let i = left; i <= right; i++) rangeWithDots.push(i);
	if (right < total - 1) rangeWithDots.push("...");
	if (total > 1) rangeWithDots.push(total);

	return rangeWithDots;
}

const pageNumbers = $derived(generatePageNumbers(currentPage, totalPages));

onMount(() => {
	try {
		const savedView = localStorage.getItem("postListLayout");
		if (isArticleListView(savedView)) view = savedView;
	} catch {}

	window.addEventListener("layoutChange", handleLayoutChange);
	if (
		umamiPageviews?.enabled &&
		umamiPageviews.apiBase &&
		umamiPageviews.shareId
	) {
		void getUmamiPageviewLookup(umamiPageviews)
			.then((lookup) => {
				pageviewLookup = lookup;
			})
			.catch(() => {
				pageviewLookup = new Map();
			});
	}
	const completedImageFrame = requestAnimationFrame(() => {
		for (const image of containerRef?.querySelectorAll<HTMLImageElement>(
			".article-list-card__image",
		) || []) {
			if (image.complete && image.naturalWidth > 0) {
				markImageLoaded(image, image.dataset.postId || "");
			}
		}
	});

	return () => {
		window.removeEventListener("layoutChange", handleLayoutChange);
		cancelAnimationFrame(completedImageFrame);
		if (coverCacheHandle !== null) {
			if (coverCacheUsesIdleCallback && "cancelIdleCallback" in window) {
				window.cancelIdleCallback(coverCacheHandle);
			} else {
				window.clearTimeout(coverCacheHandle);
			}
		}
		pendingCoverCache.clear();
	};
});
</script>

{#if posts.length === 0}
	<div class="article-list-empty">
		<span class="article-list-empty__title">暂无文章</span>
		<span class="article-list-empty__meta">新的内容会显示在这里。</span>
	</div>
{:else}
	<div
		class="article-list-virtual"
		data-view={view}
		bind:this={containerRef}
	>
		<p class="sr-only" aria-live="polite">
			第 {currentPage} 页，共 {totalPages} 页
		</p>
		<div class="article-list-collection" aria-label="文章列表">
			{#each paginatedPosts as post, index (post.id)}
				<article
					class="article-list-card"
					class:has-image={!!post.imageUrl}
					class:is-pinned={post.pinned}
					data-post-id={post.id}
				>
					<a
						href={post.url}
						class="article-list-card__link"
						aria-label={`查看文章：${post.title}`}
					>
						{#if post.imageUrl}
							<div
								class="article-list-card__media"
								class:skeleton-shimmer={showLoadingSkeleton && !loadedImageIds.has(post.id)}
								aria-hidden="true"
							>
								<picture>
									{#each post.imageSources as source (source.type)}
										<source
											type={source.type}
											srcset={source.srcset}
											sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 640px"
										/>
									{/each}
									<img
										class="article-list-card__image"
										src={post.imageUrl}
										alt=""
										width="640"
										height="360"
										loading={index < 3 ? "eager" : "lazy"}
										fetchpriority={index === 0 ? "high" : "auto"}
										decoding="async"
										data-api-index="0"
										data-post-id={post.id}
										referrerpolicy={post.imageReferrerPolicy || undefined}
										onload={(event) => handleImageLoad(event, post.id)}
										onerror={(event) => handleImageError(event, post.imageApiUrls)}
									/>
								</picture>
								<div class="article-list-card__media-overlay"></div>
							</div>
						{/if}

						<div class="article-list-card__content">
							{#if post.pinned}
								<span class="article-list-card__pinned">
									<Icon icon="material-symbols:pinboard" size="sm" />
									<span>{i18n(I18nKey.pinned)}</span>
								</span>
							{/if}

							<h2 class="article-list-card__title">
								{post.title}
								{#if post.password}
									<span class="article-list-card__lock" aria-hidden="true">
										<Icon icon="material-symbols:lock-outline" size="sm" />
									</span>
									<span class="sr-only">加密文章</span>
								{/if}
							</h2>

							<p class="article-list-card__description">{post.description}</p>

							<div class="article-list-card__meta">
								<span class="article-list-card__meta-item">
									<Icon icon="material-symbols:calendar-month-rounded" size="sm" />
									<time datetime={post.publishedIso}>{post.publishedText}</time>
								</span>
								{#if umamiPageviews?.enabled}
									<span class="article-list-card__meta-item" title="浏览量">
										<Icon icon="material-symbols:visibility-outline-rounded" size="sm" />
										<span>
											{pageviewLookup === null
												? "—"
												: (pageviewLookup.get(normalizeUmamiPageviewPath(post.url)) || 0).toLocaleString()}
										</span>
										<span class="sr-only">浏览量</span>
									</span>
								{/if}
								<span class="article-list-card__category">#{post.category}</span>
								{#each post.tags.slice(0, 2) as tag (tag.name)}
									<span class="article-list-card__divider" aria-hidden="true">/</span>
									<span class="article-list-card__tag">{tag.name}</span>
								{/each}
								{#if post.tags.length > 2}
									<span class="article-list-card__tag-more">
										<span class="sr-only">另有</span>+{post.tags.length - 2}
									</span>
								{/if}
							</div>
						</div>
					</a>
				</article>
			{/each}
		</div>
	</div>

	{#if totalPages > 1}
		<nav class="article-list-pagination" aria-label="文章分页">
			<div class="article-list-pagination__inner">
				<button
					type="button"
					class="article-list-pagination__btn"
					disabled={currentPage === 1}
					aria-label="上一页"
					onclick={() => goToPage(currentPage - 1)}
				>
					<Icon icon="material-symbols:chevron-left-rounded" class="text-[1.75rem]" />
				</button>

				<div class="article-list-pagination__pages">
					{#each pageNumbers as pageItem, pageIndex (`${pageItem}-${pageIndex}`)}
						{#if pageItem === "..."}
							<span class="article-list-pagination__dots" aria-hidden="true">
								<Icon icon="material-symbols:more-horiz" />
							</span>
						{:else}
							<button
								type="button"
								class="article-list-pagination__page"
								class:is-active={pageItem === currentPage}
								aria-label={`第 ${pageItem} 页`}
								aria-current={pageItem === currentPage ? "page" : undefined}
								onclick={() => goToPage(pageItem as number)}
							>
								{pageItem}
							</button>
						{/if}
					{/each}
				</div>

				<button
					type="button"
					class="article-list-pagination__btn"
					disabled={currentPage === totalPages}
					aria-label="下一页"
					onclick={() => goToPage(currentPage + 1)}
				>
					<Icon icon="material-symbols:chevron-right-rounded" class="text-[1.75rem]" />
				</button>
			</div>
		</nav>
	{/if}
{/if}
