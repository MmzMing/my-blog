<script lang="ts">
import { navigateToPage } from "@utils/navigation-utils";
import { onMount, tick } from "svelte";
import type { SearchResult } from "@/global";
import I18nKey from "@/i18n/i18nKey";
import { i18n } from "@/i18n/translation";
import { bindSearchModalController } from "@/utils/search-modal-controller";
import { url as formatUrl, getSearchUrl } from "@/utils/url-utils";

// --- Props ---
const { placeholders = [] }: { placeholders?: string[] } = $props();

// --- State ---
let keyword = $state("");
let result = $state<SearchResult[]>([]);
let isSearching = $state(false);
let initialized = $state(false);
let visible = $state(false);
let animating = $state(false);
let debounceTimer: NodeJS.Timeout;

// --- Refs ---
let inputEl: HTMLInputElement;
let canvasEl: HTMLCanvasElement;
let modalEl: HTMLDivElement;
let newDataRef: { x: number; y: number; r: number; color: string }[] = [];
let vanishInProgress = false;

// --- Placeholder cycling ---
let currentPlaceholder = $state(0);
let intervalRef: ReturnType<typeof setInterval> | null = null;

function startPlaceholderAnimation() {
	intervalRef = setInterval(() => {
		currentPlaceholder = (currentPlaceholder + 1) % placeholders.length;
	}, 3000);
}

function stopPlaceholderAnimation() {
	if (intervalRef) {
		clearInterval(intervalRef);
		intervalRef = null;
	}
}

// --- Mocks for Dev Mode ---
const fakeResult: SearchResult[] = [
	{
		url: formatUrl("/"),
		meta: { title: "This Is a Fake Search Result" },
		excerpt:
			"Because Pagefind cannot work in the <mark>dev</mark> environment.",
	},
	{
		url: formatUrl("/"),
		meta: { title: "If You Want to Test the Search" },
		excerpt: "Try running <mark>npm build && npm preview</mark> instead.",
	},
];

// --- Core Search Logic ---
async function doSearch(kw: string) {
	if (!kw) {
		result = [];
		return;
	}
	if (!initialized) return;

	isSearching = true;

	try {
		let searchResults: SearchResult[] = [];
		if (import.meta.env.PROD && window.pagefind) {
			const response = await window.pagefind.search(kw);
			searchResults = await Promise.all(
				response.results.map((item) => item.data()),
			);
		} else if (import.meta.env.DEV) {
			searchResults = fakeResult;
		}
		result = searchResults;
	} catch (error) {
		console.error("Search error:", error);
		result = [];
	} finally {
		isSearching = false;
	}
}

// --- Vanish animation (canvas pixel particles) ---
function draw() {
	if (!inputEl || !canvasEl) return;
	const ctx = canvasEl.getContext("2d");
	if (!ctx) return;

	canvasEl.width = 800;
	canvasEl.height = 800;
	ctx.clearRect(0, 0, 800, 800);

	const computedStyles = getComputedStyle(inputEl);
	const fontSize = Number.parseFloat(
		computedStyles.getPropertyValue("font-size"),
	);
	ctx.font = `${fontSize * 2}px ${computedStyles.fontFamily}`;
	ctx.fillStyle = "#FFF";
	ctx.fillText(keyword, 16, 40);

	const imageData = ctx.getImageData(0, 0, 800, 800);
	const pixelData = imageData.data;
	const newData: { x: number; y: number; color: number[] }[] = [];

	for (let t = 0; t < 800; t++) {
		const i = 4 * t * 800;
		for (let n = 0; n < 800; n++) {
			const e = i + 4 * n;
			if (
				pixelData[e] !== 0 &&
				pixelData[e + 1] !== 0 &&
				pixelData[e + 2] !== 0
			) {
				newData.push({
					x: n,
					y: t,
					color: [
						pixelData[e],
						pixelData[e + 1],
						pixelData[e + 2],
						pixelData[e + 3],
					],
				});
			}
		}
	}

	newDataRef = newData.map(({ x, y, color }) => ({
		x,
		y,
		r: 1,
		color: `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${color[3]})`,
	}));
}

function animate(start: number) {
	const animateFrame = (pos = 0) => {
		requestAnimationFrame(() => {
			const newArr: typeof newDataRef = [];
			for (let i = 0; i < newDataRef.length; i++) {
				const current = newDataRef[i];
				if (current.x < pos) {
					newArr.push(current);
				} else {
					if (current.r <= 0) {
						current.r = 0;
						continue;
					}
					current.x += Math.random() > 0.5 ? 1 : -1;
					current.y += Math.random() > 0.5 ? 1 : -1;
					current.r -= 0.05 * Math.random();
					newArr.push(current);
				}
			}
			newDataRef = newArr;
			const ctx = canvasEl?.getContext("2d");
			if (ctx) {
				ctx.clearRect(pos, 0, 800, 800);
				newDataRef.forEach((t) => {
					const { x: n, y: i, r: s, color } = t;
					if (n > pos) {
						ctx.beginPath();
						ctx.rect(n, i, s, s);
						ctx.fillStyle = color;
						ctx.strokeStyle = color;
						ctx.stroke();
					}
				});
			}
			if (newDataRef.length > 0) {
				animateFrame(pos - 8);
			} else {
				keyword = "";
				animating = false;
			}
		});
	};
	animateFrame(start);
}

async function vanishAndSubmit() {
	animating = true;
	vanishInProgress = true;
	draw();
	await tick();

	const value = inputEl?.value || "";
	if (value && inputEl) {
		const maxX = newDataRef.reduce(
			(prev, current) => (current.x > prev ? current.x : prev),
			0,
		);
		animate(maxX);
	}

	// Trigger search with the current keyword before vanish clears it
	doSearch(value);
}

function handleKeyDown(e: KeyboardEvent) {
	if (e.key === "Enter" && !animating) {
		vanishAndSubmit();
	}
	if (e.key === "Escape") {
		close();
	}
}

// --- Modal open/close ---
export function open() {
	visible = true;
	result = [];
	keyword = "";
	startPlaceholderAnimation();
	tick().then(() => {
		inputEl?.focus();
	});
}

function close() {
	visible = false;
	stopPlaceholderAnimation();
	result = [];
	keyword = "";
}

function handleBackdropClick(e: MouseEvent) {
	if (e.target === modalEl) {
		close();
	}
}

function handleResultClick(e: MouseEvent, url: string) {
	e.preventDefault();
	close();
	navigateToPage(url);
}

// --- Global keyboard shortcut (Ctrl+K / Cmd+K) ---
function handleGlobalKeyDown(e: KeyboardEvent) {
	// 用 e.code(物理按键)判断，不受 Caps Lock / 输入法 / 键盘布局导致的大小写影响
	if ((e.ctrlKey || e.metaKey) && e.code === "KeyK") {
		e.preventDefault();
		if (visible) close();
		else open();
	}
}

// --- Initialization ---
onMount(() => {
	const initializePagefind = () => {
		initialized = true;
	};

	if (import.meta.env.DEV) {
		initializePagefind();
	} else {
		if (window.pagefind) {
			initializePagefind();
		} else {
			document.addEventListener("pagefindready", initializePagefind, {
				once: true,
			});
			document.addEventListener("pagefindloaderror", initializePagefind, {
				once: true,
			});
		}
	}

	document.addEventListener("keydown", handleGlobalKeyDown);

	const handleToggle = () => {
		if (visible) close();
		else open();
	};
	const unbindSearchModalController = bindSearchModalController(window, {
		toggle: handleToggle,
	});

	return () => {
		document.removeEventListener("keydown", handleGlobalKeyDown);
		unbindSearchModalController();
		stopPlaceholderAnimation();
	};
});

// --- Reactive search on input (with debounce) ---
let lastSearched = "";
$effect(() => {
	if (initialized && keyword !== lastSearched) {
		lastSearched = keyword;
		if (vanishInProgress) {
			// Don't clear results when vanish animation clears the keyword
			if (!keyword) vanishInProgress = false;
			return;
		}
		if (keyword) {
			clearTimeout(debounceTimer);
			debounceTimer = setTimeout(() => doSearch(keyword), 300);
		} else {
			result = [];
		}
	}
});
</script>

{#if visible}
<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<!-- data-lenis-prevent：首页 Lenis 平滑滚动激活时，弹窗内滚轮交给原生处理 -->
<div
	class="search-modal-backdrop"
	data-lenis-prevent
	bind:this={modalEl}
	onclick={handleBackdropClick}
>
	<div class="search-modal-content">
		<!-- Title -->
		<h2 class="search-modal-title">
			{i18n(I18nKey.searchArticles)}
		</h2>

		<!-- Vanish Input -->
		<form
			class="search-input-wrapper"
			onsubmit={(e) => { e.preventDefault(); vanishAndSubmit(); }}
		>
			<canvas
				class="search-canvas"
				class:opacity-0={!animating}
				class:opacity-100={animating}
				bind:this={canvasEl}
			></canvas>

			<input
				type="text"
				bind:this={inputEl}
				bind:value={keyword}
				onkeydown={handleKeyDown}
				disabled={animating}
				class="search-input"
				class:text-transparent={animating}
			/>

			<button
				type="submit"
				disabled={!keyword}
				class="search-submit-btn"
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					width="16"
					height="16"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
				>
					<path d="M5 12l14 0" />
					<path d="M13 18l6 -6" />
					<path d="M13 6l6 6" />
				</svg>
			</button>

			<!-- Placeholder animation -->
			{#if !keyword && !animating}
				<div class="search-placeholder">
					{placeholders[currentPlaceholder] || i18n(I18nKey.search)}
				</div>
			{/if}
		</form>

		<!-- Search Results -->
		{#if isSearching}
			<div class="search-results">
				<div class="search-result-empty">{i18n(I18nKey.searchLoading)}</div>
			</div>
		{:else if result.length > 0}
			<div class="search-results">
				{#each result.slice(0, 8) as item}
					<a
						href={item.url}
						onclick={(e) => handleResultClick(e, item.url)}
						class="search-result-item"
					>
						<div class="search-result-title">
							{@html item.meta.title}
							<svg class="search-result-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
								<path d="M9 18l6-6-6-6" />
							</svg>
						</div>
						{#if item.excerpt.includes('<mark>')}
							<div class="search-result-excerpt">
								{@html item.excerpt}
							</div>
						{/if}
					</a>
				{/each}
				{#if result.length > 8}
					<a
						href={getSearchUrl(keyword)}
						onclick={(e) => handleResultClick(e, getSearchUrl(keyword))}
						class="search-result-more"
					>
						{i18n(I18nKey.searchViewAllPrefix)} {result.length} {i18n(I18nKey.searchViewAllSuffix)}
					</a>
				{/if}
			</div>
		{:else if keyword && !isSearching}
			<div class="search-results">
				<div class="search-result-empty">{i18n(I18nKey.searchNoResults)}</div>
			</div>
		{/if}

		<!-- Footer hint -->
		<div class="search-modal-footer">
			<span class="search-hint-key">{i18n(I18nKey.searchHintClose)}</span>
			<span class="search-hint-key ml-3">{i18n(I18nKey.searchHintSearch)}</span>
			<span class="search-hint-key ml-3">{i18n(I18nKey.searchHintToggle)}</span>
		</div>
	</div>
</div>
{/if}

<style>
	.search-modal-backdrop {
		position: fixed;
		inset: 0;
		z-index: 100;
		display: flex;
		align-items: flex-start;
		justify-content: center;
		padding-top: 12vh;
		background: rgba(0, 0, 0, 0.5);
		backdrop-filter: blur(8px);
		-webkit-backdrop-filter: blur(8px);
		animation: fadeIn 0.2s ease;
	}

	:root.dark .search-modal-backdrop {
		background: rgba(0, 0, 0, 0.7);
	}

	@keyframes fadeIn {
		from { opacity: 0; }
		to { opacity: 1; }
	}

	@keyframes slideUp {
		from { opacity: 0; transform: translateY(1rem) scale(0.98); }
		to { opacity: 1; transform: translateY(0) scale(1); }
	}

	.search-modal-content {
		width: 100%;
		max-width: 36rem;
		margin: 0 1rem;
		animation: slideUp 0.25s ease;
	}

	.search-modal-title {
		font-family: ui-monospace, SFMono-Regular, monospace;
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.2em;
		color: rgba(255, 255, 255, 0.5);
		margin-bottom: 0.75rem;
		text-align: center;
	}

	/* ── Vanish Input ── */
	.search-input-wrapper {
		position: relative;
		width: 100%;
		height: 3.5rem;
		border-radius: 9999px;
		overflow: hidden;
		background: #fff;
		box-shadow:
			0px 2px 3px -1px rgba(0, 0, 0, 0.1),
			0px 1px 0px 0px rgba(25, 28, 33, 0.02),
			0px 0px 0px 1px rgba(25, 28, 33, 0.08);
		transition: background-color 0.2s;
	}

	:root.dark .search-input-wrapper {
		background: #282828;
	}

	.search-canvas {
		position: absolute;
		pointer-events: none;
		font-size: 1rem;
		transform: scale(0.5);
		top: 20%;
		left: 0.5rem;
		transform-origin: top left;
		width: 800px;
		height: 800px;
	}

	:root.dark .search-canvas {
		filter: invert(0);
	}

	:root:not(.dark) .search-canvas {
		filter: invert(1);
	}

	.search-input {
		position: relative;
		width: 100%;
		height: 100%;
		z-index: 10;
		border: none;
		background: transparent;
		font-size: 1rem;
		color: #000;
		padding: 0 3rem 0 1.5rem;
		outline: none;
	}

	:root.dark .search-input {
		color: #dadada;
	}

	.search-input.text-transparent {
		color: transparent;
	}

	:root.dark .search-input.text-transparent {
		color: transparent;
	}

	.search-submit-btn {
		position: absolute;
		right: 0.5rem;
		top: 50%;
		z-index: 10;
		transform: translateY(-50%);
		width: 2rem;
		height: 2rem;
		border-radius: 9999px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: #000;
		color: #fff;
		border: none;
		cursor: pointer;
		transition: background-color 0.2s, opacity 0.2s;
	}

	.search-submit-btn:disabled {
		background: #e5e5e5;
		color: #a3a3a3;
		cursor: default;
	}

	:root.dark .search-submit-btn {
		background: #1c1c1c;
		color: #b3b3b3;
	}

	:root.dark .search-submit-btn:disabled {
		background: #282828;
		color: #555555;
	}

	.search-placeholder {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		pointer-events: none;
		padding-left: 1.5rem;
		color: #a3a3a3;
		font-size: 1rem;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
		animation: placeholderFade 0.3s ease;
	}

	@keyframes placeholderFade {
		from { opacity: 0; transform: translateY(4px); }
		to { opacity: 1; transform: translateY(0); }
	}

	/* ── Search Results ── */
	.search-results {
		margin-top: 0.75rem;
		background: #fff;
		border-radius: 1rem;
		padding: 0.5rem;
		max-height: 50vh;
		overflow-y: auto;
		box-shadow:
			0 8px 32px -4px rgba(0, 0, 0, 0.12),
			0 2px 8px rgba(0, 0, 0, 0.06);
		animation: slideUp 0.2s ease;
	}

	:root.dark .search-results {
		background: #161616;
		box-shadow:
			0 8px 32px -4px rgba(0, 0, 0, 0.5),
			0 2px 8px rgba(0, 0, 0, 0.3);
	}

	.search-result-item {
		display: block;
		padding: 0.625rem 0.875rem;
		border-radius: 0.75rem;
		text-decoration: none;
		color: inherit;
		transition: background-color 0.15s;
	}

	.search-result-item:hover {
		background: rgba(0, 0, 0, 0.04);
	}

	:root.dark .search-result-item:hover {
		background: rgba(255, 255, 255, 0.06);
	}

	.search-result-title {
		font-size: 1rem;
		font-weight: 700;
		color: #171717;
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
	}

	:root.dark .search-result-title {
		color: #dadada;
	}

	.search-result-item:hover .search-result-title {
		color: var(--primary, #3b82f6);
	}

	.search-result-arrow {
		transition: transform 0.15s;
		opacity: 0;
	}

	.search-result-item:hover .search-result-arrow {
		opacity: 1;
		transform: translateX(2px);
	}

	.search-result-excerpt {
		font-size: 0.875rem;
		color: #737373;
		margin-top: 0.25rem;
		line-height: 1.5;
	}

	:root.dark .search-result-excerpt {
		color: #b3b3b3;
	}

	.search-result-excerpt :global(mark) {
		background: transparent;
		color: var(--primary, #3b82f6);
		font-weight: 600;
	}

	.search-result-more {
		display: block;
		text-align: center;
		padding: 0.625rem;
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--primary, #3b82f6);
		text-decoration: none;
		border-radius: 0.75rem;
		transition: background-color 0.15s;
	}

	.search-result-more:hover {
		background: rgba(0, 0, 0, 0.04);
	}

	:root.dark .search-result-more:hover {
		background: rgba(255, 255, 255, 0.06);
	}

	.search-result-empty {
		padding: 1rem;
		text-align: center;
		color: #a3a3a3;
		font-size: 0.875rem;
	}

	/* ── Footer ── */
	.search-modal-footer {
		margin-top: 0.75rem;
		text-align: center;
		font-size: 0.75rem;
		color: rgba(255, 255, 255, 0.35);
		font-family: ui-monospace, SFMono-Regular, monospace;
	}

	.search-hint-key {
		display: inline-block;
		padding: 0.125rem 0.375rem;
		border: 1px solid rgba(255, 255, 255, 0.2);
		border-radius: 0.25rem;
		font-size: 0.6875rem;
		margin-right: 0.25rem;
	}

	/* ── Mobile ── */
	@media (max-width: 640px) {
		.search-modal-backdrop {
			padding-top: 8vh;
		}

		.search-modal-content {
			margin: 0 0.5rem;
		}

		.search-input-wrapper {
			height: 3rem;
		}

		.search-input {
			font-size: 0.875rem;
			padding: 0 2.5rem 0 1rem;
		}

		.search-results {
			max-height: 60vh;
		}
	}
</style>
