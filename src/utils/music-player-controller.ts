import I18nKey from "@/i18n/i18nKey";
import { i18n } from "@/i18n/translation";

/**
 * 左下角桌面音乐组件的视图控制器。
 * 播放引擎仍是 MusicManager 暴露的 window.__fireflyMusic 单例（fm:* 事件广播），
 * 本模块只负责三态形态机（disc / pill / bar）、上展歌单面板、拖拽与列表渲染。
 *
 * 形态转移约定：
 * - 未播放：disc ⇄ bar（点击唱片切换；点击组件外收回 disc）；
 * - 播放中：默认 pill（唱片 + 胶囊歌词），悬停弹性变 bar，点击唱片展开 bar；
 *   bar 在鼠标离开组件一段延迟后自动收回 pill；暂停时 pill 收回 bar；
 * - bar 态分层显示：信息层（曲名 / 艺术家 / 进度）默认展开 + 工具栏层；
 *   歌单按钮在组件上方再展一层歌单面板，信息层保持不关。
 */

type WidgetShape = "disc" | "pill" | "bar";
type PanelTab = "playlist" | "lyrics";

interface LyricLine {
	time: number;
	text: string;
}

interface TrackInfo {
	name: string;
	artist: string;
	url: string;
	pic?: string;
	lrc?: string;
}

interface TimeDetail {
	progress: number;
	currentTimeStr: string;
	durationStr: string;
}

interface WidgetElement extends HTMLElement {
	__musicSync?: () => void;
}

const BAR_COLLAPSE_DELAY = 160;
const LYRICS_SCROLL_RESUME_DELAY = 3000;
const PLAYLIST_BATCH_SIZE = 30;
const PILL_LYRICS_STORAGE_KEY = "music-pill-lyrics";

export function setupMusicPlayerWidget(): void {
	const rootElement = document.querySelector<WidgetElement>(
		".music-player-widget",
	);
	const musicManager = window.__fireflyMusic;
	if (!rootElement || !musicManager) return;
	const root = rootElement;
	const mgr = musicManager;

	const abortController = new AbortController();
	const signal = abortController.signal;

	const $ = <T extends HTMLElement = HTMLElement>(selector: string): T | null =>
		root.querySelector<T>(selector);

	const ui = {
		disc: $(".music-player__disc"),
		discImg: $<HTMLImageElement>(".music-player__disc-img"),
		title: $(".music-player__title"),
		artist: $(".music-player__artist"),
		timeCurrent: $(".music-player__time-current"),
		timeTotal: $(".music-player__time-total"),
		progress: $(".music-player__progress"),
		progressBar: $(".music-player__progress-bar"),
		progressThumb: $(".music-player__progress-thumb"),
		pillText: $(".music-player__pill-text"),
		pillLabel: $(".music-player__pill-label"),
		btnMode: $(".music-player__btn--mode"),
		iconModeList: $(".music-player__icon-mode-list"),
		iconModeOne: $(".music-player__icon-mode-one"),
		iconModeShuffle: $(".music-player__icon-mode-shuffle"),
		btnLyrics: $(".music-player__btn--lyrics"),
		iconLrcOn: $(".music-player__icon-lrc-on"),
		iconLrcOff: $(".music-player__icon-lrc-off"),
		btnPlaylist: $(".music-player__btn--playlist"),
		btnPrev: $(".music-player__btn--prev"),
		btnPlay: $(".music-player__btn--play"),
		iconPlay: $(".music-player__icon-play"),
		iconPause: $(".music-player__icon-pause"),
		btnNext: $(".music-player__btn--next"),
		btnVolume: $(".music-player__btn--volume"),
		iconVolOn: $(".music-player__icon-vol-on"),
		iconVolOff: $(".music-player__icon-vol-off"),
		volumeTrack: $(".music-player__volume-track"),
		volumeBar: $(".music-player__volume-bar"),
		volumeThumb: $(".music-player__volume-thumb"),
		volumeValue: $(".music-player__volume-value"),
		playlistList: $(".music-player__playlist-list"),
		tabPlaylist: $(".music-player__tab--playlist"),
		tabLyrics: $(".music-player__tab--lyrics"),
		playlistView: $(".music-player__playlist-view"),
		lyricsView: $(".music-player__lyrics-view"),
		lyricsList: $(".music-player__lyrics-list"),
		itemTemplate: document.getElementById(
			"music-player-item-template",
		) as HTMLTemplateElement | null,
	};

	const critical: (Element | null)[] = [
		ui.disc,
		ui.discImg,
		ui.title,
		ui.artist,
		ui.progress,
		ui.progressBar,
		ui.progressThumb,
		ui.pillLabel,
		ui.btnMode,
		ui.btnLyrics,
		ui.btnPlaylist,
		ui.btnPrev,
		ui.btnPlay,
		ui.btnNext,
		ui.btnVolume,
		ui.volumeTrack,
		ui.volumeBar,
		ui.playlistList,
		ui.itemTemplate,
	];
	if (critical.some((el) => el === null)) return;

	// ── 本地状态 ─────────────────────────────────────────────
	let shape: WidgetShape = "disc";
	let hovering = false;
	let panelOpen = false;
	let isPlaying = false;
	let isSeeking = false;
	let isUserScrollingLyrics = false;
	let collapseTimer: number | null = null;
	let lyricsScrollTimer: number | null = null;
	let currentLrcIndex = -1;
	let currentTrack: TrackInfo | null = null;
	let playlistData: TrackInfo[] = [];
	let playlistRenderedCount = 0;
	let pillLyricsEnabled =
		localStorage.getItem(PILL_LYRICS_STORAGE_KEY) !== "false";

	// ── 形态机 ───────────────────────────────────────────────
	function setShape(next: WidgetShape): void {
		shape = next;
		root.dataset.state = next;
	}

	function clearCollapseTimer(): void {
		if (collapseTimer !== null) {
			window.clearTimeout(collapseTimer);
			collapseTimer = null;
		}
	}

	/** 播放中鼠标不在组件上时的静置形态：显示歌词时为胶囊，否则为唱片 */
	function playingRestingShape(): WidgetShape {
		return pillLyricsEnabled ? "pill" : "disc";
	}

	function scheduleBarCollapse(): void {
		clearCollapseTimer();
		collapseTimer = window.setTimeout(() => {
			collapseTimer = null;
			if (hovering || !isPlaying || shape !== "bar" || panelOpen) return;
			setShape(playingRestingShape());
		}, BAR_COLLAPSE_DELAY);
	}

	function onPointerEnter(): void {
		hovering = true;
		clearCollapseTimer();
		if (
			isPlaying &&
			(shape === "pill" || (shape === "disc" && !pillLyricsEnabled))
		) {
			setShape("bar");
		}
	}

	function onPointerLeave(): void {
		hovering = false;
		if (isPlaying && shape === "bar" && !panelOpen) scheduleBarCollapse();
	}

	function onDiscClick(): void {
		ensureInit();
		if (shape === "bar") setShape(isPlaying ? playingRestingShape() : "disc");
		else setShape("bar");
	}

	// ── 上展面板（歌单 / 歌词双 tab） ────────────────────────
	function setPanelTab(tab: PanelTab): void {
		ui.tabPlaylist?.classList.toggle("is-active", tab === "playlist");
		ui.tabLyrics?.classList.toggle("is-active", tab === "lyrics");
		ui.playlistView?.classList.toggle("is-active", tab === "playlist");
		ui.lyricsView?.classList.toggle("is-active", tab === "lyrics");
	}

	function setPanelOpen(open: boolean): void {
		panelOpen = open;
		root.dataset.panel = open ? "open" : "closed";
		ui.btnPlaylist?.classList.toggle("is-active", open);
		if (open) setPanelTab("playlist");
	}

	// ── UI 更新 ──────────────────────────────────────────────
	function setLoading(visible: boolean): void {
		root.classList.toggle("is-loading", visible);
	}

	function ensureInit(): void {
		if (mgr.getState().initialized) return;
		setLoading(true);
		void mgr.init();
	}

	function updatePlayIcons(playing: boolean): void {
		ui.iconPlay?.classList.toggle("hidden", playing);
		ui.iconPause?.classList.toggle("hidden", !playing);
		const label = playing ? i18n(I18nKey.musicPause) : i18n(I18nKey.musicPlay);
		ui.btnPlay?.setAttribute("aria-label", label);
		ui.btnPlay?.setAttribute("data-tooltip", label);
	}

	function applyPlayState(playing: boolean): void {
		isPlaying = playing;
		root.dataset.playing = playing ? "true" : "false";
		updatePlayIcons(playing);
		if (!playing) {
			clearCollapseTimer();
			if (shape === "pill") setShape("bar");
		} else if (shape !== "bar") {
			const resting = playingRestingShape();
			if (shape !== resting) setShape(hovering ? "bar" : resting);
		}
		updatePillText();
	}

	function updateModeUI(playMode: number): void {
		const isList = playMode === 0;
		const isOne = playMode === 1;
		ui.iconModeList?.classList.toggle("hidden", !isList);
		ui.iconModeOne?.classList.toggle("hidden", !isOne);
		ui.iconModeShuffle?.classList.toggle("hidden", isList || isOne);
		ui.btnMode?.classList.toggle("is-active", !isList);
		const label = isList
			? i18n(I18nKey.playModeList)
			: isOne
				? i18n(I18nKey.playModeSingle)
				: i18n(I18nKey.playModeShuffle);
		ui.btnMode?.setAttribute("aria-label", label);
		ui.btnMode?.setAttribute("data-tooltip", label);
	}

	function updateVolumeUI(volume: number, isMuted: boolean): void {
		const pct = isMuted ? 0 : volume * 100;
		// 垂直音量条：填充与滑块自底向上
		if (ui.volumeBar) ui.volumeBar.style.height = `${pct}%`;
		if (ui.volumeThumb) ui.volumeThumb.style.bottom = `${pct}%`;
		if (ui.volumeValue) ui.volumeValue.textContent = `${Math.round(pct)}`;
		ui.volumeTrack?.setAttribute("aria-valuenow", Math.round(pct).toString());
		const muted = isMuted || volume === 0;
		ui.iconVolOn?.classList.toggle("hidden", muted);
		ui.iconVolOff?.classList.toggle("hidden", !muted);
	}

	function updateProgressUI(
		progress: number,
		currentTimeStr: string,
		durationStr: string,
	): void {
		if (ui.progressBar) ui.progressBar.style.width = `${progress}%`;
		if (ui.progressThumb) ui.progressThumb.style.left = `${progress}%`;
		ui.progress?.setAttribute("aria-valuenow", Math.round(progress).toString());
		if (ui.timeCurrent) ui.timeCurrent.textContent = currentTimeStr;
		if (ui.timeTotal) ui.timeTotal.textContent = durationStr;
	}

	function updateTrackUI(track: TrackInfo | null): void {
		currentTrack = track;
		if (!track) return;
		if (ui.title) {
			ui.title.textContent = track.name;
			ui.title.title = track.name;
		}
		if (ui.artist) {
			ui.artist.textContent = track.artist;
			ui.artist.title = track.artist;
		}
		if (ui.discImg) {
			ui.discImg.src = track.pic || "";
			ui.discImg.alt = `${track.name} - ${track.artist}`;
			ui.discImg.classList.toggle("is-empty", !track.pic);
		}
		updateProgressUI(0, "0:00", "0:00");
		updatePillText();
	}

	function updatePillLyricsButton(): void {
		ui.btnLyrics?.classList.toggle("is-active", pillLyricsEnabled);
		ui.btnLyrics?.setAttribute("aria-pressed", String(pillLyricsEnabled));
		ui.iconLrcOn?.classList.toggle("hidden", !pillLyricsEnabled);
		ui.iconLrcOff?.classList.toggle("hidden", pillLyricsEnabled);
	}

	function updatePillText(): void {
		if (!ui.pillLabel) return;
		let text = "";
		if (currentTrack) {
			const lyrics = mgr.getState().lyrics as LyricLine[];
			const line =
				pillLyricsEnabled &&
				isPlaying &&
				currentLrcIndex >= 0 &&
				currentLrcIndex < lyrics.length
					? lyrics[currentLrcIndex]
					: undefined;
			// 关闭歌词时只显示曲名，与歌词行明确区分
			text = line
				? line.text
				: pillLyricsEnabled
					? `${currentTrack.name} - ${currentTrack.artist}`
					: currentTrack.name;
		} else {
			text = i18n(I18nKey.musicNoPlaying);
		}
		if (ui.pillLabel.textContent !== text) {
			ui.pillLabel.textContent = text;
			scheduleMarquee();
		}
	}

	/** 胶囊歌词超宽时跑马灯：偏移量与时长按溢出宽度算，写 CSS 变量交给 keyframes */
	function scheduleMarquee(): void {
		const label = ui.pillLabel;
		const wrap = ui.pillText;
		if (!label || !wrap) return;
		label.classList.remove("is-marquee");
		window.requestAnimationFrame(() => {
			const overflow = label.scrollWidth - wrap.clientWidth;
			if (overflow > 4) {
				label.style.setProperty("--mp-marquee-offset", `${-overflow}px`);
				label.style.setProperty(
					"--mp-marquee-duration",
					`${Math.min(12, Math.max(4, overflow / 22))}s`,
				);
				label.classList.add("is-marquee");
			} else {
				label.style.removeProperty("--mp-marquee-offset");
				label.style.removeProperty("--mp-marquee-duration");
			}
		});
	}

	// ── 歌单分批渲染 ─────────────────────────────────────────
	function appendPlaylistBatch(start: number, end: number): void {
		const list = ui.playlistList;
		const template = ui.itemTemplate;
		if (!list || !template) return;
		const actualEnd = Math.min(end, playlistData.length);
		for (let idx = start; idx < actualEnd; idx += 1) {
			const track = playlistData[idx];
			const clone = template.content.cloneNode(true) as DocumentFragment;
			const itemEl = clone.querySelector<HTMLElement>(".music-player__track");
			const img = clone.querySelector<HTMLImageElement>(
				".music-player__track-cover",
			);
			const title = clone.querySelector<HTMLElement>(
				".music-player__track-title",
			);
			const artist = clone.querySelector<HTMLElement>(
				".music-player__track-artist",
			);
			if (!itemEl || !img || !title || !artist) continue;
			img.src = track.pic || "";
			img.alt = `${track.name} - ${track.artist}`;
			title.textContent = track.name;
			artist.textContent = track.artist;
			itemEl.dataset.index = idx.toString();
			itemEl.setAttribute("aria-label", `${track.name} - ${track.artist}`);
			itemEl.addEventListener(
				"click",
				() => {
					mgr.playTrackByIndex(
						Number.parseInt(itemEl.dataset.index ?? "0", 10),
					);
				},
				{ signal },
			);
			list.appendChild(clone);
		}
		playlistRenderedCount = actualEnd;
	}

	function onPlaylistScroll(): void {
		const list = ui.playlistList;
		if (!list || playlistRenderedCount >= playlistData.length) return;
		if (list.scrollTop + list.clientHeight >= list.scrollHeight - 80) {
			appendPlaylistBatch(
				playlistRenderedCount,
				playlistRenderedCount + PLAYLIST_BATCH_SIZE,
			);
		}
	}

	function ensurePlaylistItemVisible(index: number): void {
		if (index < playlistRenderedCount || !ui.playlistList) return;
		appendPlaylistBatch(playlistRenderedCount, index + 1);
		ui.playlistList
			.querySelector(`[data-index="${index}"]`)
			?.scrollIntoView({ block: "nearest" });
	}

	function renderPlaylist(playlist: TrackInfo[], currentIndex: number): void {
		playlistData = playlist;
		playlistRenderedCount = 0;
		if (ui.playlistList) ui.playlistList.innerHTML = "";
		if (playlist.length > 0) appendPlaylistBatch(0, PLAYLIST_BATCH_SIZE);
		updatePlaylistActiveUI(currentIndex);
	}

	function updatePlaylistActiveUI(currentIndex: number): void {
		if (!ui.playlistList) return;
		if (currentIndex >= playlistRenderedCount && playlistData.length > 0) {
			ensurePlaylistItemVisible(currentIndex);
		}
		ui.playlistList
			.querySelectorAll<HTMLElement>(".music-player__track")
			.forEach((el) => {
				const idx = Number.parseInt(el.dataset.index ?? "-1", 10);
				const overlay = el.querySelector(".music-player__track-active");
				const title = el.querySelector(".music-player__track-title");
				const active = idx === currentIndex;
				el.classList.toggle("is-active", active);
				overlay?.classList.toggle("hidden", !active);
				title?.classList.toggle("text-(--primary)", active);
				if (active) el.setAttribute("aria-current", "true");
				else el.removeAttribute("aria-current");
			});
	}

	// ── 面板歌词列表 ─────────────────────────────────────────
	function renderLyricsUI(lyrics: LyricLine[], status: string): void {
		const list = ui.lyricsList;
		if (!list) return;
		list.innerHTML = "";
		const placeholder = (text: string): void => {
			const el = document.createElement("div");
			el.className = "music-player__lyrics-placeholder";
			el.textContent = text;
			list.appendChild(el);
		};
		if (status === "loading") {
			placeholder(i18n(I18nKey.musicLoadingLyrics));
			return;
		}
		if (status === "failed") {
			placeholder(i18n(I18nKey.musicFailedLyrics));
			return;
		}
		if (lyrics.length === 0) {
			placeholder(i18n(I18nKey.musicNoLyrics));
			return;
		}
		lyrics.forEach((line, index) => {
			const lineEl = document.createElement("div");
			lineEl.className = "music-player__lrc-line";
			lineEl.textContent = line.text;
			lineEl.dataset.index = index.toString();
			lineEl.setAttribute("role", "option");
			lineEl.addEventListener(
				"click",
				() => {
					mgr.seekToTime(line.time);
				},
				{ signal },
			);
			list.appendChild(lineEl);
		});
		updateLrcHighlight(currentLrcIndex, true);
	}

	function updateLrcHighlight(index: number, force = false): void {
		if (index === currentLrcIndex && !force) return;
		currentLrcIndex = index;
		const list = ui.lyricsList;
		if (!list) return;
		list
			.querySelectorAll<HTMLElement>(".music-player__lrc-line")
			.forEach((line, i) => {
				line.classList.toggle("is-active", i === index);
			});
		if (index !== -1 && !isUserScrollingLyrics) {
			const line = list.querySelector<HTMLElement>(
				`.music-player__lrc-line[data-index="${index}"]`,
			);
			if (line) {
				const target =
					line.offsetTop - list.clientHeight / 2 + line.offsetHeight / 2;
				list.scrollTo({ top: target, behavior: "smooth" });
			}
		}
	}

	function resumeLyricsAutoScroll(): void {
		if (lyricsScrollTimer !== null) window.clearTimeout(lyricsScrollTimer);
		lyricsScrollTimer = window.setTimeout(() => {
			lyricsScrollTimer = null;
			isUserScrollingLyrics = false;
			updateLrcHighlight(mgr.getState().currentLrcIndex, true);
		}, LYRICS_SCROLL_RESUME_DELAY);
	}

	// ── 全量同步（late-mount / Swup 导航后 resync） ───────────
	function syncAll(): void {
		const s = mgr.getState();
		if (!s.initialized) return;
		setLoading(false);
		if (s.playlist.length === 0) {
			if (ui.title)
				ui.title.textContent = s.error || i18n(I18nKey.musicNoSongs);
			updatePillText();
			return;
		}
		renderPlaylist(s.playlist as TrackInfo[], s.currentIndex);
		updateTrackUI((s.track as TrackInfo | null) ?? null);
		applyPlayState(s.isPlaying);
		updateModeUI(s.playMode);
		updateVolumeUI(s.volume, s.isMuted);
		if (s.duration > 0) {
			updateProgressUI(s.progress, s.currentTimeStr, s.durationStr);
		}
		currentLrcIndex = s.currentLrcIndex;
		renderLyricsUI(
			s.lyrics as LyricLine[],
			s.lyrics.length > 0 ? "loaded" : "none",
		);
		updatePillText();
	}

	// ── fm:* 事件订阅 ────────────────────────────────────────
	function on<T>(name: string, handler: (detail: T) => void): void {
		const listener = (event: Event): void => {
			handler((event as CustomEvent<T>).detail);
		};
		window.addEventListener(name, listener, { signal });
	}

	on<{
		playlist: TrackInfo[];
		playMode: number;
		volume: number;
		isMuted: boolean;
	}>("fm:init", (d) => {
		setLoading(false);
		if (d.playlist.length > 0) {
			renderPlaylist(d.playlist, 0);
			updateModeUI(d.playMode);
			updateVolumeUI(d.volume, d.isMuted);
		} else if (ui.title) {
			ui.title.textContent = i18n(I18nKey.musicNoSongs);
		}
	});

	on<{ index: number; track: TrackInfo }>("fm:track", (d) => {
		currentLrcIndex = -1;
		updateTrackUI(d.track);
		updatePlaylistActiveUI(d.index);
	});

	on<{ isPlaying: boolean }>("fm:play-state", (d) => {
		applyPlayState(d.isPlaying);
	});

	on<TimeDetail>("fm:time", (d) => {
		if (isSeeking) return;
		updateProgressUI(d.progress, d.currentTimeStr, d.durationStr);
	});

	on<{ volume: number; isMuted: boolean }>("fm:volume", (d) => {
		updateVolumeUI(d.volume, d.isMuted);
	});

	on<{ playMode: number }>("fm:mode", (d) => {
		updateModeUI(d.playMode);
	});

	on<{ lyrics: LyricLine[]; status: string }>("fm:lyrics", (d) => {
		currentLrcIndex = -1;
		renderLyricsUI(d.lyrics, d.status);
		updatePillText();
	});

	on<{ index: number }>("fm:lrc-index", (d) => {
		updateLrcHighlight(d.index);
		updatePillText();
	});

	on<{ message: string }>("fm:error", (d) => {
		setLoading(false);
		if (ui.title) ui.title.textContent = d.message || i18n(I18nKey.musicError);
		updatePillText();
	});

	// ── 拖拽（进度 / 音量） ──────────────────────────────────
	function bindDrag(
		track: HTMLElement | null,
		onRatio: (ratio: number) => void,
		onCommit?: (ratio: number) => void,
		vertical = false,
	): void {
		if (!track) return;
		track.addEventListener(
			"pointerdown",
			(event) => {
				event.preventDefault();
				track.setPointerCapture(event.pointerId);
				const apply = (clientX: number, clientY: number): number => {
					const rect = track.getBoundingClientRect();
					// 垂直轴：底部为 0、顶部为 1，取纵向反比
					const ratio = vertical
						? 1 - Math.min(1, Math.max(0, (clientY - rect.top) / rect.height))
						: Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
					onRatio(ratio);
					return ratio;
				};
				apply(event.clientX, event.clientY);
				const move = (moveEvent: PointerEvent): void => {
					apply(moveEvent.clientX, moveEvent.clientY);
				};
				const up = (upEvent: PointerEvent): void => {
					track.removeEventListener("pointermove", move);
					track.removeEventListener("pointerup", up);
					track.removeEventListener("pointercancel", up);
					onCommit?.(apply(upEvent.clientX, upEvent.clientY));
				};
				track.addEventListener("pointermove", move);
				track.addEventListener("pointerup", up);
				track.addEventListener("pointercancel", up);
			},
			{ signal },
		);
	}

	bindDrag(
		ui.progress,
		(ratio) => {
			isSeeking = true;
			ui.progress?.classList.add("is-dragging");
			updateProgressUI(
				ratio * 100,
				ui.timeCurrent?.textContent ?? "0:00",
				ui.timeTotal?.textContent ?? "0:00",
			);
		},
		(ratio) => {
			isSeeking = false;
			ui.progress?.classList.remove("is-dragging");
			mgr.seek(ratio);
		},
	);

	bindDrag(
		ui.volumeTrack,
		(ratio) => {
			mgr.setVolume(ratio);
		},
		undefined,
		true,
	);

	// ── 按钮与交互 ───────────────────────────────────────────
	ui.disc?.addEventListener("click", onDiscClick, { signal });
	ui.btnPlay?.addEventListener(
		"click",
		() => {
			if (!mgr.getState().initialized) {
				ensureInit();
				return;
			}
			mgr.togglePlay();
		},
		{ signal },
	);
	ui.btnNext?.addEventListener("click", () => mgr.playNext(), { signal });
	ui.btnPrev?.addEventListener("click", () => mgr.playPrev(), { signal });
	ui.btnMode?.addEventListener("click", () => mgr.cyclePlayMode(), { signal });
	ui.btnVolume?.addEventListener("click", () => mgr.toggleMute(), { signal });
	ui.btnPlaylist?.addEventListener("click", () => setPanelOpen(!panelOpen), {
		signal,
	});
	ui.tabPlaylist?.addEventListener("click", () => setPanelTab("playlist"), {
		signal,
	});
	ui.tabLyrics?.addEventListener("click", () => setPanelTab("lyrics"), {
		signal,
	});
	ui.lyricsList?.addEventListener(
		"wheel",
		() => {
			isUserScrollingLyrics = true;
			resumeLyricsAutoScroll();
		},
		{ passive: true, signal },
	);
	ui.lyricsList?.addEventListener(
		"touchstart",
		() => {
			isUserScrollingLyrics = true;
			resumeLyricsAutoScroll();
		},
		{ passive: true, signal },
	);
	ui.btnLyrics?.addEventListener(
		"click",
		() => {
			pillLyricsEnabled = !pillLyricsEnabled;
			localStorage.setItem(
				PILL_LYRICS_STORAGE_KEY,
				pillLyricsEnabled ? "true" : "false",
			);
			updatePillLyricsButton();
			updatePillText();
			if (isPlaying && shape !== "bar") {
				setShape(hovering ? "bar" : playingRestingShape());
			}
		},
		{ signal },
	);

	root.addEventListener("pointerenter", onPointerEnter, { signal });
	root.addEventListener("pointerleave", onPointerLeave, { signal });
	ui.playlistList?.addEventListener("scroll", onPlaylistScroll, {
		passive: true,
		signal,
	});

	// 点击组件外：收歌单面板并把 dock 缩放收回（播放中回胶囊，未播放回唱片）
	document.addEventListener(
		"click",
		(event) => {
			const target = event.target;
			if (target instanceof Node && root.contains(target)) return;
			if (panelOpen) setPanelOpen(false);
			clearCollapseTimer();
			if (shape !== "bar") return;
			setShape(isPlaying ? playingRestingShape() : "disc");
		},
		{ signal },
	);

	window.addEventListener("resize", () => scheduleMarquee(), {
		passive: true,
		signal,
	});

	// ── 初始状态 ─────────────────────────────────────────────
	root.__musicSync = syncAll;
	root.dataset.state = shape;
	root.dataset.panel = "closed";
	root.dataset.playing = "false";
	updatePillLyricsButton();
	if (mgr.getState().initialized) syncAll();
}
