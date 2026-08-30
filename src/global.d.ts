import type { SwupInstance, SwupRuntimeState } from "@/types/swup";
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
		/**
		 * `@swup/astro` 的 `globalInstance: true` 挂上来的实例。
		 * swup 初始化脚本与组件脚本都是 module，执行先后不定，因此这里是可选的 ——
		 * 读它请统一走 `@/utils/swup-lifecycle` 的 `getSwup()` / `onSwupReady()`，
		 * 不要自己写「查实例、查不到再等 swup:enable」的时序判断。
		 */
		swup?: SwupInstance;
		/** swup-lifecycle 的运行时状态，只应由该模块读写 */
		__fireflySwupRuntime?: SwupRuntimeState;
		spineModelInitialized?: boolean;
		__spineAbortController?: AbortController | null;
		__spineIdleIntervalId?: ReturnType<typeof setInterval> | null;
		clearModelMessage?: () => void;
		showModelMessage?: (
			message: string,
			options?: Record<string, unknown>,
		) => void;
		floatingTOCListenersInitialized?: boolean;
		/** 由 PrivacyModal 挂上，供 Footer 的 inline onclick 调用 */
		openPrivacyModal?: () => void;
		/** 由 UserAgreementModal 挂上，供 Footer 的 inline onclick 调用 */
		openUserAgreementModal?: () => void;
		__articleOutlineRailRuntime?: ArticleOutlineRailRuntime;
		__searchLoadersReady?: boolean;
		__searchModalMounted?: boolean;
		__friendImagePreviewReady?: boolean;
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
