<script lang="ts">
import I18nKey from "@i18n/i18nKey";
import { i18n } from "@i18n/translation";
import Icon from "@/components/common/Icon.svelte";
import { galleryConfig } from "@/config/galleryConfig";

const categories = [
	{ value: "pc", label: "PC" },
	{ value: "ai", label: "AI" },
	{ value: "aimp", label: "AI MP" },
	{ value: "bd", label: "BD" },
	{ value: "fj", label: "FJ" },
	{ value: "fjmp", label: "FJ MP" },
	{ value: "lai", label: "LAI" },
	{ value: "moe", label: "Moe" },
	{ value: "moemp", label: "Moe MP" },
	{ value: "mp", label: "MP" },
	{ value: "tx", label: "TX" },
	{ value: "xhl", label: "XHL" },
	{ value: "ys", label: "YS" },
	{ value: "ysmp", label: "YS MP" },
];

const networkAlbumConfig = galleryConfig.networkAlbum ?? {
	apiUrl: "",
	maxQuantity: 10,
	defaultQuantity: 6,
};
const maxQuantity = networkAlbumConfig.maxQuantity ?? 10;
const defaultQuantity = networkAlbumConfig.defaultQuantity ?? 6;
const apiUrl = networkAlbumConfig.apiUrl;

let selectedCategory = $state("pc");
let quantity = $state(defaultQuantity);
let images: Array<{ id: string; link: string }> = $state([]);
let fetching = $state(false);
let error = $state(false);
let cooldown = $state(0);
let cooldownTimer: ReturnType<typeof setInterval> | undefined;

async function fetchImages() {
	fetching = true;
	error = false;
	const limitedQuantity = Math.min(Math.max(quantity, 1), maxQuantity);
	if (!apiUrl) {
		fetching = false;
		error = true;
		return;
	}
	try {
		const url = `${apiUrl}/json?${selectedCategory}${limitedQuantity > 1 ? `=${limitedQuantity}` : ""}`;
		const response = await fetch(url);
		if (!response.ok) throw new Error("Fetch failed");
		const data = await response.json();
		if (data.code === 200) {
			if (Array.isArray(data.data)) {
				images = data.data;
			} else if (data.data) {
				images = [data.data];
			} else {
				images = [];
			}
		} else {
			throw new Error("API error");
		}
	} catch {
		error = true;
	} finally {
		fetching = false;
		startCooldown();
	}
}

function startCooldown() {
	cooldown = 5;
	if (cooldownTimer) clearInterval(cooldownTimer);
	cooldownTimer = setInterval(() => {
		cooldown -= 1;
		if (cooldown <= 0) {
			cooldown = 0;
			if (cooldownTimer) clearInterval(cooldownTimer);
			cooldownTimer = undefined;
		}
	}, 1000);
}
</script>

<div class="network-album">
	<div class="controls-bar">
		<div class="control-group">
			<label class="control-label" for="category-select">
				{i18n(I18nKey.galleryCategory)}
			</label>
			<div class="select-wrapper">
				<select id="category-select" bind:value={selectedCategory} class="control-select">
					{#each categories as cat}
						<option value={cat.value}>{cat.label}</option>
					{/each}
				</select>
				<svg class="select-arrow" viewBox="0 0 24 24" fill="currentColor" width="1em" height="1em">
					<path d="M7 10l5 5 5-5z"/>
				</svg>
			</div>
		</div>

		<div class="control-group">
			<label class="control-label" for="quantity-input">
				{i18n(I18nKey.galleryQuantity)}
			</label>
			<input
				id="quantity-input"
				type="number"
				min="1"
				max={maxQuantity}
				bind:value={quantity}
				onchange={(e) => {
					const val = Number(e.currentTarget.value);
					if (val > maxQuantity) quantity = maxQuantity;
					else if (val < 1) quantity = 1;
					else quantity = val;
				}}
				class="control-input"
			/>
		</div>

		<button
			class={`fetch-btn ${fetching ? "fetch-btn-loading" : ""} ${cooldown > 0 ? "fetch-btn-cooldown" : ""}`}
			onclick={fetchImages}
			disabled={fetching || cooldown > 0}
		>
			{#if fetching}
				<Icon name="svg-spinners:ring-resize" />
				<span>{i18n(I18nKey.galleryFetching)}</span>
			{:else if cooldown > 0}
				<span class="cooldown-text">{cooldown}s</span>
				<span>{i18n(I18nKey.galleryRandomFetch)}</span>
			{:else}
				<svg class="btn-icon" viewBox="0 0 24 24" fill="currentColor" width="1.15em" height="1.15em">
					<path d="M17.65 6.35A7.958 7.958 0 0012 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0112 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
				</svg>
				<span>{i18n(I18nKey.galleryRandomFetch)}</span>
			{/if}
		</button>
	</div>

	{#if error}
		<div class="error-msg">
			<Icon name="material-symbols:info-outline-rounded" />
			<span>{i18n(I18nKey.galleryFetchError)}</span>
		</div>
	{/if}

	{#if images.length > 0}
		<div class="image-grid">
			{#each images as img (img.id)}
				<a
					href={img.link}
					data-fancybox="network-gallery"
					data-src={img.link}
					data-type="image"
					class="image-item"
				>
					<div class="image-wrapper">
						<img src={img.link} alt="Random image" loading="lazy" decoding="async" />
						<div class="image-overlay">
							<svg class="zoom-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="28" height="28">
								<circle cx="11" cy="11" r="8"/>
								<line x1="21" y1="21" x2="16.65" y2="16.65"/>
								<line x1="11" y1="8" x2="11" y2="14"/>
								<line x1="8" y1="11" x2="14" y2="11"/>
							</svg>
						</div>
					</div>
				</a>
			{/each}
		</div>
	{:else if !fetching}
		<div class="empty-state">
			<Icon name="material-symbols:image-outline" class="empty-icon" />
			<p>{i18n(I18nKey.galleryNoImages)}</p>
		</div>
	{/if}
</div>

<style>
.network-album {
	width: 100%;
}

.controls-bar {
	display: flex;
	flex-wrap: wrap;
	align-items: flex-end;
	gap: 1rem;
	margin-bottom: 1.5rem;
	padding: 1rem;
	background: var(--btn-regular-bg, #f5f5f5);
	border-radius: 0.75rem;
	border: 1px solid var(--line-divider, #e5e5e5);
}

:root.dark .controls-bar {
	background: var(--btn-regular-bg, #1f2937);
	border-color: var(--line-divider, #374151);
}

.control-group {
	display: flex;
	flex-direction: column;
	gap: 0.375rem;
}

.control-label {
	font-size: 0.75rem;
	font-weight: 600;
	color: #6b7280;
	text-transform: uppercase;
	letter-spacing: 0.05em;
}

:root.dark .control-label {
	color: #9ca3af;
}

.select-wrapper {
	position: relative;
	display: flex;
	align-items: center;
}

.control-select {
	appearance: none;
	padding: 0.5rem 2rem 0.5rem 0.75rem;
	border-radius: 0.5rem;
	border: 1px solid var(--line-divider, #d1d5db);
	background: var(--card-bg, #ffffff);
	color: var(--btn-content, #1f2931);
	font-size: 0.875rem;
	font-weight: 500;
	cursor: pointer;
	min-width: 100px;
	transition: background 0.2s ease, border-color 0.2s ease, color 0.2s ease, box-shadow 0.2s ease;
}

:root.dark .control-select {
	background: var(--card-bg, #111827);
	border-color: var(--line-divider, #374151);
	color: var(--btn-content, #e5e7eb);
}

.control-select:focus {
	outline: none;
	border-color: var(--primary, #3b82f6);
	box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
}

.select-arrow {
	position: absolute;
	right: 0.5rem;
	font-size: 1.25rem;
	color: #6b7280;
	pointer-events: none;
}

:root.dark .select-arrow {
	color: #9ca3af;
}

.control-input {
	padding: 0.5rem 0.75rem;
	border-radius: 0.5rem;
	border: 1px solid var(--line-divider, #d1d5db);
	background: var(--card-bg, #ffffff);
	color: var(--btn-content, #1f2931);
	font-size: 0.875rem;
	font-weight: 500;
	width: 80px;
	transition: background 0.2s ease, border-color 0.2s ease, color 0.2s ease, box-shadow 0.2s ease;
}

:root.dark .control-input {
	background: var(--card-bg, #111827);
	border-color: var(--line-divider, #374151);
	color: var(--btn-content, #e5e7eb);
}

.control-input:focus {
	outline: none;
	border-color: var(--primary, #3b82f6);
	box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
}

.fetch-btn {
	display: inline-flex;
	align-items: center;
	gap: 0.5rem;
	padding: 0.5rem 1.25rem;
	border-radius: 0.5rem;
	border: 1px solid #000;
	background: transparent;
	color: #000;
	font-size: 0.875rem;
	font-weight: 600;
	cursor: pointer;
	transition: background 0.2s ease, color 0.2s ease, transform 0.2s ease, box-shadow 0.2s ease;
	white-space: nowrap;
}

:root.dark .fetch-btn {
	border-color: #fff;
	color: #fff;
}

.fetch-btn:hover:not(:disabled):not(.fetch-btn-cooldown):not(.fetch-btn-loading) {
	background: #000;
	color: #fff;
	transform: translateY(-1px);
	box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

:root.dark .fetch-btn:hover:not(:disabled):not(.fetch-btn-cooldown):not(.fetch-btn-loading) {
	background: #fff;
	color: #000;
	box-shadow: 0 4px 12px rgba(255, 255, 255, 0.15);
}

.fetch-btn:active:not(:disabled) {
	transform: translateY(0);
}

.fetch-btn:disabled {
	cursor: not-allowed;
}

.fetch-btn-cooldown {
	border-color: #ef4444 !important;
	color: #ef4444 !important;
	animation: pulse-red 1s ease-in-out infinite;
}

@keyframes pulse-red {
	0%, 100% { opacity: 0.85; }
	50% { opacity: 0.6; }
}

.fetch-btn-loading {
	border-color: var(--primary, #3b82f6) !important;
	color: var(--primary, #3b82f6) !important;
}

.btn-icon {
	flex-shrink: 0;
}

.cooldown-text {
	font-variant-numeric: tabular-nums;
	font-weight: 700;
}

.error-msg {
	display: flex;
	align-items: center;
	gap: 0.5rem;
	padding: 0.75rem 1rem;
	margin-bottom: 1rem;
	border-radius: 0.5rem;
	background: rgba(239, 68, 68, 0.1);
	color: #ef4444;
	font-size: 0.875rem;
}

:root.dark .error-msg {
	background: rgba(239, 68, 68, 0.15);
}

.image-grid {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
	gap: 1rem;
}

.image-item {
	display: block;
	border-radius: 0.75rem;
	overflow: hidden;
	cursor: pointer;
	transition: transform 0.2s ease, box-shadow 0.2s ease;
	text-decoration: none;
}

.image-item:hover {
	transform: translateY(-2px);
	box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
}

:root.dark .image-item:hover {
	box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
}

.image-wrapper {
	position: relative;
	aspect-ratio: 4/3;
	overflow: hidden;
}

.image-wrapper img {
	width: 100%;
	height: 100%;
	object-fit: cover;
	transition: transform 0.3s ease;
}

.image-item:hover .image-wrapper img {
	transform: scale(1.05);
}

.image-overlay {
	position: absolute;
	inset: 0;
	display: flex;
	align-items: center;
	justify-content: center;
	background: transparent;
	transition: background 0.2s ease;
}

.image-item:hover .image-overlay {
	background: rgba(0, 0, 0, 0.35);
}

.zoom-icon {
	color: white;
	opacity: 0;
	transform: scale(0.7);
	transition: opacity 0.2s ease, transform 0.2s ease;
	stroke-width: 2.5;
	filter: drop-shadow(0 1px 3px rgba(0, 0, 0, 0.3));
}

.image-item:hover .zoom-icon {
	opacity: 1;
	transform: scale(1);
}

.empty-state {
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	padding: 3rem 1rem;
	color: #9ca3af;
}

.empty-icon {
	font-size: 4rem;
	opacity: 0.4;
	margin-bottom: 1rem;
}

.empty-state p {
	font-size: 0.875rem;
	text-align: center;
}

@media (max-width: 640px) {
	.controls-bar {
		flex-direction: column;
		align-items: stretch;
	}

	.control-group {
		width: 100%;
	}

	.control-select,
	.control-input {
		width: 100%;
	}

	.fetch-btn {
		width: 100%;
		justify-content: center;
	}

	.image-grid {
		grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
		gap: 0.5rem;
	}
}
</style>
