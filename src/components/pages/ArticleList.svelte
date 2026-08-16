<script lang="ts">
import { onMount } from "svelte";
import Icon from "@/components/common/Icon.svelte";
import I18nKey from "@/i18n/i18nKey";
import { i18n } from "@/i18n/translation";
import {
	createEmptyUmamiPageviewLookup,
	getUmamiPageviewLookup,
	normalizeUmamiPageviewPath,
} from "@/utils/umami-pageviews";

type ArticleSort = "latest" | "earliest" | "popular";

type ArticleListTag = {
	name: string;
	url: string;
};

export type ArticleListPost = {
	id: string;
	title: string;
	url: string;
	publishedIso: string;
	publishedTimestamp: number;
	publishedText: string;
	category: string;
	categoryUrl: string;
	tags: ArticleListTag[];
	description: string;
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
	postsPerPage?: number;
	umamiPageviews?: UmamiPageviewConfig;
}

let { posts, postsPerPage = 15, umamiPageviews }: Props = $props();

let containerRef = $state<HTMLElement | null>(null);
let sortMode = $state<ArticleSort>("latest");
let currentPage = $state(1);
let pageviewLookup = $state<Map<string, number> | null>(null);

const pinnedPosts = $derived(
	posts
		.filter((post) => post.pinned)
		.sort((a, b) => b.publishedTimestamp - a.publishedTimestamp),
);
const regularPosts = $derived(
	posts
		.filter((post) => !post.pinned)
		.sort((a, b) => {
			if (sortMode === "popular") {
				const aViews =
					pageviewLookup?.get(normalizeUmamiPageviewPath(a.url)) ?? -1;
				const bViews =
					pageviewLookup?.get(normalizeUmamiPageviewPath(b.url)) ?? -1;
				return bViews - aViews || b.publishedTimestamp - a.publishedTimestamp;
			}
			const difference = b.publishedTimestamp - a.publishedTimestamp;
			return sortMode === "latest" ? difference : -difference;
		}),
);
const totalPages = $derived(
	Math.max(1, Math.ceil(regularPosts.length / postsPerPage)),
);
const paginatedPosts = $derived(
	regularPosts.slice(
		(currentPage - 1) * postsPerPage,
		currentPage * postsPerPage,
	),
);

function getCategoryHue(category: string): number {
	let hash = 2166136261;
	for (let index = 0; index < category.length; index++) {
		hash ^= category.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0) % 360;
}

function getPageviews(post: ArticleListPost): string {
	if (!umamiPageviews?.enabled || pageviewLookup === null) return "—";
	return (
		pageviewLookup.get(normalizeUmamiPageviewPath(post.url)) || 0
	).toLocaleString();
}

function scrollToListTop() {
	if (!containerRef) return;
	window.scrollTo(
		0,
		Math.max(0, window.scrollY + containerRef.getBoundingClientRect().top),
	);
}

function changeSort(nextSort: ArticleSort) {
	if (nextSort === sortMode) return;
	sortMode = nextSort;
	currentPage = 1;
	requestAnimationFrame(scrollToListTop);
}

function goToPage(page: number) {
	const nextPage = Math.max(1, Math.min(totalPages, page));
	if (nextPage === currentPage) return;
	currentPage = nextPage;
	requestAnimationFrame(scrollToListTop);
}

function generatePageNumbers(
	current: number,
	total: number,
): (number | string)[] {
	if (total <= 7) {
		return Array.from({ length: total }, (_, index) => index + 1);
	}

	const rangeWithDots: (number | string)[] = [1];
	const left = Math.max(2, current - 2);
	const right = Math.min(total - 1, current + 2);

	if (left > 2) rangeWithDots.push("...");
	for (let page = left; page <= right; page++) rangeWithDots.push(page);
	if (right < total - 1) rangeWithDots.push("...");
	rangeWithDots.push(total);

	return rangeWithDots;
}

const pageNumbers = $derived(generatePageNumbers(currentPage, totalPages));

onMount(() => {
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
				pageviewLookup = createEmptyUmamiPageviewLookup();
			});
	}
});
</script>

{#snippet articleMeta(post: ArticleListPost)}
	<div class="article-list-card__meta">
		<a
			href={post.categoryUrl}
			class="article-list-card__category article-list-card__meta-link"
			style={`--article-category-hue: ${getCategoryHue(post.category)}`}
			aria-label={`${i18n(I18nKey.viewCategoryArchivePrefix)}${post.category}`}
		>
			{post.category}
		</a>
		<span class="article-list-card__meta-divider" aria-hidden="true">/</span>
		<span class="article-list-card__meta-item">
			<Icon icon="material-symbols:calendar-month-rounded" size="sm" />
			<span class="sr-only">{i18n(I18nKey.publishDatePrefix)}</span>
			<time datetime={post.publishedIso}>{post.publishedText}</time>
		</span>
		<span class="article-list-card__meta-divider" aria-hidden="true">/</span>
		<span class="article-list-card__meta-item" title={i18n(I18nKey.viewsLabel)}>
			<Icon icon="material-symbols:visibility-outline-rounded" size="sm" />
			<span class="sr-only">{i18n(I18nKey.viewsLabel)}</span>
			<span>{getPageviews(post)}</span>
		</span>
		{#each post.tags.slice(0, 3) as tag (tag.name)}
			<span class="article-list-card__meta-divider" aria-hidden="true">/</span>
			<a
				href={tag.url}
				class="article-list-card__tag article-list-card__meta-link"
				aria-label={`${i18n(I18nKey.viewTagArchivePrefix)}${tag.name}`}
			>
				{tag.name}
			</a>
		{/each}
		{#if post.tags.length > 3}
			<span class="article-list-card__meta-divider" aria-hidden="true">/</span>
			<span class="article-list-card__tag-more">
					<span class="sr-only">{i18n(I18nKey.moreTagsPrefix)}{post.tags.length - 3}{i18n(I18nKey.moreTagsSuffix)}</span>+{post.tags.length - 3}{i18n(I18nKey.moreTagsSuffix)}
				</span>
		{/if}
	</div>
{/snippet}

{#snippet articleCard(post: ArticleListPost, variant: "pinned" | "regular")}
	<article class={`article-list-card article-list-card--${variant}`}>
		<div class="article-list-card__body">
			{#if variant === "pinned"}
				<div class="article-list-card__pinned">
					<Icon icon="material-symbols:pinboard" size="sm" />
					<span>{i18n(I18nKey.pinned)}</span>
				</div>
			{/if}

			<h3 class="article-list-card__title">
				<a
					href={post.url}
					class="article-list-card__article-link"
					aria-label={`${i18n(I18nKey.viewPostPrefix)}${post.title}`}
				>
					{post.title}
					{#if post.password}
						<span class="article-list-card__lock" aria-hidden="true">
							<Icon icon="material-symbols:lock-outline" size="sm" />
						</span>
						<span class="sr-only">{i18n(I18nKey.encryptedPost)}</span>
					{/if}
				</a>
			</h3>

			<p class="article-list-card__description">{post.description}</p>
			{#if variant === "pinned"}
				<div class="article-list-card__rule" aria-hidden="true"></div>
			{/if}
			{@render articleMeta(post)}
		</div>
	</article>
{/snippet}

<div class="article-list" bind:this={containerRef}>
	{#if currentPage === 1 && pinnedPosts.length > 0}
		<section class="article-list-pinned" aria-labelledby="article-list-pinned-title">
			<h2 id="article-list-pinned-title" class="sr-only">{i18n(I18nKey.pinnedPosts)}</h2>
			<div class="article-list-pinned__collection">
				{#each pinnedPosts as post (post.id)}
					{@render articleCard(post, "pinned")}
				{/each}
			</div>
		</section>
	{/if}

	<header class="article-list-toolbar">
		<div
			class="article-list-toolbar__total"
			aria-label={`${i18n(I18nKey.totalPostsPrefix)} ${posts.length} ${i18n(posts.length === 1 ? I18nKey.postCount : I18nKey.postsCount)}`}
		>
			<span>{i18n(I18nKey.totalPostsPrefix)}</span>
			<strong>{posts.length}</strong>
			<span>{i18n(posts.length === 1 ? I18nKey.postCount : I18nKey.postsCount)}</span>
		</div>
		<div class="article-list-toolbar__sort" aria-label={i18n(I18nKey.sortPosts)}>
			<button
				type="button"
				class:is-active={sortMode === "latest"}
				aria-pressed={sortMode === "latest"}
				onclick={() => changeSort("latest")}
			>
				{i18n(I18nKey.sortLatest)}
			</button>
			<button
				type="button"
				class:is-active={sortMode === "earliest"}
				aria-pressed={sortMode === "earliest"}
				onclick={() => changeSort("earliest")}
			>
				{i18n(I18nKey.sortOldest)}
			</button>
			<button
				type="button"
				class:is-active={sortMode === "popular"}
				aria-pressed={sortMode === "popular"}
				onclick={() => changeSort("popular")}
			>
				{i18n(I18nKey.sortPopular)}
			</button>
		</div>
	</header>

	<p class="sr-only" aria-live="polite">
		{i18n(I18nKey.sortByPrefix)}{sortMode === "latest" ? i18n(I18nKey.sortLatest) : sortMode === "popular" ? i18n(I18nKey.sortPopular) : i18n(I18nKey.sortOldest)}{i18n(I18nKey.sortBySuffix)}，{i18n(I18nKey.paginationPage)} {currentPage} {i18n(I18nKey.paginationOf)} {totalPages} {i18n(I18nKey.bangumiPage)}
	</p>

	<section class="article-list-regular" aria-labelledby="article-list-regular-title">
		<h2 id="article-list-regular-title" class="sr-only">{i18n(I18nKey.regularPosts)}</h2>
		{#if paginatedPosts.length > 0}
			<div class="article-list-regular__collection">
				{#each paginatedPosts as post (post.id)}
					{@render articleCard(post, "regular")}
				{/each}
			</div>
		{:else}
			<div class="article-list-empty">
				<span class="article-list-empty__title">{i18n(I18nKey.noRegularPosts)}</span>
				<span class="article-list-empty__meta">{i18n(I18nKey.noPostsHint)}</span>
			</div>
		{/if}
	</section>

	{#if totalPages > 1}
		<nav class="article-list-pagination" aria-label={i18n(I18nKey.paginationNav)}>
			<div class="article-list-pagination__inner">
				<button
					type="button"
					class="article-list-pagination__btn"
					disabled={currentPage === 1}
					aria-label={i18n(I18nKey.paginationPrev)}
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
								aria-label={`${i18n(I18nKey.paginationPage)} ${pageItem} ${i18n(I18nKey.bangumiPage)}`}
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
					aria-label={i18n(I18nKey.paginationNext)}
					onclick={() => goToPage(currentPage + 1)}
				>
					<Icon icon="material-symbols:chevron-right-rounded" class="text-[1.75rem]" />
				</button>
			</div>
		</nav>
	{/if}
</div>
