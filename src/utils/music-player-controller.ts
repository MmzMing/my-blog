import I18nKey from "@/i18n/i18nKey";
import { i18n } from "@/i18n/translation";

/**
 * 桌面可拖拽音乐组件的视图控制器。
 * 播放引擎仍是 MusicManager 暴露的 window.__fireflyMusic 单例（fm:* 事件广播），
 * 本模块只负责三态形态机（disc / pill / bar）、展开卡（歌单 / 歌词面板 + 信息层）、
 * 播放器上方的浮动逐字歌词、拖拽定位与列表渲染。
 *
 * 浮动歌词：不再塞进胶囊或加背景，而是在唱片右侧铺一层无底的字云。
 * 整行按阅读顺序排字，上下错位、字号错落；超过字云宽度不换行，
 * 左侧渐隐、整行左移给右侧新字让位，揭示仍按阅读顺序逐个点亮。
 * 揭示时钟读 audio.currentTime（而非 timeupdate 的 250ms 粒度）：播放中走 rAF，
 * 暂停时停表；拖动进度回退超过容差就整行重建，已唱字符直接落位不补动画。
 * 解析层拆出的译文（translation）作为第三层叠在正文下方，字号更小，
 * 但与正文共用同一套逐字揭示与随机排布；三态按钮可切正文+译文 / 仅译文 / 仅正文。
 *
 * 形态转移约定：
 * - 未播放：disc ⇄ bar（点击唱片切换；点击组件外收回 disc）；
 * - 播放中：静置形态固定为纯唱片（歌词开启时字云浮在唱片右侧）；
 *   点击唱片才展开 bar；再次点击唱片或点击组件外收回唱片，不随悬停自动开合；
 * - 歌单按钮开合的是 dock 上方那一张展开卡：卡片只向上长出面板，水平缩进不变，
 *   信息层随之上移留在卡片底部（面板在上、信息层在下，唱片始终骑在左下角接缝）。
 *
 * 拖拽：组件任意非交互区域按住即可拖动，位移超过阈值才判定为拖拽并抑制随后的 click，
 * 因此唱片点击切形态与拖唱片移动互不干扰；位置写 localStorage，且始终按当前形态的
 * 目标尺寸夹在视口内（形态或面板开合导致尺寸变化时平滑回弹）。
 */

type WidgetShape = "disc" | "pill" | "bar";
type PanelTab = "playlist" | "lyrics";
/** 歌词文字模式：正文+译文 / 仅译文 / 仅正文 */
type LyricDisplayMode = "both" | "translation" | "original";

interface LyricWord {
	time: number;
	text: string;
}

interface LyricLine {
	time: number;
	text: string;
	/** 解析层从行尾括号拆出的译文，不参与逐字揭示与字号估算 */
	translation?: string;
	words?: LyricWord[];
}

interface LyricChar {
	el: HTMLSpanElement;
	time: number;
	/** 正文行元素；译文条目没有，滚动定位时据此跳过 */
	rowEl?: HTMLDivElement;
}

interface LyricLayerState {
	lineIndex: number;
	chars: LyricChar[];
	revealed: number;
	lastTime: number;
	el: HTMLDivElement;
	rowEl: HTMLDivElement;
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

const LYRICS_SCROLL_RESUME_DELAY = 3000;
const PLAYLIST_BATCH_SIZE = 30;
const PILL_LYRICS_STORAGE_KEY = "music-pill-lyrics";
const LYRIC_MODE_STORAGE_KEY = "music-pill-lyric-mode";
const LYRIC_MODES: LyricDisplayMode[] = ["both", "translation", "original"];
const POSITION_STORAGE_KEY = "music-player-pos";
/** 逐字揭示的最长铺开时长（秒）：行间隔过大时不让字符一个个拖太久 */
const LYRIC_MAX_SPAN = 6;
/** 逐字揭示的最短铺开时长（秒） */
const LYRIC_MIN_SPAN = 0.7;
/**
 * 逐字步长（秒/字）。LRC 只有行首时间，若把整行铺到下一行的时间戳，
 * 长间奏前的歌词会拖到唱完才显示完；固定步长保证整行提前点亮。
 */
const LYRIC_CHAR_STEP = 0.22;
/** 一次补亮的字符超过该数量视为进度跳转，直接重建整行而不是排队补动画 */
const LYRIC_JUMP_LIMIT = 3;
/** 离场层的上飘淡出时长（ms），与 CSS 过渡对齐 */
const LYRIC_LEAVE_MS = 900;
/** 与 CSS --mp-edge 对齐的视口安全边距 */
const EDGE_MARGIN = 20;
/** 超过该位移才判定为拖拽，避免与点击切形态冲突 */
const DRAG_THRESHOLD = 4;
/** 歌单条目逐项入场的错峰上限与步长，需与 CSS 的 animation-delay 对齐 */
const TRACK_STAGGER_MAX = 12;
const TRACK_STAGGER_MS = 26;
const TRACK_ENTRANCE_MS = 340 + TRACK_STAGGER_MAX * TRACK_STAGGER_MS;
/** 这些区域承担各自的交互，不作为拖拽起点。
    进度行整行排除：轨道判定区放大了上下留白，点偏一点都不该变成拖播放器 */
const DRAG_EXCLUDE =
	".music-player__btn, .music-player__progress-row, .music-player__progress, .music-player__volume, .music-player__tab, .music-player__playlist-list, .music-player__lyrics-list";
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

/**
 * mulberry32：逐字歌词的行内抖动用固定种子生成，
 * 同一行每次重建都得到同一套排布，切歌回来不会「重新洗牌」。
 */
function createSeededRandom(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
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
		btnTranslation: $(".music-player__btn--translation"),
		iconTransBoth: $(".music-player__icon-trans-both"),
		iconTransOnly: $(".music-player__icon-trans-only"),
		iconOriginalOnly: $(".music-player__icon-original-only"),
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
		lyricCloud: $(".music-player__lyric-cloud"),
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
		ui.btnTranslation,
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
	let panelOpen = false;
	let isPlaying = false;
	let isSeeking = false;
	let isUserScrollingLyrics = false;
	let lyricsScrollTimer: number | null = null;
	let entranceTimer: number | null = null;
	let currentLrcIndex = -1;
	let currentTrack: TrackInfo | null = null;
	let playlistData: TrackInfo[] = [];
	let playlistRenderedCount = 0;
	let lyricsEnabled = localStorage.getItem(PILL_LYRICS_STORAGE_KEY) !== "false";
	let lyricMode = readLyricMode();
	let lyricsStatus = "loading";
	let lyricLayer: LyricLayerState | null = null;
	let lyricRaf: number | null = null;
	let lyricLeaveTimer: number | null = null;

	function readLyricMode(): LyricDisplayMode {
		const stored = localStorage.getItem(LYRIC_MODE_STORAGE_KEY);
		return stored === "translation" || stored === "original" ? stored : "both";
	}

	// ── 定位与拖拽 ───────────────────────────────────────────
	// posX 是唱片左缘的屏幕坐标；posY 是组件底边。唱片在右半边时，
	// 根元素改为右边缘锚定，展开卡与字云向左生长，唱片不被挤走。
	let posX = EDGE_MARGIN;
	let posY = EDGE_MARGIN;
	let drag: DragSession | null = null;
	let suppressClick = false;

	/** 展开到位后的高度估算；宽度不再参与夹取，锚点只关心唱片本身 */
	function footprintHeight(): number {
		const disc = ui.disc?.offsetWidth ?? EDGE_MARGIN;
		if (shape === "disc") return disc;
		// 歌词态与展开态的 dock 同高，差别只在信息层与面板是否占位
		const infoH = shape === "bar" ? (ui.infoSurface?.offsetHeight ?? 0) : 0;
		const stageH = (ui.probeBar?.offsetHeight ?? 0) + infoH;
		// pill 态唱片探出舞台的量就是 --mp-disc-rise；bar 态圆心压在 dock 上沿，被信息层包住
		const overhang =
			shape === "pill"
				? (ui.probeRise?.offsetHeight ?? 0)
				: Math.max(0, disc / 2 - infoH);
		const panelH = panelOpen ? (ui.panelBody?.offsetHeight ?? 0) : 0;
		return stageH + panelH + overhang;
	}

	function applyPosition(): void {
		const disc = ui.disc?.offsetWidth ?? EDGE_MARGIN;
		const maxX = Math.max(EDGE_MARGIN, window.innerWidth - disc - EDGE_MARGIN);
		const maxY = Math.max(
			EDGE_MARGIN,
			window.innerHeight - footprintHeight() - EDGE_MARGIN,
		);
		posX = Math.min(Math.max(posX, EDGE_MARGIN), maxX);
		posY = Math.min(Math.max(posY, EDGE_MARGIN), maxY);

		const flipped = posX + disc / 2 > window.innerWidth / 2;
		root.dataset.anchor = flipped ? "right" : "left";
		if (flipped) {
			root.style.setProperty(
				"--mp-right",
				`${Math.round(window.innerWidth - posX - disc)}px`,
			);
		} else {
			root.style.removeProperty("--mp-right");
			root.style.setProperty("--mp-x", `${Math.round(posX)}px`);
		}
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

	/** 播放中的静置形态固定为纯唱片：关闭歌词时也只留转动的唱片，不再回退到曲名胶囊 */
	function playingRestingShape(): WidgetShape {
		return "disc";
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
		// 控制条只由点击开合，播放状态切换只负责把唱片态放到位
		if (playing && shape !== "bar") {
			const resting = playingRestingShape();
			if (shape !== resting) setShape(resting);
		}
		updatePillText();
		// 暂停时字云保留并冻结，恢复播放继续揭示
		ui.lyricCloud?.setAttribute("data-paused", playing ? "false" : "true");
		if (!playing) stopLyricLoop();
		else if (lyricLayer) startLyricLoop();
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

	function updateLyricsButton(): void {
		ui.btnLyrics?.classList.toggle("is-active", lyricsEnabled);
		ui.btnLyrics?.setAttribute("aria-pressed", String(lyricsEnabled));
		ui.iconLrcOn?.classList.toggle("hidden", !lyricsEnabled);
		ui.iconLrcOff?.classList.toggle("hidden", lyricsEnabled);
	}

	/** 三态按钮：图标与提示同步当前模式 */
	function updateLyricModeUI(): void {
		const label =
			lyricMode === "both"
				? i18n(I18nKey.musicLyricsBoth)
				: lyricMode === "translation"
					? i18n(I18nKey.musicLyricsTranslationOnly)
					: i18n(I18nKey.musicLyricsOriginalOnly);
		ui.btnTranslation?.setAttribute("aria-label", label);
		ui.btnTranslation?.setAttribute("data-tooltip", label);
		ui.iconTransBoth?.classList.toggle("hidden", lyricMode !== "both");
		ui.iconTransOnly?.classList.toggle("hidden", lyricMode !== "translation");
		ui.iconOriginalOnly?.classList.toggle("hidden", lyricMode !== "original");
	}

	/** 胶囊只显示曲名与艺术家，歌词交给上方的字云 */
	function updatePillText(): void {
		const label = ui.pillLabel;
		if (!label) return;
		const text = currentTrack
			? `${currentTrack.name} - ${currentTrack.artist}`
			: i18n(I18nKey.musicNoPlaying);
		if (label.textContent !== text) {
			label.textContent = text;
			scheduleMarquee();
		}
	}

	/** 胶囊文本超宽时跑马灯：偏移量与时长按溢出宽度算，写 CSS 变量交给 keyframes */
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
			const text = i18n(I18nKey.musicLoadingLyrics);
			placeholder(text);
			showLyricTip(text);
			return;
		}
		if (status === "failed") {
			const text = i18n(I18nKey.musicFailedLyrics);
			placeholder(text);
			showLyricTip(text);
			return;
		}
		if (lyrics.length === 0) {
			const text = i18n(I18nKey.musicNoLyrics);
			placeholder(text);
			showLyricTip(text);
			return;
		}
		lyrics.forEach((line, index) => {
			const lineEl = document.createElement("div");
			lineEl.className = "music-player__lrc-line";
			const textEl = document.createElement("span");
			textEl.className = "music-player__lrc-text";
			textEl.textContent =
				lyricMode === "translation" && line.translation
					? line.translation
					: line.text;
			lineEl.appendChild(textEl);
			if (lyricMode === "both" && line.translation) {
				const transEl = document.createElement("span");
				transEl.className = "music-player__lrc-line-trans";
				transEl.textContent = line.translation;
				lineEl.appendChild(transEl);
			}
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
		// 字云只在换行时重建：面板强制高亮（滚动恢复 / resync）不该重放动画
		renderLyricCloud(index);
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

	// ── 播放器上方的浮动逐字歌词 ─────────────────────────────
	function startLyricLoop(): void {
		if (lyricRaf !== null) return;
		lyricRaf = window.requestAnimationFrame(lyricTick);
	}

	function stopLyricLoop(): void {
		if (lyricRaf === null) return;
		window.cancelAnimationFrame(lyricRaf);
		lyricRaf = null;
	}

	function lyricTick(): void {
		lyricRaf = null;
		if (!lyricLayer || !isPlaying) return;
		applyLyricReveal(mgr.getState().currentTime);
		// applyLyricReveal 可能因进度回退重建整行并顺带启动新循环，别叠出第二条时钟
		if (lyricRaf === null && lyricLayer && isPlaying) {
			lyricRaf = window.requestAnimationFrame(lyricTick);
		}
	}

	/** 已唱字符补到当前时刻；一次跳太多（拖动进度）就整行重建，避免连环补动画 */
	function applyLyricReveal(time: number): void {
		const state = lyricLayer;
		if (!state) return;
		if (time < state.lastTime - 0.3) {
			renderLyricCloud(currentLrcIndex, true);
			return;
		}
		state.lastTime = time;
		let target = state.revealed;
		while (target < state.chars.length && state.chars[target].time <= time) {
			target += 1;
		}
		if (target - state.revealed > LYRIC_JUMP_LIMIT) {
			renderLyricCloud(currentLrcIndex, true);
			return;
		}
		for (let i = state.revealed; i < target; i += 1) {
			state.chars[i].el.classList.add("is-on");
		}
		state.revealed = target;
		updateLyricScroll(state);
	}

	/**
	 * 行揭示窗口：按字数算出快速铺开时长，再夹进到下一行（或歌曲结束）的可用时间。
	 * 可用时间更长时按快速时长提前播完；更短时以可用时间为准，绝不超过下一行。
	 */
	function lyricRevealSpan(
		index: number,
		lyrics: LyricLine[],
		text: string,
	): { start: number; span: number } {
		const line = lyrics[index];
		const start = line.time;
		const next =
			index + 1 < lyrics.length ? lyrics[index + 1].time : Number.NaN;
		const count = Array.from(text.replace(/\s+/g, "")).length;
		const fastSpan = Math.min(
			LYRIC_MAX_SPAN,
			Math.max(LYRIC_MIN_SPAN, count * LYRIC_CHAR_STEP),
		);
		const duration = mgr.getState().duration;
		const available = Number.isFinite(next)
			? next - start
			: duration > start
				? duration - start
				: fastSpan;
		return { start, span: Math.max(0.2, Math.min(available, fastSpan)) };
	}

	/** 有逐词标签按词分组（保留词时间），否则按空白断词后匀速逐字 */
	function lyricWordGroups(
		line: LyricLine,
	): { text: string; time: number | null }[] {
		if (line.words && line.words.length > 0) {
			return line.words.map((word) => ({ text: word.text, time: word.time }));
		}
		return line.text
			.split(/\s+/)
			.filter((word) => word.length > 0)
			.map((text) => ({ text, time: null }));
	}

	function leaveLyricLayer(layer: HTMLElement): void {
		layer.classList.add("is-leaving");
		if (lyricLeaveTimer !== null) window.clearTimeout(lyricLeaveTimer);
		lyricLeaveTimer = window.setTimeout(() => {
			lyricLeaveTimer = null;
			ui.lyricCloud
				?.querySelectorAll(".music-player__lyric-layer.is-leaving")
				.forEach((el) => {
					el.remove();
				});
		}, LYRIC_LEAVE_MS);
	}

	function clearLyricCloud(): void {
		lyricLayer = null;
		stopLyricLoop();
		ui.lyricCloud
			?.querySelectorAll<HTMLElement>(
				".music-player__lyric-layer:not(.is-leaving), .music-player__lyric-tip",
			)
			.forEach((el) => {
				if (el.classList.contains("music-player__lyric-tip")) {
					el.remove();
					return;
				}
				leaveLyricLayer(el);
			});
	}

	/** 没有可显示歌词时，在字云位置给一条状态提示 */
	function showLyricTip(text: string): void {
		clearLyricCloud();
		if (!lyricsEnabled) return;
		const cloud = ui.lyricCloud;
		if (!cloud) return;
		const tip = document.createElement("div");
		tip.className = "music-player__lyric-tip";
		tip.textContent = text;
		cloud.appendChild(tip);
	}

	function renderLyricCloud(index: number, force = false): void {
		const lyrics = mgr.getState().lyrics as LyricLine[];
		const line =
			lyricsEnabled && index >= 0 && index < lyrics.length
				? lyrics[index]
				: null;
		const displayText =
			line && lyricMode === "translation" && line.translation
				? line.translation
				: line?.text;
		if (!line || !displayText?.trim()) {
			clearLyricCloud();
			return;
		}
		ui.lyricCloud
			?.querySelectorAll(".music-player__lyric-tip")
			.forEach((el) => {
				el.remove();
			});
		if (!force && lyricLayer?.lineIndex === index) return;
		const previous = lyricLayer;
		lyricLayer = null;
		stopLyricLoop();
		if (previous) {
			// 同一行重建（拖动进度）直接替换，不铺离场层
			if (previous.lineIndex === index) previous.el.remove();
			else leaveLyricLayer(previous.el);
		}
		buildLyricLayer(line, index);
	}

	function buildLyricLayer(line: LyricLine, index: number): void {
		const cloud = ui.lyricCloud;
		if (!cloud) return;
		const lyrics = mgr.getState().lyrics as LyricLine[];
		// 仅译文模式把译文当正文排布；其余模式正文仍是主文字
		const translationAsMain = lyricMode === "translation" && !!line.translation;
		const mainText = translationAsMain
			? (line.translation as string)
			: line.text;
		const { start, span } = lyricRevealSpan(index, lyrics, mainText);
		const groups = translationAsMain
			? mainText
					.split(/\s+/)
					.filter((word) => word.length > 0)
					.map((text) => ({ text, time: null }))
			: lyricWordGroups(line);
		const hasWordTimes = !translationAsMain && !!line.words?.length;
		let totalChars = 0;
		for (const group of groups) totalChars += Array.from(group.text).length;
		if (totalChars === 0) {
			clearLyricCloud();
			return;
		}

		// 单行铺开：超宽不换行，靠左侧渐隐 + 整行左移把新字带进来
		const cloudWidth = cloud.clientWidth || 384;

		// 布局从这一行固定的种子派生，拖动进度重建不会换花样
		const random = createSeededRandom((index + 1) * 7919 + totalChars * 31);

		const charTimes: number[] = [];
		if (hasWordTimes) {
			groups.forEach((group, groupIndex) => {
				const chars = Array.from(group.text);
				const groupStart = group.time ?? start;
				const next = groups[groupIndex + 1]?.time;
				const groupEnd = typeof next === "number" ? next : start + span;
				const duration = Math.max(0.12, groupEnd - groupStart);
				chars.forEach((_, charIndex) => {
					charTimes.push(groupStart + (charIndex / chars.length) * duration);
				});
			});
		} else {
			// 阅读顺序逐字点亮，不随机打乱
			for (let i = 0; i < totalChars; i += 1) {
				charTimes.push(start + (i / totalChars) * span);
			}
		}

		const baseFont = Math.min(
			26,
			Math.max(13, (cloudWidth / Math.max(1, totalChars)) * 0.82),
		);
		const layerEl = document.createElement("div");
		layerEl.className = "music-player__lyric-layer";
		layerEl.style.fontSize = `${baseFont.toFixed(1)}px`;
		layerEl.style.visibility = "hidden";

		const rowEl = document.createElement("div");
		rowEl.className = "music-player__lyric-row";
		layerEl.appendChild(rowEl);

		// 译文是第三层：和正文同一套逐字揭示，字号由 CSS 固定小一档
		const transText = lyricMode === "both" ? line.translation : undefined;
		const transRow = transText ? document.createElement("div") : null;
		if (transRow) {
			transRow.className =
				"music-player__lyric-row music-player__lyric-row--trans";
			layerEl.appendChild(transRow);
		}

		// 水平顺序不变，只做上下错位 + 轻微旋转/字号差异
		const decorateChar = (el: HTMLSpanElement, order: number): void => {
			const jitterY = Math.sin(order * 0.9) * 0.14 + (random() - 0.5) * 0.08;
			el.style.setProperty("--lc-jy", `${jitterY.toFixed(3)}em`);
			el.style.setProperty(
				"--lc-gap",
				`${(0.04 + random() * 0.16).toFixed(3)}em`,
			);
			el.style.setProperty(
				"--lc-rot",
				`${((random() - 0.5) * 8).toFixed(2)}deg`,
			);
			el.style.setProperty("--lc-scale", (0.94 + random() * 0.12).toFixed(3));
		};

		const charEntries: LyricChar[] = [];
		let charIndex = 0;
		for (const group of groups) {
			for (const ch of Array.from(group.text)) {
				const charEl = document.createElement("span");
				charEl.className = "music-player__lyric-char";
				charEl.textContent = ch;
				decorateChar(charEl, charIndex);
				// 字号阶梯收敛到 0.82–1.06em，整体比旧版小一档
				charEl.style.setProperty(
					"--lc-size",
					(0.82 + random() * 0.24).toFixed(3),
				);
				rowEl.appendChild(charEl);
				charEntries.push({
					el: charEl,
					time: charTimes[charIndex] ?? start,
					rowEl,
				});
				charIndex += 1;
			}
		}

		if (transRow && transText) {
			const transChars = Array.from(transText);
			transChars.forEach((ch, transIndex) => {
				const charEl = document.createElement("span");
				charEl.className =
					"music-player__lyric-char music-player__lyric-char--trans";
				charEl.textContent = ch;
				decorateChar(charEl, transIndex);
				transRow.appendChild(charEl);
				// 译文没有自己的时间，均匀铺在正文同一揭示窗口里
				charEntries.push({
					el: charEl,
					time: start + (transIndex / transChars.length) * span,
				});
			});
		}

		cloud.appendChild(layerEl);
		layerEl.style.visibility = "";

		// 按时间排序后补亮（逐词数据不保证严格递增，排序兜底）
		charEntries.sort((a, b) => a.time - b.time);
		const now = mgr.getState().currentTime;
		let revealed = 0;
		while (revealed < charEntries.length && charEntries[revealed].time <= now) {
			revealed += 1;
		}
		for (let i = 0; i < revealed; i += 1) {
			// 从中间进入（拖动进度 / 切歌）时已唱字符直接落位，不排队补动画
			charEntries[i].el.classList.add("is-on", "is-instant");
		}

		lyricLayer = {
			lineIndex: index,
			chars: charEntries,
			revealed,
			lastTime: now,
			el: layerEl,
			rowEl,
		};
		updateLyricScroll(lyricLayer);
		if (isPlaying) startLyricLoop();
	}

	/** 单行超宽时整行左移，右侧继续加入新字；左侧字符按位置逐个淡出 */
	function updateLyricScroll(state: LyricLayerState): void {
		const cloud = ui.lyricCloud;
		if (!cloud) return;
		let right = 0;
		for (let i = state.revealed - 1; i >= 0; i -= 1) {
			const entry = state.chars[i];
			// 译文条目没有 rowEl，滚动位置只由正文最后一个已亮字符决定
			if (!entry.rowEl) continue;
			right = entry.el.offsetLeft + entry.el.offsetWidth;
			break;
		}
		const width = cloud.clientWidth || 384;
		const offset = Math.max(0, right - width);
		state.rowEl.style.transform =
			offset > 0 ? `translate3d(${-offset.toFixed(1)}px, 0, 0)` : "";
		// 不裁切整行：完全移出的字符直接透明，左缘 1.2em 内渐变，
		// 避免字形和辉光被裁出一条硬边。
		const fade =
			(Number.parseFloat(getComputedStyle(state.rowEl).fontSize) || 16) * 1.2;
		for (const entry of state.chars) {
			if (!entry.rowEl || !entry.el.classList.contains("is-on")) continue;
			const rightEdge = entry.el.offsetLeft + entry.el.offsetWidth - offset;
			const opacity = Math.max(0, Math.min(1, rightEdge / fade));
			entry.el.style.opacity = opacity < 1 ? opacity.toFixed(3) : "";
		}
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
			clearLyricCloud();
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
		lyricsStatus = s.lyrics.length > 0 ? "loaded" : "none";
		renderLyricsUI(s.lyrics as LyricLine[], lyricsStatus);
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
		clearLyricCloud();
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
		lyricsStatus = d.status;
		renderLyricsUI(d.lyrics, d.status);
	});

	on<{ index: number }>("fm:lrc-index", (d) => {
		updateLrcHighlight(d.index);
	});

	on<{ message: string }>("fm:error", (d) => {
		setLoading(false);
		if (ui.title) ui.title.textContent = d.message || i18n(I18nKey.musicError);
		updatePillText();
		clearLyricCloud();
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
			lyricsEnabled = !lyricsEnabled;
			try {
				localStorage.setItem(PILL_LYRICS_STORAGE_KEY, String(lyricsEnabled));
			} catch {
				// 隐私模式写不进去，开关只活在本次会话
			}
			updateLyricsButton();
			if (lyricsEnabled) {
				renderLyricCloud(mgr.getState().currentLrcIndex, true);
			} else {
				clearLyricCloud();
			}
		},
		{ signal },
	);

	// 三态循环：正文+译文 → 仅译文 → 仅正文
	ui.btnTranslation?.addEventListener(
		"click",
		() => {
			const current = LYRIC_MODES.indexOf(lyricMode);
			lyricMode = LYRIC_MODES[(current + 1) % LYRIC_MODES.length];
			try {
				localStorage.setItem(LYRIC_MODE_STORAGE_KEY, lyricMode);
			} catch {
				// 隐私模式写不进去，模式只活在本次会话
			}
			updateLyricModeUI();
			renderLyricsUI(mgr.getState().lyrics as LyricLine[], lyricsStatus);
			renderLyricCloud(mgr.getState().currentLrcIndex, true);
		},
		{ signal },
	);

	ui.playlistList?.addEventListener("scroll", onPlaylistScroll, {
		passive: true,
		signal,
	});

	// 点击组件外：收歌单面板并收回控制条（回到唱片）
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
			if (shape !== "bar") return;
			setShape("disc");
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
	updateLyricsButton();
	updateLyricModeUI();
	// 首次定位不参与过渡：is-dragging 关掉根元素过渡，强制回流后再放开
	root.classList.add("is-dragging");
	loadPosition();
	applyPosition();
	void root.offsetWidth;
	root.classList.remove("is-dragging");
	if (mgr.getState().initialized) syncAll();
}
