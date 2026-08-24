import type { ArticleOutlineRailRuntime } from "@/utils/article-outline-controller";

declare global {
	interface Document {
		startViewTransition?(callback: () => void): void;
	}

	interface HTMLElementTagNameMap {
		"table-of-contents": HTMLElement & {
			init?: () => void;
		};
	}

	interface Window {
		// biome-ignore lint/suspicious/noExplicitAny: External library
		swup: any;
		live2dModelInitialized?: boolean;
		// biome-ignore lint/suspicious/noExplicitAny: External library (PIXI live2d)
		_live2dApp?: any;
		// biome-ignore lint/suspicious/noExplicitAny: External library (PIXI live2d)
		_live2dModel?: any;
		spineModelInitialized?: boolean;
		__spineAbortController?: AbortController | null;
		__spineIdleIntervalId?: ReturnType<typeof setInterval> | null;
		clearModelMessage?: () => void;
		showModelMessage?: (
			message: string,
			options?: Record<string, unknown>,
		) => void;
		floatingTOCListenersInitialized?: boolean;
		__articleOutlineRailRuntime?: ArticleOutlineRailRuntime;
		__searchLoadersReady?: boolean;
		__searchModalMounted?: boolean;
		__friendImagePreviewReady?: boolean;
		_showLive2DWidget?: () => void;
		_closeLive2DWidget?: () => void;
		// biome-ignore lint/suspicious/noExplicitAny: External library
		spinePlayerInstance?: any;
		pagefind: {
			search: (query: string) => Promise<{
				results: Array<{
					data: () => Promise<SearchResult>;
				}>;
			}>;
		};
		__fireflyMusic?: {
			init: () => Promise<void>;
			getState: () => {
				playlist: Array<{
					name: string;
					artist: string;
					url: string;
					pic: string;
					lrc?: string;
				}>;
				currentIndex: number;
				track: {
					name: string;
					artist: string;
					url: string;
					pic: string;
					lrc?: string;
				} | null;
				isPlaying: boolean;
				playMode: number;
				volume: number;
				isMuted: boolean;
				currentTime: number;
				duration: number;
				progress: number;
				currentTimeStr: string;
				durationStr: string;
				lyrics: Array<{ time: number; text: string }>;
				lyricsStatus?: "loading" | "loaded" | "none" | "failed";
				currentLrcIndex: number;
				initialized: boolean;
				error: string | null;
				config: {
					i18n?: {
						loadingLyrics?: string;
						noLyrics?: string;
						failedLyrics?: string;
					};
				} & Record<string, unknown>;
			};
			togglePlay: () => void;
			playNext: () => void;
			playPrev: () => void;
			cyclePlayMode: () => void;
			setVolume: (val: number) => void;
			toggleMute: () => void;
			seek: (percent: number) => void;
			seekToTime: (time: number) => void;
			playTrackByIndex: (index: number) => void;
			loadTrack: (index: number, autoPlay: boolean) => void;
		};
	}

	interface MediaQueryList {
		addListener(listener: (e: MediaQueryListEvent) => void): void;
		removeListener(listener: (e: MediaQueryListEvent) => void): void;
	}
}

interface SearchResult {
	url: string;
	meta: {
		title: string;
	};
	excerpt: string;
	content?: string;
	word_count?: number;
	filters?: Record<string, unknown>;
	anchors?: Array<{
		element: string;
		id: string;
		text: string;
		location: number;
	}>;
	weighted_locations?: Array<{
		weight: number;
		balanced_score: number;
		location: number;
	}>;
	locations?: number[];
	raw_content?: string;
	raw_url?: string;
	sub_results?: SearchResult[];
}

export type { SearchResult };
