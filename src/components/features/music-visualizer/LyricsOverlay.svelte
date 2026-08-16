<script lang="ts">
import { onDestroy, onMount, tick } from "svelte";
import I18nKey from "@/i18n/i18nKey";
import { i18n } from "@/i18n/translation";

interface LyricLine {
	time: number;
	text: string;
}

type LyricStatus = "loading" | "loaded" | "none" | "failed";

let containerEl: HTMLDivElement;
let trackEl: HTMLDivElement;
let lyrics: LyricLine[] = $state([]);
let currentIndex = $state(-1);
let lyricsStatus = $state<LyricStatus>("loading");
let offsetY = $state(0);
let statusLabels = $state({
	loading: i18n(I18nKey.musicLoadingLyrics),
	none: i18n(I18nKey.musicNoLyrics),
	failed: i18n(I18nKey.musicFailedLyrics),
});

const statusText = $derived(
	lyricsStatus === "failed"
		? statusLabels.failed
		: lyricsStatus === "none"
			? statusLabels.none
			: statusLabels.loading,
);
const hasLyrics = $derived(lyrics.length > 0);
const isPlaybackActive = $derived(currentIndex >= 0);
const visibleLyrics = $derived(lyrics.map((line, index) => ({ line, index })));

// 将文本拆分为单个字符（保留空格），用于逐字发光
function splitChars(text: string): string[] {
	return Array.from(text);
}

// 让最后一个字的发光在下一行开始前完成，避免歌词切行时扫词被截断。
function charTiming(text: string) {
	const count = Array.from(text).length;
	if (count <= 0 || currentIndex < 0 || !lyrics[currentIndex]) {
		return { step: 0, glowDuration: 0.42 };
	}

	const current = lyrics[currentIndex];
	const next = lyrics[currentIndex + 1];
	const duration =
		next && next.time > current.time ? next.time - current.time : 2.4;
	const glowDuration = Math.min(0.42, Math.max(0.14, duration * 0.35));
	const step =
		count > 1 ? Math.max(0, (duration - glowDuration) / (count - 1)) : 0;

	return { step, glowDuration };
}

function syncLyricOffset() {
	if (!containerEl || !trackEl || lyrics.length === 0) {
		offsetY = 0;
		return;
	}

	const nextIndex = currentIndex >= 0 ? currentIndex : 0;
	const activeEl = trackEl.querySelector<HTMLElement>(
		`[data-lyric-index="${nextIndex}"]`,
	);
	if (!activeEl) return;

	const lyricCenter = activeEl.offsetTop + activeEl.offsetHeight / 2;
	const targetCenter =
		containerEl.clientHeight * (currentIndex >= 0 ? 0.42 : 0.58);
	offsetY = targetCenter - lyricCenter;
}

async function queueLyricOffset() {
	await tick();
	syncLyricOffset();
}

function onLyrics(e: CustomEvent) {
	lyrics = e.detail.lyrics || [];
	lyricsStatus = e.detail.status || (lyrics.length > 0 ? "loaded" : "none");
	currentIndex = -1;
	void queueLyricOffset();
}

function onLrcIndex(e: CustomEvent) {
	currentIndex = e.detail.index;
	void queueLyricOffset();
}

onMount(() => {
	const mgr = window.__fireflyMusic;
	if (mgr) {
		const state = mgr.getState();
		lyrics = state.lyrics || [];
		currentIndex = state.currentLrcIndex;
		statusLabels = {
			loading: state.config?.i18n?.loadingLyrics || statusLabels.loading,
			none: state.config?.i18n?.noLyrics || statusLabels.none,
			failed: state.config?.i18n?.failedLyrics || statusLabels.failed,
		};
		lyricsStatus =
			state.lyricsStatus || (lyrics.length > 0 ? "loaded" : "loading");
	}
	void queueLyricOffset();

	window.addEventListener("fm:lyrics", onLyrics as EventListener);
	window.addEventListener("fm:lrc-index", onLrcIndex as EventListener);
});

onDestroy(() => {
	window.removeEventListener("fm:lyrics", onLyrics as EventListener);
	window.removeEventListener("fm:lrc-index", onLrcIndex as EventListener);
});
</script>

<div
	bind:this={containerEl}
	class="music-visualizer__lyrics"
	class:music-visualizer__lyrics--playing={isPlaybackActive}
>
	<div class="music-visualizer__lyrics-stage">
		{#if hasLyrics}
		<div
			bind:this={trackEl}
			class="music-visualizer__lyrics-inner"
			style={`transform: translateY(${offsetY}px)`}
		>
			{#each visibleLyrics as entry (entry.index)}
				{@const line = entry.line}
				{@const index = entry.index}
			<div
				class="music-visualizer__lyric-line"
				class:music-visualizer__lyric-line--active={index === currentIndex}
				class:music-visualizer__lyric-line--past={index < currentIndex}
				data-lyric-index={index}
			>
				{#if index <= currentIndex}
					{@const timing = index === currentIndex ? charTiming(line.text) : null}
					<span class="music-visualizer__lyric-text music-visualizer__lyric-text--ktv">
						{#each splitChars(line.text) as char, j}
							<span
								class="music-visualizer__lyric-char"
								style={timing
									? `animation-delay: ${(j * timing.step).toFixed(3)}s; animation-duration: ${timing.glowDuration.toFixed(3)}s`
									: undefined}
							>{char}</span>
						{/each}
					</span>
				{:else}
					<span class="music-visualizer__lyric-text">{line.text}</span>
				{/if}
			</div>
		{/each}
		</div>
		{:else}
			<div class="music-visualizer__lyrics-empty" aria-live="polite">
				<span>{statusText}</span>
			</div>
		{/if}
	</div>
</div>
