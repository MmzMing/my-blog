import I18nKey from "@/i18n/i18nKey";
import { i18n } from "@/i18n/translation";

/**
 * 桌面可拖拽音乐组件的视图控制器。
 * 播放引擎仍是 MusicManager 暴露的 window.__fireflyMusic 单例（fm:* 事件广播），
 * 本模块只负责三态形态机（disc / pill / bar）、展开卡（歌单 / 歌词面板 + 信息层）、
 * 拖拽定位与列表渲染。
 *
 * 形态转移约定：
 * - 未播放：disc ⇄ bar（点击唱片切换；点击组件外收回 disc）；
 * - 播放中：默认 pill（唱片 + 胶囊歌词），悬停弹性变 bar，点击唱片展开 bar；
 *   bar 在鼠标离开组件一段延迟后自动收回 pill；暂停时 pill 收回 bar；
 * - 歌单按钮开合的是 dock 上方那一张展开卡：卡片只向上长出面板，水平缩进不变，
 *   信息层随之上移留在卡片底部（面板在上、信息层在下，唱片始终骑在左下角接缝）。
 *
 * 拖拽：组件任意非交互区域按住即可拖动，位移超过阈值才判定为拖拽并抑制随后的 click，
 * 因此唱片点击切形态与拖唱片移动互不干扰；位置写 localStorage，且始终按当前形态的
 * 目标尺寸夹在视口内（形态或面板开合导致尺寸变化时平滑回弹）。
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

interface DragSession {
	pointerId: number;
	startX: number;
	startY: number;
	originX: number;
	originY: number;
	active: boolean;
}

const BAR_COLLAPSE_DELAY = 160;
const LYRICS_SCROLL_RESUME_DELAY = 3000;
const PLAYLIST_BATCH_SIZE = 30;
const PILL_LYRICS_STORAGE_KEY = "music-pill-lyrics";
const POSITION_STORAGE_KEY = "music-player-pos";
/** 与 CSS --mp-edge 对齐的视口安全边距 */
const EDGE_MARGIN = 20;
/** 超过该位移才判定为拖拽，避免与点击切形态冲突 */
const DRAG_THRESHOLD = 4;
/** 歌单条目逐项入场的错峰上限与步长，需与 CSS 的 animation-delay 对齐 */
const TRACK_STAGGER_MAX = 12;
const TRACK_STAGGER_MS = 26;
const TRACK_ENTRANCE_MS = 340 + TRACK_STAGGER_MAX * TRACK_STAGGER_MS;
/** 这些区域承担各自的交互，不作为拖拽起点 */
const DRAG_EXCLUDE =
	".music-player__btn, .music-player__progress, .music-player__volume, .music-player__tab, .music-player__playlist-list, .music-player__lyrics-list";
/**
 * 音量条橡皮筋的越界上限（px）。约束来自滑块：轨道端点到胶囊内缘只有 31px，
 * 半颗滑块 6.6px，20 越界后滑块右缘距胶囊还留 4px。参考实现的 26 不受这个约束。
 */
const VOLUME_STRETCH_PX = 20;
/** 松手后数值气泡再停留的时长（ms），与拖拽中的常显区分开 */
const VOLUME_BUBBLE_LINGER_MS = 700;

/**
 * iOS 式越界阻尼：每多拖一像素给的位移递减，但永远不超过 limit。
 * 返回带符号的位移，正负由拖出的方向决定。
 */
function rubberBand(distance: number, limit: number): number {
	const bounded = (Math.abs(distance) * 0.55) / limit + 1;
	return Math.sign(distance) * (1 - 1 / bounded) * limit;
}

function prefersReducedMotion(): boolean {
	return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

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
		probe: $(".music-player__probe"),
		probeBar: $(".music-player__probe-bar"),
		probeRise: $(".music-player__probe-rise"),
		panelBody: $(".music-player__panel-body"),
		infoSurface: $(".music-player__info-surface"),
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
		volumePop: $(".music-player__volume-pop"),
		volumeTrack: $(".music-player__volume-track"),
		volumeBubble: $(".music-player__volume-bubble"),
		playlistList: $(".music-player__playlist-list"),
		tabIndicator: $(".music-player__tab-indicator"),
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
		ui.probe,
		ui.probeBar,
		ui.probeRise,
		ui.panelBody,
		ui.infoSurface,
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
		ui.volumePop,
		ui.volumeTrack,
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
	let entranceTimer: number | null = null;
	let currentLrcIndex = -1;
	let currentTrack: TrackInfo | null = null;
	let playlistData: TrackInfo[] = [];
	let playlistRenderedCount = 0;
	let pillLyricsEnabled =
		localStorage.getItem(PILL_LYRICS_STORAGE_KEY) !== "false";

	// ── 定位与拖拽 ───────────────────────────────────────────
	// 锚点是组件的左下角：left 向右为正、bottom 向上为正
	let posX = EDGE_MARGIN;
	let posY = EDGE_MARGIN;
	let drag: DragSession | null = null;
	let suppressClick = false;

	/**
	 * 当前形态展开到位后的尺寸。用探针与未被裁剪的信息层 / 面板实测，
	 * 而不是读正在过渡中的根元素宽高；bar 态略高估（未扣掉 dock 压住卡片的
	 * 负边距），夹取时保守一点比贴边上溢更安全。
	 */
	function footprint(): { width: number; height: number } {
		const disc = ui.disc?.offsetWidth ?? EDGE_MARGIN;
		if (shape === "disc") return { width: disc, height: disc };
		// 歌词态与展开态的 dock 同高，差别只在信息层与面板是否占位
		const infoH = shape === "bar" ? (ui.infoSurface?.offsetHeight ?? 0) : 0;
		const stageH = (ui.probeBar?.offsetHeight ?? 0) + infoH;
		// pill 态唱片探出舞台的量就是 --mp-disc-rise；bar 态圆心压在 dock 上沿，被信息层包住
		const overhang =
			shape === "pill"
				? (ui.probeRise?.offsetHeight ?? 0)
				: Math.max(0, disc / 2 - infoH);
		const panelH = panelOpen ? (ui.panelBody?.offsetHeight ?? 0) : 0;
		return {
			width: ui.probe?.offsetWidth ?? stageH,
			height: stageH + panelH + overhang,
		};
	}

	function applyPosition(): void {
		const { width, height } = footprint();
		const maxX = Math.max(EDGE_MARGIN, window.innerWidth - width - EDGE_MARGIN);
		const maxY = Math.max(
			EDGE_MARGIN,
			window.innerHeight - height - EDGE_MARGIN,
		);
		posX = Math.min(Math.max(posX, EDGE_MARGIN), maxX);
		posY = Math.min(Math.max(posY, EDGE_MARGIN), maxY);
		root.style.setProperty("--mp-x", `${Math.round(posX)}px`);
		root.style.setProperty("--mp-y", `${Math.round(posY)}px`);
	}

	function loadPosition(): void {
		let raw: string | null = null;
		try {
			raw = localStorage.getItem(POSITION_STORAGE_KEY);
		} catch {
			return;
		}
		if (!raw) return;
		try {
			const saved = JSON.parse(raw) as { left?: unknown; bottom?: unknown };
			if (typeof saved.left === "number" && Number.isFinite(saved.left)) {
				posX = saved.left;
			}
			if (typeof saved.bottom === "number" && Number.isFinite(saved.bottom)) {
				posY = saved.bottom;
			}
		} catch {
			// 存坏了就回默认位置，不影响播放
		}
	}

	function savePosition(): void {
		try {
			localStorage.setItem(
				POSITION_STORAGE_KEY,
				JSON.stringify({ left: posX, bottom: posY }),
			);
		} catch {
			// 隐私模式写不进去，位置只活在本次会话
		}
	}

	root.addEventListener(
		"pointerdown",
		(event) => {
			if (event.pointerType === "mouse" && event.button !== 0) return;
			const target = event.target;
			if (target instanceof Element && target.closest(DRAG_EXCLUDE)) return;
			drag = {
				pointerId: event.pointerId,
				startX: event.clientX,
				startY: event.clientY,
				originX: posX,
				originY: posY,
				active: false,
			};
		},
		{ signal },
	);

	root.addEventListener(
		"pointermove",
		(event) => {
			if (!drag || drag.pointerId !== event.pointerId) return;
			const dx = event.clientX - drag.startX;
			const dy = event.clientY - drag.startY;
			if (!drag.active) {
				if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) {
					return;
				}
				drag.active = true;
				root.classList.add("is-dragging");
				root.setPointerCapture(event.pointerId);
			}
			posX = drag.originX + dx;
			posY = drag.originY - dy;
			applyPosition();
		},
		{ signal },
	);

	function endDrag(event: PointerEvent): void {
		if (!drag || drag.pointerId !== event.pointerId) return;
		if (drag.active) {
			// 拖拽收尾的那次 click 既不能切形态，也不能被「点击组件外」收回去
			suppressClick = true;
			window.setTimeout(() => {
				suppressClick = false;
			}, 0);
			savePosition();
		}
		root.classList.remove("is-dragging");
		drag = null;
	}

	root.addEventListener("pointerup", endDrag, { signal });
	root.addEventListener("pointercancel", endDrag, { signal });

	root.addEventListener(
		"click",
		(event) => {
			if (!suppressClick) return;
			suppressClick = false;
			event.preventDefault();
			event.stopImmediatePropagation();
		},
		{ capture: true, signal },
	);

	// 组件内没有需要 HTML5 拖放的元素，禁掉唱片与封面被原生拖出的行为
	root.addEventListener("dragstart", (event) => event.preventDefault(), {
		signal,
	});

	// ── 形态机 ───────────────────────────────────────────────
	function setShape(next: WidgetShape): void {
		if (shape === next) return;
		shape = next;
		root.dataset.state = next;
		// 形态换代会改变组件占位，尺寸变大时把位置滑回视口内
		applyPosition();
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

	// ── 展开卡面板（歌单 / 歌词双 tab） ───────────────────────
	function moveTabIndicator(): void {
		const indicator = ui.tabIndicator;
		const active = root.querySelector<HTMLElement>(
			".music-player__tab.is-active",
		);
		if (!indicator || !active) return;
		indicator.style.width = `${active.offsetWidth}px`;
		indicator.style.transform = `translate3d(${active.offsetLeft}px, 0, 0)`;
	}

	function setPanelTab(tab: PanelTab): void {
		ui.tabPlaylist?.classList.toggle("is-active", tab === "playlist");
		ui.tabLyrics?.classList.toggle("is-active", tab === "lyrics");
		ui.playlistView?.classList.toggle("is-active", tab === "playlist");
		ui.lyricsView?.classList.toggle("is-active", tab === "lyrics");
		moveTabIndicator();
	}

	/** 面板展开时给已渲染的歌单条目补一次逐项入场 */
	function playTrackEntrance(): void {
		const list = ui.playlistList;
		if (!list) return;
		list.classList.remove("is-entering");
		// 强制回流，连续开关面板时动画才会重放而不是被合并
		void list.offsetWidth;
		list.classList.add("is-entering");
		if (entranceTimer !== null) window.clearTimeout(entranceTimer);
		entranceTimer = window.setTimeout(() => {
			entranceTimer = null;
			list.classList.remove("is-entering");
		}, TRACK_ENTRANCE_MS);
	}

	function setPanelOpen(open: boolean): void {
		panelOpen = open;
		root.dataset.panel = open ? "open" : "closed";
		ui.btnPlaylist?.classList.toggle("is-active", open);
		if (open) {
			setPanelTab("playlist");
			playTrackEntrance();
		}
		// 卡片向上长高，靠近顶边时整体回弹到视口内
		applyPosition();
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
		const label = `${Math.round(pct)}%`;
		// 填充与滑块的位置由 CSS 从 --vol 派生（叠加 --vol-over 越界量），此处只写已提交位置
		ui.volumePop?.style.setProperty("--vol", pct.toFixed(2));
		if (ui.volumeBubble) ui.volumeBubble.textContent = label;
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
			// 入场错峰序号，超出上限的条目同批出现
			itemEl.style.setProperty(
				"--mp-i",
				String(Math.min(idx, TRACK_STAGGER_MAX)),
			);
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
	/**
	 * surface 是起手并捕获指针的区域，measure 是量取比例的区域，两者可以不同：
	 * 音量条整颗胶囊都能拖，但比值只按轨道宽度算。
	 */
	function bindDrag(
		surface: HTMLElement | null,
		onRatio: (ratio: number, rawRatio: number) => void,
		onCommit?: (ratio: number) => void,
		onStart?: () => void,
		measure?: HTMLElement | null,
	): void {
		if (!surface) return;
		const rail = measure ?? surface;
		surface.addEventListener(
			"pointerdown",
			(event) => {
				event.preventDefault();
				surface.setPointerCapture(event.pointerId);
				onStart?.();
				const apply = (clientX: number): number => {
					const rect = rail.getBoundingClientRect();
					// raw 保留越界量供橡皮筋使用，夹取后的值才是真实位置
					const raw = (clientX - rect.left) / (rect.width || 1);
					const ratio = Math.min(1, Math.max(0, raw));
					onRatio(ratio, raw);
					return ratio;
				};
				apply(event.clientX);
				const move = (moveEvent: PointerEvent): void => {
					apply(moveEvent.clientX);
				};
				const up = (upEvent: PointerEvent): void => {
					surface.removeEventListener("pointermove", move);
					surface.removeEventListener("pointerup", up);
					surface.removeEventListener("pointercancel", up);
					onCommit?.(apply(upEvent.clientX));
				};
				surface.addEventListener("pointermove", move);
				surface.addEventListener("pointerup", up);
				surface.addEventListener("pointercancel", up);
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

	// 音量条的弹性反馈全部走 CSS 自定义属性：--vol-over 是越界位移，--vol-stretch 是越界比例
	//（用于「拉得越紧越细」与两端图标外移）。变量写在 popover 上，轨道、滑块、气泡、图标共用一份。
	// 位置本身仍由 fm:volume 回写，避免拖拽与状态两套真相。
	let volumeBubbleTimer: number | null = null;

	function setVolumeStretch(over: number): void {
		ui.volumePop?.style.setProperty("--vol-over", `${over.toFixed(2)}px`);
		ui.volumePop?.style.setProperty(
			"--vol-stretch",
			(Math.abs(over) / VOLUME_STRETCH_PX).toFixed(3),
		);
	}

	function applyVolumeStretch(rawRatio: number): void {
		const track = ui.volumeTrack;
		if (!track || prefersReducedMotion()) {
			setVolumeStretch(0);
			return;
		}
		const width = track.getBoundingClientRect().width || 1;
		const overshot = rawRatio > 1 ? rawRatio - 1 : rawRatio < 0 ? rawRatio : 0;
		setVolumeStretch(rubberBand(overshot * width, VOLUME_STRETCH_PX));
	}

	bindDrag(
		ui.volumePop,
		(ratio, rawRatio) => {
			mgr.setVolume(ratio);
			applyVolumeStretch(rawRatio);
		},
		() => {
			// 先摘掉 data-dragging 让位置过渡回来，越界量才谈得出回弹
			ui.volumePop?.toggleAttribute("data-dragging", false);
			setVolumeStretch(0);
			if (volumeBubbleTimer !== null) window.clearTimeout(volumeBubbleTimer);
			volumeBubbleTimer = window.setTimeout(() => {
				volumeBubbleTimer = null;
				ui.volumePop?.toggleAttribute("data-bubble", false);
			}, VOLUME_BUBBLE_LINGER_MS);
		},
		() => {
			if (volumeBubbleTimer !== null) {
				window.clearTimeout(volumeBubbleTimer);
				volumeBubbleTimer = null;
			}
			ui.volumePop?.toggleAttribute("data-dragging", true);
			ui.volumePop?.toggleAttribute("data-bubble", true);
		},
		ui.volumeTrack,
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
			// 拖拽收尾落在组件外时 click 目标是公共祖先，这次不算「点击组件外」
			if (suppressClick) {
				suppressClick = false;
				return;
			}
			const target = event.target;
			if (target instanceof Node && root.contains(target)) return;
			if (panelOpen) setPanelOpen(false);
			clearCollapseTimer();
			if (shape !== "bar") return;
			setShape(isPlaying ? playingRestingShape() : "disc");
		},
		{ signal },
	);

	window.addEventListener(
		"resize",
		() => {
			scheduleMarquee();
			applyPosition();
			moveTabIndicator();
		},
		{ passive: true, signal },
	);

	// ── 初始状态 ─────────────────────────────────────────────
	root.__musicSync = syncAll;
	root.dataset.state = shape;
	root.dataset.panel = "closed";
	root.dataset.playing = "false";
	updatePillLyricsButton();
	// 首次定位不参与过渡：is-dragging 关掉根元素过渡，强制回流后再放开
	root.classList.add("is-dragging");
	loadPosition();
	applyPosition();
	void root.offsetWidth;
	root.classList.remove("is-dragging");
	if (mgr.getState().initialized) syncAll();
}
