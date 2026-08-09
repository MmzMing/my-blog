<script lang="ts">
import { ExternalLink, Send } from "lucide-svelte";
import { onMount, tick } from "svelte";
import {
	buildFriendLayout,
	type FriendTilePlacement,
} from "@/utils/friend-layout";
import type { FriendLink } from "@/types/config";

interface Props {
	items: FriendLink[];
	allLabel?: string;
	applyEnabled?: boolean;
}

let { items, allLabel = "全部", applyEnabled = false }: Props = $props();

let activeTag = $state("all");
let tabsPill = $state<HTMLElement | null>(null);
let indicatorStyle = $state("opacity: 0;");
let columnCount = $state(1);
let isMounted = $state(false);
let layoutItems = $state<FriendTilePlacement[]>(
	buildFriendLayout(items, 1, () => 0),
);
let tags = $derived(
	Array.from(new Set(items.flatMap((item) => item.tags ?? []))).sort((a, b) =>
		a.localeCompare(b),
	),
);
let filteredItems = $derived(
	activeTag === "all"
		? items
		: items.filter((friend) => (friend.tags ?? []).includes(activeTag)),
);

function updateTabIndicator(): void {
	const activeButton = tabsPill?.querySelector<HTMLButtonElement>("button.active");
	if (!activeButton) return;

	indicatorStyle = [
		`left: ${activeButton.offsetLeft}px`,
		`top: ${activeButton.offsetTop}px`,
		`width: ${activeButton.offsetWidth}px`,
		`height: ${activeButton.offsetHeight}px`,
		"opacity: 1",
	].join("; ");
}

$effect(() => {
	activeTag;
	tags;
	void tick().then(updateTabIndicator);
});

function itemsForTag(tag: string): FriendLink[] {
	return tag === "all"
		? items
		: items.filter((friend) => (friend.tags ?? []).includes(tag));
}

function getColumnCount(): number {
	if (window.innerWidth <= 640) return 1;
	if (window.innerWidth <= 1024) return 2;
	return 3;
}

function rebuildLayout(nextItems: readonly FriendLink[], columns: number): void {
	layoutItems = isMounted
		? buildFriendLayout(nextItems, columns)
		: buildFriendLayout(nextItems, 1, () => 0);
}

function selectTag(tag: string): void {
	activeTag = tag;
	rebuildLayout(itemsForTag(tag), columnCount);
}

function handleViewportResize(): void {
	const nextColumnCount = getColumnCount();
	if (nextColumnCount === columnCount) return;

	columnCount = nextColumnCount;
	rebuildLayout(filteredItems, nextColumnCount);
}

onMount(() => {
	const tabsObserver =
		typeof ResizeObserver === "undefined"
			? undefined
			: new ResizeObserver(updateTabIndicator);
	if (tabsPill) tabsObserver?.observe(tabsPill);

	columnCount = getColumnCount();
	isMounted = true;
	rebuildLayout(filteredItems, columnCount);
	updateTabIndicator();
	window.addEventListener("resize", handleViewportResize, { passive: true });

	return () => {
		tabsObserver?.disconnect();
		window.removeEventListener("resize", handleViewportResize);
	};
});

function initialOf(title: string): string {
	return Array.from(title.trim())[0] ?? "?";
}

function formatSiteUrl(url: string): string {
	try {
		const parsed = new URL(url);
		const path = parsed.pathname === "/" ? "" : parsed.pathname;
		return `${parsed.host}${path}${parsed.search}`;
	} catch {
		return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
	}
}

function handleAvatarError(event: Event): void {
	const image = event.currentTarget as HTMLImageElement;
	image.hidden = true;
	image.nextElementSibling?.removeAttribute("hidden");
}

function placementStyle(placement: FriendTilePlacement): string {
	return [
		`grid-column: ${placement.column} / span ${placement.columnSpan}`,
		`grid-row: ${placement.row} / span ${placement.rowSpan}`,
	].join("; ");
}
</script>

<section class="friend-links" aria-label="友链列表">
	<header class="friend-toolbar">
		<nav class="friend-tabs" aria-label="友链类型筛选">
			<div class="friend-tabs-pill" bind:this={tabsPill}>
				<span class="friend-tab-indicator" aria-hidden="true" style={indicatorStyle}></span>
				<button
					type="button"
					class:active={activeTag === "all"}
					aria-pressed={activeTag === "all"}
					onclick={() => selectTag("all")}
				>
					<span>{allLabel}</span>
					<span class="friend-tab-count">{items.length}</span>
				</button>
				{#each tags as tag (tag)}
					<button
						type="button"
						class:active={activeTag === tag}
						aria-pressed={activeTag === tag}
						onclick={() => selectTag(tag)}
					>
						<span>{tag}</span>
						<span class="friend-tab-count">
							{items.filter((friend) => (friend.tags ?? []).includes(tag)).length}
						</span>
					</button>
				{/each}
			</div>
		</nav>

		{#if applyEnabled}
			<button type="button" class="friend-apply" data-open-friend-rules>
				<Send size={16} strokeWidth={2} aria-hidden="true" />
				<span>申请友链</span>
			</button>
		{/if}
	</header>

	<div class="friend-grid" role="list">
		{#each layoutItems as placement (placement.friend.siteurl)}
			<a
				class={`friend-card friend-card--${placement.kind}`}
				data-layout={placement.kind}
				style={placementStyle(placement)}
				href={placement.friend.siteurl}
				target="_blank"
				rel="noopener noreferrer"
				role="listitem"
			>
				<span class="friend-card-layout">
					<span class="friend-avatar">
						<img
							src={placement.friend.imgurl}
							alt={`${placement.friend.title}头像`}
							loading="lazy"
							decoding="async"
							onerror={handleAvatarError}
						/>
						<span class="friend-avatar-fallback" aria-hidden="true" hidden>
							{initialOf(placement.friend.title)}
						</span>
					</span>

					<span class="friend-card-info">
						<span class="friend-card-title-row">
							<strong>{placement.friend.title}</strong>
							<span class="friend-card-jump" aria-hidden="true">
								<ExternalLink size={16} strokeWidth={2} />
							</span>
						</span>
						<span class="friend-card-desc" title={placement.friend.desc}>
							{placement.friend.desc}
						</span>
					</span>

					<span class="friend-card-divider" aria-hidden="true"></span>

					<span class="friend-card-footer">
						<span
							class="friend-card-type"
							title={placement.friend.tags?.join("、") || "未分类"}
						>
							{placement.friend.tags?.join("、") || "未分类"}
						</span>
						<span class="friend-card-separator" aria-hidden="true">/</span>
						<span class="friend-card-url" title={placement.friend.siteurl}>
							{formatSiteUrl(placement.friend.siteurl)}
						</span>
					</span>
				</span>
			</a>
		{/each}

		{#if filteredItems.length === 0}
			<div class="friend-empty" role="status">
				<strong>当前分类没有友链</strong>
				<span>请选择其他博客类型查看</span>
			</div>
		{/if}
	</div>
</section>

<style>
	.friend-links {
		--friend-ink: #000000;
		--friend-paper: #ffffff;
		--friend-muted: #525252;
		--friend-line: #d4d4d4;
		--friend-grid-gap: 1rem;
		--friend-tile-row: 10.25rem;
		position: relative;
		width: 100%;
		color: var(--friend-ink);
	}

	:global(.dark) .friend-links {
		--friend-ink: #ffffff;
		--friend-paper: #000000;
		--friend-muted: #a3a3a3;
		--friend-line: #404040;
	}

	.friend-toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 1rem;
	}

	.friend-tabs {
		min-width: 0;
		position: relative;
		z-index: 0;
	}

	.friend-tabs-pill {
		position: relative;
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
		padding: 0.375rem;
		border: 1.5px solid var(--friend-ink);
		border-radius: 1rem;
	}

	.friend-tab-indicator {
		position: absolute;
		z-index: 0;
		border-radius: 9999px;
		background: var(--friend-ink);
		pointer-events: none;
		transition: left 300ms cubic-bezier(0.4, 0, 0.2, 1),
			top 300ms cubic-bezier(0.4, 0, 0.2, 1),
			width 300ms cubic-bezier(0.4, 0, 0.2, 1),
			height 300ms cubic-bezier(0.4, 0, 0.2, 1);
	}

	.friend-tabs-pill button {
		position: relative;
		z-index: 1;
		display: inline-flex;
		min-height: 2.25rem;
		align-items: center;
		justify-content: center;
		gap: 0.375rem;
		padding: 0.375rem 0.875rem;
		color: var(--friend-ink);
		background: transparent;
		border: 0;
		border-radius: 9999px;
		font-size: 0.8125rem;
		font-weight: 650;
		line-height: 1.2;
		white-space: nowrap;
		cursor: pointer;
		transition: color 200ms ease, opacity 200ms ease;
	}

	.friend-tabs-pill button:hover {
		opacity: 0.7;
	}

	.friend-tabs-pill button.active {
		color: var(--friend-paper);
		background: transparent;
		cursor: default;
	}

	.friend-tabs-pill button.active:hover {
		opacity: 1;
	}

	.friend-tab-count {
		min-width: 1.2rem;
		padding: 0.08rem 0.35rem;
		color: var(--friend-ink);
		background: color-mix(in oklab, var(--friend-ink) 12%, transparent);
		border-radius: 9999px;
		font-size: 0.65rem;
		font-weight: 700;
		line-height: 1.35;
		text-align: center;
	}

	.friend-tabs-pill button.active .friend-tab-count {
		color: var(--friend-ink);
		background: var(--friend-paper);
	}

	.friend-apply {
		display: inline-flex;
		min-height: 2.75rem;
		flex: 0 0 auto;
		align-items: center;
		justify-content: center;
		gap: 0.45rem;
		padding: 0.5rem 0.9rem;
		color: var(--friend-ink);
		background: transparent;
		border: 2px solid var(--friend-ink);
		border-radius: 0.7rem;
		font-size: 0.8125rem;
		font-weight: 750;
		cursor: pointer;
		transition: color 200ms ease, background-color 200ms ease;
	}

	.friend-apply:hover {
		color: var(--friend-paper);
		background: var(--friend-ink);
	}

	.friend-tabs-pill button:focus-visible,
	.friend-apply:focus-visible,
	.friend-card:focus-visible {
		outline: 3px solid var(--friend-ink);
		outline-offset: 3px;
	}

	.friend-grid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		grid-auto-rows: var(--friend-tile-row);
		align-items: stretch;
		gap: var(--friend-grid-gap);
	}

	.friend-card {
		position: relative;
		display: grid;
		min-width: 0;
		min-height: var(--friend-tile-row);
		height: 100%;
		box-sizing: border-box;
		padding: 1.25rem;
		color: var(--friend-ink);
		background: transparent;
		border: 2px solid var(--friend-ink);
		border-radius: 0.75rem;
		text-decoration: none;
		transition: none;
	}

	.friend-card--vertical {
		min-height: calc(var(--friend-tile-row) * 2 + var(--friend-grid-gap));
	}

	.friend-card:hover,
	.friend-card:focus-visible {
		z-index: 10;
	}

	.friend-card-layout {
		display: grid;
		grid-template-columns: 4.5rem minmax(0, 1fr);
		grid-template-rows: auto auto auto;
		align-items: start;
		column-gap: 1rem;
		min-width: 0;
		min-height: 0;
		height: 100%;
	}

	.friend-avatar {
		display: grid;
		width: 4.5rem;
		height: 4.5rem;
		grid-column: 1;
		grid-row: 1;
		flex: 0 0 auto;
		place-items: center;
		color: var(--friend-muted);
		background: transparent;
		border: 0;
		border-radius: 0.75rem;
		overflow: hidden;
	}

	.friend-avatar img {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: contain;
		border-radius: inherit;
	}

	.friend-avatar-fallback {
		font-size: 1.5rem;
		font-weight: 800;
		line-height: 1;
	}

	.friend-card-info {
		display: flex;
		min-width: 0;
		min-height: 4.5rem;
		grid-column: 2;
		grid-row: 1;
		flex-direction: column;
	}

	.friend-card-title-row {
		display: flex;
		min-width: 0;
		min-height: 1.75rem;
		align-items: center;
		gap: 0.5rem;
	}

	.friend-card-title-row strong {
		min-width: 0;
		flex: 1;
		overflow: hidden;
		font-size: 1rem;
		font-weight: 800;
		line-height: 1.35;
		text-overflow: ellipsis;
		white-space: nowrap;
		transition: transform 300ms ease;
	}

	.friend-card:hover .friend-card-title-row strong,
	.friend-card:focus-visible .friend-card-title-row strong {
		transform: translateX(0.25rem);
	}

	.friend-card-jump {
		display: grid;
		width: 1.5rem;
		height: 1.5rem;
		flex: 0 0 auto;
		place-items: center;
		color: var(--friend-ink);
		opacity: 0;
		transform: translateX(-0.25rem);
		transition: opacity 250ms cubic-bezier(0.4, 0, 0.2, 1),
			transform 250ms cubic-bezier(0.4, 0, 0.2, 1);
	}

	.friend-card:hover .friend-card-jump,
	.friend-card:focus-visible .friend-card-jump {
		opacity: 1;
		transform: translateX(0);
	}

	.friend-card-desc {
		display: -webkit-box;
		height: calc(1.5em * 2);
		min-height: calc(1.5em * 2);
		margin: 0.75rem 0 0;
		color: var(--friend-muted);
		font-size: 0.875rem;
		line-height: 1.5;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.friend-card-divider {
		display: block;
		width: 100%;
		height: 1px;
		grid-column: 1 / -1;
		grid-row: 2;
		margin: 0.75rem 0 0.625rem;
		background: var(--friend-line);
	}

	.friend-card-footer {
		display: flex;
		min-width: 0;
		grid-column: 1 / -1;
		grid-row: 3;
		align-items: center;
		gap: 0.5rem;
		color: var(--friend-muted);
		font-size: 0.72rem;
	}

	.friend-card-type,
	.friend-card-url {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.friend-card-type {
		max-width: 40%;
		font-weight: 700;
	}

	.friend-card-separator {
		flex: 0 0 auto;
		color: var(--friend-line);
	}

	.friend-card-url {
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
	}

	.friend-card--horizontal .friend-card-layout {
		grid-template-columns: 6.5rem minmax(0, 1fr);
		grid-template-rows: minmax(0, 1fr) auto auto;
		column-gap: 1rem;
	}

	.friend-card--horizontal .friend-avatar {
		width: 6.5rem;
		height: 6.5rem;
		grid-row: 1 / -1;
		align-self: start;
	}

	.friend-card--horizontal .friend-avatar img {
		object-fit: cover;
	}

	.friend-card--horizontal .friend-card-info {
		min-height: 0;
		grid-column: 2;
		grid-row: 1;
	}

	.friend-card--horizontal .friend-card-divider {
		grid-column: 2;
		grid-row: 2;
	}

	.friend-card--horizontal .friend-card-footer {
		grid-column: 2;
		grid-row: 3;
	}

	.friend-card--vertical .friend-card-layout {
		grid-template-columns: minmax(0, 1fr);
		grid-template-rows: auto auto minmax(0, 1fr) auto auto;
		column-gap: 0;
		align-items: stretch;
	}

	.friend-card--vertical .friend-avatar {
		width: 9rem;
		height: 9rem;
		grid-column: 1 / -1;
		grid-row: 1;
		justify-self: center;
		margin-bottom: 0.75rem;
	}

	.friend-card--vertical .friend-card-info {
		display: contents;
	}

	.friend-card--vertical .friend-card-title-row {
		grid-column: 1;
		grid-row: 2;
		min-height: 0;
		align-items: center;
		justify-content: center;
		gap: 0;
		overflow: visible;
	}

	.friend-card--vertical .friend-card-title-row strong {
		max-width: 100%;
		font-size: 1.05rem;
		line-height: 1.4;
		text-align: center;
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	.friend-card--vertical .friend-card-jump {
		display: grid;
		position: absolute;
		top: 1rem;
		right: 1rem;
		z-index: 1;
		pointer-events: none;
		opacity: 0;
		transform: translateY(-0.25rem);
	}

	.friend-card--vertical:hover .friend-card-jump,
	.friend-card--vertical:focus-visible .friend-card-jump {
		opacity: 1;
		transform: translateY(0);
	}

	.friend-card--vertical .friend-card-desc {
		display: -webkit-box;
		grid-column: 1;
		grid-row: 3;
		height: auto;
		min-height: 0;
		margin: 0.75rem 0 0;
		max-width: 100%;
		max-height: calc(1.5em * 3);
		line-height: 1.5;
		line-clamp: 3;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 3;
		text-align: center;
		text-overflow: ellipsis;
	}

	.friend-card--vertical .friend-card-title-row strong,
	.friend-card--vertical .friend-card-desc {
		overflow: hidden;
	}

	.friend-card--vertical .friend-card-title-row strong,
	.friend-card--vertical:hover .friend-card-title-row strong,
	.friend-card--vertical:focus-visible .friend-card-title-row strong {
		transform: none;
	}

	.friend-card--vertical .friend-card-divider {
		grid-column: 1 / -1;
		grid-row: 4;
	}

	.friend-card--vertical .friend-card-footer {
		grid-column: 1 / -1;
		grid-row: 5;
	}

	.friend-empty {
		display: flex;
		min-height: 10rem;
		grid-column: 1 / -1;
		align-items: center;
		justify-content: center;
		flex-direction: column;
		gap: 0.35rem;
		padding: 2rem;
		color: var(--friend-muted);
		border: 2px dashed var(--friend-ink);
		border-radius: 0.75rem;
		text-align: center;
	}

	.friend-empty strong {
		color: var(--friend-ink);
		font-size: 0.95rem;
	}

	@media (max-width: 1024px) {
		.friend-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}

	@media (max-width: 640px) {
		.friend-toolbar {
			align-items: stretch;
			flex-direction: column;
		}

		.friend-tabs-pill {
			width: 100%;
		}

		.friend-tabs-pill button {
			flex: 1 1 auto;
		}

		.friend-apply {
			width: 100%;
		}

		.friend-grid {
			grid-template-columns: 1fr;
			grid-auto-rows: auto;
		}

		.friend-card,
		.friend-card--horizontal,
		.friend-card--vertical {
			grid-column: auto !important;
			grid-row: auto !important;
			min-height: 0;
			height: auto;
		}

		.friend-card--horizontal .friend-card-layout,
		.friend-card--vertical .friend-card-layout {
			grid-template-columns: 4.5rem minmax(0, 1fr);
			grid-template-rows: auto auto auto;
			column-gap: 1rem;
			height: auto;
		}

		.friend-card--horizontal .friend-avatar,
		.friend-card--vertical .friend-avatar {
			width: 4.5rem;
			height: 4.5rem;
			min-height: 0;
			grid-column: 1;
			grid-row: 1;
			justify-self: auto;
			align-self: start;
			margin-bottom: 0;
		}

		.friend-card--horizontal .friend-avatar img {
			object-fit: contain;
		}

		.friend-card--horizontal .friend-card-info,
		.friend-card--vertical .friend-card-info {
			display: flex;
			min-height: 4.5rem;
			grid-column: 2;
			grid-row: 1;
		}

		.friend-card--vertical .friend-card-title-row,
		.friend-card--vertical .friend-card-desc {
			grid-column: auto;
			grid-row: auto;
			max-width: none;
			max-height: none;
			writing-mode: horizontal-tb;
			text-orientation: mixed;
		}

		.friend-card--vertical .friend-card-title-row {
			min-height: 1.75rem;
			align-items: center;
			justify-content: flex-start;
			gap: 0.5rem;
			overflow: visible;
		}

		.friend-card--vertical .friend-card-title-row strong {
			max-width: none;
			max-height: none;
			font-size: 1rem;
			line-height: 1.35;
			white-space: nowrap;
			text-overflow: ellipsis;
			transform: none;
		}

		.friend-card--vertical .friend-card-jump {
			display: grid;
			position: static;
			top: auto;
			right: auto;
			z-index: auto;
			pointer-events: auto;
			transform: translateX(-0.25rem);
		}

		.friend-card--vertical:hover .friend-card-jump,
		.friend-card--vertical:focus-visible .friend-card-jump {
			transform: translateX(0);
		}

		.friend-card--vertical .friend-card-desc {
			display: -webkit-box;
			height: calc(1.5em * 2);
			min-height: calc(1.5em * 2);
			margin: 0.75rem 0 0;
			line-clamp: 2;
			-webkit-box-orient: vertical;
			-webkit-line-clamp: 2;
		}

		.friend-card--horizontal .friend-card-divider,
		.friend-card--vertical .friend-card-divider {
			grid-column: 1 / -1;
			grid-row: 2;
		}

		.friend-card--horizontal .friend-card-footer,
		.friend-card--vertical .friend-card-footer {
			grid-column: 1 / -1;
			grid-row: 3;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.friend-tabs-pill button,
		.friend-apply,
		.friend-card-jump,
		.friend-card-title-row strong {
			transition-duration: 0.01ms;
		}
	}
</style>
