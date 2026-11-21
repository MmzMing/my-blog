/**
 * 灵动岛运行时控制器：把 wisland 的几何 / 弹簧 / 交互模型搬到浏览器。
 *
 * - 收起态：贴四边之一，贴边侧用 fillet 与屏幕边缘连成一体，常态圆角呼吸 + 边缘流光；
 * - 悬停 / 点击：展开为导航面板，标签宽度由弹簧驱动（选中项展开文字，其余仅图标）；
 * - 拖拽：跟随指针、按速度变泪滴，液桥拉伸超过阈值断开并留下缩回水滴；松手吸附最近边；
 * - 音乐：从 __fireflyMusic.getPeak() 取能量，驱动收起态波形形变与律动条。
 *
 * 只绑在持久化节点上（Swup 容器外），一次安装全程有效，destroy 清理全部监听与计时器。
 */
import { PetFace, type PetFrame } from "@/utils/island-pet";
import {
	attachedOutlinePoints,
	BREAK,
	bodyPathD,
	bodyPoints,
	clamp,
	type Drip,
	deform,
	dripPathD,
	type Edge,
	easeOut,
	edgeCorners,
	FILLET,
	isHorizontal,
	JOIN,
	lerp,
	type Point,
	polyPathD,
	type Radii,
	type Rect,
	Spring,
	smooth,
	unitedNeckPoints,
} from "@/utils/island-physics";
import { getStoredTheme, setTheme } from "@/utils/setting-utils";
import { onNavigation } from "@/utils/swup-lifecycle";

export interface IslandTab {
	key: string;
	label: string;
	icon: string;
}

/** 收起态左侧的「当前页面」信息 */
export interface IslandPage {
	path: string;
	name: string;
	icon: string;
}

/** 站点导航链接（目录模式子列表卡片的数据） */
export interface IslandLink {
	name: string;
	href: string;
	icon: string;
	external: boolean;
}

/** 目录模式的站点导航分组（name 为 null 的组是顶级项集合） */
export interface IslandNavGroup {
	name: string | null;
	items: IslandLink[];
}

/** 目录模式菜单行的一级项：带 href 直接跳转，带 groupIndex 悬停展开子菜单 */
export interface IslandMenuItem {
	name: string;
	href: string | null;
	icon: string | null;
	groupIndex: number | null;
}

export interface IslandConfig {
	tabs: IslandTab[];
	pages: IslandPage[];
	initialTab: string;
	navGroups: IslandNavGroup[];
	navMenu: IslandMenuItem[];
	edge: Edge;
	pos: number;
	api: string;
	postBaseUrl: string;
	postPath: string;
	locale: string;
	expandMode: "hover" | "click";
	labels: {
		notPlaying: string;
		nowPlaying: string;
		play: string;
		pause: string;
		weekFormat: string;
		postCount: string;
	};
}

const COLLAPSED_H = 44;
/** 液桥收腰从离边 3px 起算：再近本体就等于贴住了，收腰一开始就会把两侧圆角整片缩进去 */
const NECK_LIFT = 3;
/** 亚像素级才算贴住。attachedOutlinePoints 假定本体压在边线上，还留着缝时走液桥轮廓，
    否则最后几像素里轮廓会被提前画到贴边位置，跨过阈值时整块竖直跳一下 */
const DOCK_GAP = 0.5;
/* 收起态三种形态：首页只有小形象；其它页「页面名 · 眼睛 · 时间」；
   文章页要放下标题，再放宽一档 */
const COLLAPSED_W_HOME = 176;
const COLLAPSED_W_IDLE = 248;
const COLLAPSED_W_POST = 384;
/* 音乐面不再固定 440：宽度跟着「封面 + 歌名 + 波形」的实际内容走，
   放不下才涨到上限；仍放不下就由歌名整体左滑把后半段带出来。 */
const COLLAPSED_W_MEDIA_MIN = 132;
const COLLAPSED_W_MEDIA_MAX = 220;
/* 展开态不再写死 664×300：宽高都按视口比例算，再夹在上下限之间，
   保证小窗口不溢出、大窗口不空旷。 */
const EXPANDED_W_MIN = 520;
const EXPANDED_W_MAX = 700;
const EXPANDED_W_RATIO = 0.52;
const EXPANDED_H_MIN = 312;
const EXPANDED_H_MAX = 380;
const EXPANDED_H_RATIO = 0.4;
/* 贴左 / 右边时面板改成竖长条：单列排版的名片 + 热力图需要更多高度，
   宽度收窄到接近原资料卡的观感。 */
const EXPANDED_SIDE_W_MIN = 360;
const EXPANDED_SIDE_W_MAX = 430;
const EXPANDED_SIDE_W_RATIO = 0.3;
const EXPANDED_SIDE_H_MIN = 460;
const EXPANDED_SIDE_H_MAX = 580;
const EXPANDED_SIDE_H_RATIO = 0.62;
/* 导航条 + 间距 + 面板上下内边距：内容高加上它才是展开面板的总高 */
const EXPANDED_CHROME_H = 78;
const EDGE_MARGIN = 6;
const HOVER_EXPAND_MS = 200;
/* 鼠标移出后回缩的宽限时间：对齐 wisland 的 collapse_delay_ms（450ms），
   给「从胶囊移到面板」留足余量，整体节奏也更从容 */
const COLLAPSE_DELAY_MS = 450;
const DRAG_THRESHOLD = 4;
const STORAGE_KEY = "firefly-dynamic-island";

interface StoredState {
	edge?: Edge;
	pos?: number;
	expandMode?: IslandConfig["expandMode"];
	/** 左下角悬浮音乐盒子是否显示（缺省开启） */
	musicBox?: boolean;
}

function readStored(): StoredState {
	try {
		const raw = window.localStorage.getItem(STORAGE_KEY);
		if (!raw) return {};
		const value = JSON.parse(raw) as StoredState;
		return value && typeof value === "object" ? value : {};
	} catch {
		return {};
	}
}

function writeStored(state: StoredState): void {
	try {
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
	} catch {
		/* 隐私模式下写入失败可忽略 */
	}
}

function isEdge(value: unknown): value is Edge {
	return (
		value === "top" ||
		value === "bottom" ||
		value === "left" ||
		value === "right"
	);
}

function parseConfig(root: HTMLElement): IslandConfig {
	const node = root.querySelector<HTMLScriptElement>("[data-di-config]");
	if (!node?.textContent) throw new Error("DynamicIsland config missing");
	const raw = JSON.parse(node.textContent) as IslandConfig;
	const stored = readStored();
	if (isEdge(stored.edge)) raw.edge = stored.edge;
	if (typeof stored.pos === "number" && stored.pos >= 0 && stored.pos <= 1)
		raw.pos = stored.pos;
	if (stored.expandMode === "hover" || stored.expandMode === "click") {
		raw.expandMode = stored.expandMode;
	}
	return raw;
}

interface MusicPeakApi {
	getPeak?: () => number;
	getState?: () => {
		isPlaying: boolean;
		track: { name?: string; artist?: string; pic?: string } | null;
	};
	togglePlay?: () => void;
	playPrev?: () => void;
	playNext?: () => void;
}

function musicApi(): MusicPeakApi | undefined {
	return (window as Window & { __fireflyMusic?: MusicPeakApi }).__fireflyMusic;
}

export class DynamicIsland {
	private readonly root: HTMLElement;
	private readonly glass: HTMLElement;
	private readonly vector: SVGSVGElement;
	private readonly shadowPath: SVGPathElement;
	private readonly tintPath: SVGPathElement;
	private readonly rimPath: SVGPathElement;
	private readonly outlinePath: SVGPathElement;
	private readonly flowPath: SVGPathElement;
	private readonly flowGrad: SVGRadialGradientElement;
	private readonly rimGrad: SVGLinearGradientElement;
	private readonly content: HTMLElement;
	private readonly nav: HTMLElement;
	private readonly pill: HTMLElement;
	private readonly menu: HTMLElement | null;
	private readonly menuItems: HTMLElement[];
	private readonly menuPanel: HTMLElement | null;
	private readonly menuIconLayer: HTMLElement | null;
	private readonly menuIconCurrent: HTMLElement | null;
	private readonly menuIconNext: HTMLElement | null;
	private readonly tabs: HTMLElement[];
	private readonly pageIcons: HTMLElement[];
	private readonly pageLabel: HTMLElement | null;
	private readonly clock: HTMLElement | null;
	private readonly dateLabel: HTMLElement | null;
	private readonly weekdayLabel: HTMLElement | null;
	private readonly timeLabel: HTMLElement | null;
	private readonly lyric: HTMLElement | null;
	/** 歌名内层：外层只负责裁切，超宽时整体左滑，内层必须单独持有文本 */
	private readonly lyricInner: HTMLElement | null;
	private readonly cover: HTMLImageElement | null;
	private readonly compact: HTMLElement;
	private readonly expanded: HTMLElement;
	/** 音乐面：量自然宽度时临时放开列宽 */
	private readonly musicFace: HTMLElement | null;
	private readonly playButton: HTMLButtonElement | null;
	private readonly trackLabel: HTMLElement | null;
	private readonly bars: HTMLElement[];
	private readonly petFace: PetFace;
	private readonly petFaceEl: SVGGElement;
	private readonly petEyeL: SVGRectElement;
	private readonly petEyeR: SVGRectElement;
	private readonly petGlowL: SVGEllipseElement;
	private readonly petGlowR: SVGEllipseElement;
	private readonly petHeart: SVGPathElement;
	private readonly petSparkles: SVGPathElement[];
	private readonly petBlushL: SVGEllipseElement;
	private readonly petBlushR: SVGEllipseElement;
	private readonly petMouth: SVGPathElement;
	private readonly heatmap: HTMLElement | null;
	private readonly heatRoot: HTMLElement | null;
	private readonly heatBack: HTMLButtonElement | null;
	private readonly weekPosts: HTMLElement | null;
	private readonly postsTitle: HTMLElement | null;
	private readonly postList: HTMLElement | null;
	private readonly tooltip: HTMLElement | null;
	private readonly sites: HTMLElement | null;
	private readonly sitesBar: HTMLElement | null;
	private readonly sitesStack: HTMLElement | null;
	private readonly sitesList: HTMLElement | null;
	private readonly sitesToggle: HTMLButtonElement | null;
	private readonly config: IslandConfig;
	private readonly stored: StoredState;

	private readonly sw: Spring;
	private readonly sh: Spring;
	private readonly fx: Spring;
	private readonly fy: Spring;
	private readonly along: Spring;
	private readonly gap: Spring;
	private readonly neckS: Spring;
	private readonly contentA: Spring;
	private readonly compactA: Spring;
	private readonly poke: Spring;
	private readonly drips: Drip[] = [];
	/** 展开态尺寸弹簧的「地板」状态（wisland _floor_t / _floor_on）：越过目标后不再回落 */
	private floorTarget: Partial<Record<"w" | "h", number>> = {};
	private floorOn: Partial<Record<"w" | "h", boolean>> = {};

	private edge: Edge;
	private mode: "anchored" | "drag" | "snap" = "anchored";
	private expandedState = false;
	private currentTab: string;
	private pointer: Point = { x: -999, y: -999 };
	private press: Point | null = null;
	/** 最近一帧实际绘制出的本体矩形；命中和按压形变必须用它而非弹簧中心。 */
	private renderedBody: Rect = { x: 0, y: 0, w: 0, h: 0 };
	private dragOffsetPoint: Point = { x: 0, y: 0 };
	private pokePoint: Point = { x: 0, y: 0 };
	private pokeSmooth: Point = { x: 0, y: 0 };
	private neckEdge: Edge | null;
	private hoverSince: number | null = null;
	private outSince: number | null = null;
	private lastTapAt = 0;
	private tapTimer: number | null = null;
	private raf = 0;
	private last = 0;
	private startedAt = 0;
	/** 最近一次贴边完成的时刻（秒），圆角呼吸从这一帧起算，避免落位瞬间相位跳一下 */
	private dockedAt = 0;
	private heatLoaded = false;
	/** 展开尺寸缓存：量内容高会强制回流，不能每帧都算 */
	private sizeCache: { key: string; size: [number, number] } | null = null;
	/** 收起态与设置页的时钟 */
	private clockTimer: number | null = null;
	/** 文章页 + 播放时，页面面与音乐面每 5s 翻转一次的计时器 */
	private faceTimer: number | null = null;
	private postsByCell = new Map<
		string,
		Array<{ id: string; title: string; published: number }>
	>();
	private selectedCellKey: string | null = null;
	private sitesOpen = false;
	private tooltipFrames: number[] = [];
	private peakSmoothed = 0;
	private barValues: number[] = [0.3, 0.3, 0.3, 0.3];
	/** 音乐面的自然内容宽度（切歌 / 封面切换时量一次，compactSize 只读缓存） */
	private mediaNatural = 0;
	/** 左下角悬浮音乐盒子显示开关（缺省开启，存于岛自己的 localStorage） */
	private musicBox = true;
	/** 目录子列表当前展开的分组在 navGroups 中的下标；-1 = 未展开（显示功能面板） */
	private menuGroupIndex = -1;
	/** 目录菜单当前悬停（高亮跟随）的菜单项下标 */
	private menuHoverIndex = -1;
	/** 当前页面对应的导航链接（目录菜单选中项的判定依据） */
	private currentMatchHref: string | null = null;
	/** 目录菜单选中项（当前页面所在的一级项）下标；-1 = 未匹配 */
	private menuSelectedIndex = -1;
	/** 选中项图标的滑动切换动画（WAAPI）与代数守卫 */
	private menuIconAnimations: Animation[] = [];
	private menuIconRevision = 0;
	private abort: AbortController;
	private resizeObserver: ResizeObserver | null = null;
	private musicUnsub: Array<() => void> = [];
	private readonly reduceMotion: boolean;
	private readonly desktopQuery: MediaQueryList;

	constructor(root: HTMLElement) {
		this.root = root;
		this.config = parseConfig(root);
		this.stored = readStored();
		this.reduceMotion = window.matchMedia(
			"(prefers-reduced-motion: reduce)",
		).matches;
		this.desktopQuery = window.matchMedia("(min-width: 1024px)");

		this.glass = must(root, "[data-di-glass]");
		this.vector = must(root, "[data-di-vector]") as unknown as SVGSVGElement;
		this.shadowPath = must(
			root,
			"[data-di-shadow]",
		) as unknown as SVGPathElement;
		this.tintPath = must(root, "[data-di-tint]") as unknown as SVGPathElement;
		this.rimPath = must(root, "[data-di-rim]") as unknown as SVGPathElement;
		this.outlinePath = must(
			root,
			"[data-di-outline]",
		) as unknown as SVGPathElement;
		this.flowPath = must(root, "[data-di-flow]") as unknown as SVGPathElement;
		this.flowGrad = must(
			root,
			"[data-di-flow-grad]",
		) as unknown as SVGRadialGradientElement;
		this.rimGrad = must(
			root,
			"[data-di-rim-grad]",
		) as unknown as SVGLinearGradientElement;
		this.content = must(root, "[data-di-content]");
		this.nav = must(root, "[data-di-nav]");
		this.pill = must(root, "[data-di-pill]");
		this.menu = root.querySelector<HTMLElement>("[data-di-menu]");
		this.menuIconLayer = root.querySelector<HTMLElement>(
			"[data-di-menu-icon-float]",
		);
		this.menuIconCurrent = root.querySelector<HTMLElement>(
			"[data-di-menu-icon-current]",
		);
		this.menuIconNext = root.querySelector<HTMLElement>(
			"[data-di-menu-icon-next]",
		);
		this.menuItems = Array.from(
			root.querySelectorAll<HTMLElement>("[data-di-menu-item]"),
		);
		this.menuPanel = root.querySelector<HTMLElement>("[data-di-menu-panel]");
		this.compact = must(root, "[data-di-compact]");
		this.expanded = must(root, "[data-di-expanded]");
		this.musicFace = root.querySelector<HTMLElement>(
			".di-compact__face--music",
		);
		this.playButton = root.querySelector<HTMLButtonElement>("[data-di-play]");
		this.trackLabel = root.querySelector<HTMLElement>("[data-di-track]");
		this.bars = Array.from(root.querySelectorAll<HTMLElement>("[data-di-bar]"));
		this.petFace = new PetFace(performance.now() / 1000);
		this.petFaceEl = must(root, "[data-di-pet-face]") as unknown as SVGGElement;
		this.petEyeL = must(
			root,
			"[data-di-pet-eye-l]",
		) as unknown as SVGRectElement;
		this.petEyeR = must(
			root,
			"[data-di-pet-eye-r]",
		) as unknown as SVGRectElement;
		this.petGlowL = must(
			root,
			"[data-di-pet-glow-l]",
		) as unknown as SVGEllipseElement;
		this.petGlowR = must(
			root,
			"[data-di-pet-glow-r]",
		) as unknown as SVGEllipseElement;
		this.petHeart = must(
			root,
			"[data-di-pet-heart]",
		) as unknown as SVGPathElement;
		this.petSparkles = Array.from(
			root.querySelectorAll<SVGPathElement>("[data-di-pet-sparkle]"),
		);
		this.petBlushL = must(
			root,
			"[data-di-pet-blush-l]",
		) as unknown as SVGEllipseElement;
		this.petBlushR = must(
			root,
			"[data-di-pet-blush-r]",
		) as unknown as SVGEllipseElement;
		this.petMouth = must(
			root,
			"[data-di-pet-mouth]",
		) as unknown as SVGPathElement;
		this.heatmap = root.querySelector<HTMLElement>("[data-di-heatmap]");
		this.heatRoot = root.querySelector<HTMLElement>("[data-di-heat]");
		this.heatBack = root.querySelector<HTMLButtonElement>(
			"[data-di-heat-back]",
		);
		this.weekPosts = root.querySelector<HTMLElement>("[data-di-week]");
		this.postsTitle = root.querySelector<HTMLElement>("[data-di-posts-title]");
		this.postList = root.querySelector<HTMLElement>("[data-di-post-list]");
		this.tooltip = root.querySelector<HTMLElement>("[data-di-tooltip]");
		this.sites = root.querySelector<HTMLElement>("[data-di-sites]");
		this.sitesBar = root.querySelector<HTMLElement>("[data-di-sites-bar]");
		this.sitesStack = root.querySelector<HTMLElement>("[data-di-sites-stack]");
		this.sitesList = root.querySelector<HTMLElement>("[data-di-sites-list]");
		this.sitesToggle = root.querySelector<HTMLButtonElement>(
			"[data-di-sites-toggle]",
		);
		this.tabs = Array.from(root.querySelectorAll<HTMLElement>("[data-di-tab]"));
		this.pageIcons = Array.from(
			root.querySelectorAll<HTMLElement>(
				"[data-di-page-icon], [data-di-page-icon-href]",
			),
		);
		this.pageLabel = root.querySelector<HTMLElement>("[data-di-page-label]");
		this.clock = root.querySelector<HTMLElement>("[data-di-clock]");
		this.dateLabel = root.querySelector<HTMLElement>("[data-di-date]");
		this.weekdayLabel = root.querySelector<HTMLElement>("[data-di-weekday]");
		this.timeLabel = root.querySelector<HTMLElement>("[data-di-time]");
		this.lyric = root.querySelector<HTMLElement>("[data-di-lyric]");
		this.lyricInner = root.querySelector<HTMLElement>("[data-di-lyric-inner]");
		this.cover = root.querySelector<HTMLImageElement>("[data-di-cover]");

		const tabIndex = Math.max(
			0,
			this.config.tabs.findIndex((tab) => tab.key === this.config.initialTab),
		);
		this.currentTab =
			this.config.tabs[tabIndex]?.key ?? this.config.tabs[0]?.key ?? "home";
		this.edge = this.config.edge;
		this.neckEdge = this.edge;

		const [compactW] = this.compactSize();
		this.sw = new Spring(compactW, 300, 0.62, 0.2);
		this.sh = new Spring(COLLAPSED_H, 300, 0.62, 0.2);
		this.fx = new Spring(0, 900, 0.78, 0.2);
		this.fy = new Spring(0, 900, 0.78, 0.2);
		this.along = new Spring(0, 260, 0.72, 0.2);
		this.gap = new Spring(0, 320, 0.4, 0.2);
		this.neckS = new Spring(1, 520, 1, 0.01);
		this.contentA = new Spring(0, 700, 1, 0.01);
		this.compactA = new Spring(1, 700, 1, 0.01);
		this.poke = new Spring(0, 380, 0.55, 0.004);
		this.abort = new AbortController();
	}

	/** 供 definePersistentIsland 使用；返回清理函数。 */
	setup = (): (() => void) => {
		this.startedAt = performance.now();
		this.last = this.startedAt;
		this.syncLayerSize();
		this.placeInitial();
		this.applyExpandMode(this.config.expandMode, false);
		// 初始 is-active 跟随配置的默认标签页（不再写死在 SSR 标记上）
		this.updateTabSelection();
		this.syncThemeState();
		// 音乐盒子显隐：缺省开启，仅用户在设置里关过才隐藏
		this.applyMusicBox(this.stored.musicBox !== false);
		this.syncActionState();
		this.bindEvents();
		this.bindMusic();
		this.syncPageInfo();
		this.startClock();
		// 常驻岛跨页复用：换页后重新读当前页面的标题与图标。
		// 从目录卡片跳走后要回到功能面板，否则新页面上还挂着上一页的分组列表
		onNavigation(
			() => {
				if (this.menuGroupIndex >= 0) this.closeMenuDropdown();
				this.syncPageInfo();
			},
			{ signal: this.abort.signal },
		);
		this.kick();
		return () => this.destroy();
	};

	// ---------------------------------------------------------------- 事件
	private bindEvents(): void {
		const { signal } = this.abort;
		window.addEventListener("pointermove", this.onPointerMove, {
			passive: true,
			signal,
		});
		// 鼠标移出浏览器窗口时不会有 pointermove：手动把指针挪到视口外，触发回缩
		document.documentElement.addEventListener(
			"pointerleave",
			() => {
				this.pointer = { x: -9999, y: -9999 };
				this.kick();
			},
			{ passive: true, signal },
		);
		window.addEventListener("pointerdown", this.onPointerDown, { signal });
		window.addEventListener("pointerup", this.onPointerUp, { signal });
		window.addEventListener("pointercancel", this.onPointerUp, { signal });
		window.addEventListener("resize", this.onResize, { passive: true, signal });
		window.addEventListener("keydown", this.onKeyDown, { signal });
		window.addEventListener("theme-change", this.onThemeChange, { signal });
		this.desktopQuery.addEventListener("change", this.onDesktopChange, {
			signal,
		});

		// 目录菜单与右侧功能按钮都委托到根节点命中（按钮组在 .di-nav 外面）
		this.root.addEventListener("click", this.onNavClick, { signal });
		this.playButton?.addEventListener("click", this.onPlayClick, { signal });
		this.root.addEventListener("click", this.onActionClick, { signal });

		// 公告折叠卡：头部点击展开 / 收起
		this.root.addEventListener("click", this.onNoticeToggle, { signal });

		// 目录模式：菜单项悬停切换子列表 + 高亮跟随。
		// 离开不回收：分组列表停在原地，只有点右侧功能按钮 / 再悬停别的分组 / 翻页才换，
		// 否则每次移开都会掉回默认面板，用户刚点开的分组等于没打开
		this.menu?.addEventListener("pointerover", this.onMenuPointerOver, {
			signal,
		});

		// 热力图：点格整块上滚换成该周文章，返回按钮滚回热力图
		this.heatmap?.addEventListener(
			"click",
			(event) => {
				const cell = (event.target as HTMLElement).closest<HTMLElement>(
					"[data-di-heat-cell]",
				);
				const key = cell?.dataset.diHeatCell;
				if (!key) return;
				const same = key === this.selectedCellKey;
				this.collapseWeek();
				if (!same) this.selectCell(key);
			},
			{ signal },
		);
		this.heatBack?.addEventListener("click", () => this.collapseWeek(), {
			signal,
		});
		// 提示浮层：热力图格子与社交图标共用 data-di-tooltip-label
		this.root.addEventListener(
			"mouseover",
			(event) => {
				const source = (event.target as HTMLElement).closest<HTMLElement>(
					"[data-di-tooltip-label]",
				);
				if (source) this.showTooltip(source);
			},
			{ signal },
		);
		this.root.addEventListener(
			"mouseout",
			(event) => {
				if (
					(event.relatedTarget as HTMLElement | null)?.closest?.(
						"[data-di-tooltip-label]",
					)
				)
					return;
				this.hideTooltip();
			},
			{ signal },
		);
		// 站点胶囊开合
		this.sitesToggle?.addEventListener(
			"click",
			() => this.setSitesOpen(!this.sitesOpen),
			{ signal },
		);
		// 图标加载失败回落首字符
		this.root.addEventListener(
			"error",
			(event) => {
				const img = event.target as HTMLElement;
				if (img.dataset.profileSiteIcon !== undefined)
					img.dataset.avatarFailed = "true";
			},
			true,
		);

		if (typeof ResizeObserver !== "undefined") {
			this.resizeObserver = new ResizeObserver(() => this.kick());
			this.resizeObserver.observe(this.content);
		}
	}

	private onPointerMove = (event: PointerEvent): void => {
		this.pointer.x = event.clientX;
		this.pointer.y = event.clientY;
		if (this.mode === "drag") {
			this.fx.to(this.pointer.x + this.dragOffsetPoint.x);
			this.fy.to(this.pointer.y + this.dragOffsetPoint.y);
			this.kick();
			return;
		}
		if (
			this.press &&
			Math.abs(event.clientX - this.press.x) +
				Math.abs(event.clientY - this.press.y) >
				DRAG_THRESHOLD
		) {
			this.beginDrag();
			return;
		}
		if (
			!this.expandedState &&
			this.mode === "anchored" &&
			this.inBody(this.pointer)
		) {
			const depth = this.pokeDepth(this.pointer);
			this.pokePoint = { x: event.clientX, y: event.clientY };
			if (Math.abs(this.poke.target - depth) > 0.01) {
				this.poke.to(depth, 260, 0.75);
				this.kick();
			}
		} else if (this.poke.target !== 0) {
			this.poke.to(0, 300, 0.22);
			this.kick();
		}
		this.updatePlayHover();
		// 展开态静止时帧循环会停：鼠标每次移动都要唤醒一帧，
		// 否则「移出即收起」的判定根本不会被推进。
		this.kick();
	};

	private onPointerDown = (event: PointerEvent): void => {
		if (event.button !== 0) return;
		if (
			!(event.target instanceof Node) ||
			!this.content.contains(event.target)
		) {
			this.press = null;
			// 点在灵动岛外部：展开态立即收起（两种模式共用；拖拽中不干预）
			if (this.expandedState && this.mode === "anchored") this.collapse();
			return;
		}
		const target = event.target as Element;
		if (
			target.closest("a, button, input, textarea, select, [data-di-no-drag]")
		) {
			this.press = null;
			return;
		}
		if (this.inBody({ x: event.clientX, y: event.clientY })) {
			// 只在本体可拖拽区阻止浏览器的默认文本选择 / 拖选，
			// 页面其它地方的文本仍可正常选中。pointerdown 非 passive，可 preventDefault。
			event.preventDefault();
			this.press = { x: event.clientX, y: event.clientY };
		}
	};

	private onPointerUp = (): void => {
		const hadPress = this.press !== null;
		this.press = null;
		if (this.mode === "drag") {
			this.endDrag();
			return;
		}
		// 收起态胶囊单击：展开（不锁定，移出仍会收起）；双击：切换悬停 / 点击展开
		if (
			hadPress &&
			!this.expandedState &&
			this.mode === "anchored" &&
			this.inBody(this.pointer)
		) {
			const now = performance.now();
			if (now - this.lastTapAt < 320) {
				if (this.tapTimer !== null) window.clearTimeout(this.tapTimer);
				this.tapTimer = null;
				this.lastTapAt = 0;
				this.setExpandMode(
					this.config.expandMode === "hover" ? "click" : "hover",
				);
			} else {
				this.lastTapAt = now;
				this.tapTimer = window.setTimeout(() => {
					this.tapTimer = null;
					if (!this.expandedState) this.expand();
				}, 260);
			}
		}
	};

	private onResize = (): void => {
		// 视口变化：展开宽高按新视口重算（尺寸只由视口决定，重新 kick 即可）
		if (this.expandedState) {
			const [w, h] = this.targetSize();
			this.sw.to(w, 380, 0.6);
			this.sh.to(h, 380, 0.6);
			this.syncSitesHeight();
		}
		// 玻璃 clip-path 与内容层坐标必须按同一代视口原子化写入：kick 只保证下一帧渲染，
		// 滚动条出现 / 消失等视口变化会在两层之间留下短暂的错位窗口（收起态肉眼可见），
		// 这里立即同步渲染一次，两层同帧对齐新视口
		this.render();
		this.kick();
	};

	private onKeyDown = (event: KeyboardEvent): void => {
		if (event.key !== "Escape" || !this.expandedState) return;
		this.collapse();
	};

	private onThemeChange = (): void => {
		this.syncThemeState();
		this.kick();
	};

	/** 主题分段滑块的位置由根节点 data-di-theme 驱动，主题变化时同步一次 */
	private syncThemeState(): void {
		this.root.dataset.diTheme = getStoredTheme();
	}

	private onDesktopChange = (): void => {
		this.kick();
	};

	/** 目录菜单悬停菜单项：高亮跟随滑动；带二级的项在下方展开对应列表 */
	private onMenuPointerOver = (event: PointerEvent): void => {
		const item = (event.target as HTMLElement)?.closest<HTMLElement>(
			"[data-di-menu-item]",
		);
		if (!item) return;
		const index = Number(item.dataset.diMenuItem);
		if (index !== this.menuHoverIndex) {
			this.menuHoverIndex = index;
			this.kick();
		}
		const groupIndex = this.config.navMenu[index]?.groupIndex ?? -1;
		if (groupIndex >= 0 && groupIndex !== this.menuGroupIndex) {
			this.renderMenuGroup(groupIndex);
		}
		// 每次悬停都按当前内容重定窗口尺寸（分组未变时也校准，防漏更导致的高度残留）
		const [w, h] = this.targetSize();
		this.sw.to(w, 440, 0.6);
		this.sh.to(h, 440, 0.6);
		// 带二级的项箭头翻转（is-open），一级直跳项不带箭头；
		// 分组列表不再随移出收起，所以「已展开的那一项」也要保持箭头朝上
		this.menuItems.forEach((el, i) => {
			const group = this.config.navMenu[i]?.groupIndex ?? -1;
			el.classList.toggle(
				"is-open",
				group >= 0 && (i === index || group === this.menuGroupIndex),
			);
		});
		this.kick();
	};

	/** 收起目录子列表，回到当前功能面板（只在点右侧功能按钮 / 翻页时调用） */
	private closeMenuDropdown(): void {
		this.menuGroupIndex = -1;
		this.menuHoverIndex = -1;
		this.root.removeAttribute("data-di-menu-open");
		// 箭头回到朝下：分组已经收起，别留一个「展开中」的箭头
		for (const el of this.menuItems) el.classList.remove("is-open");
		// 选中项（当前页面）的图标常驻：重新就位到它的槽位上
		if (this.menuSelectedIndex >= 0) {
			this.syncMenuIcon(null, this.menuItems[this.menuSelectedIndex]);
		} else {
			this.hideMenuIcon();
		}
		const [w, h] = this.targetSize();
		this.sw.to(w, 440, 0.6);
		this.sh.to(h, 440, 0.6);
		this.kick();
	}

	/** 渲染目录子列表：点亮对应分组，其余隐藏 */
	private renderMenuGroup(groupIndex: number): void {
		if (!this.menuPanel) return;
		this.menuGroupIndex = groupIndex;
		this.menuPanel
			.querySelectorAll<HTMLElement>("[data-di-menu-group]")
			.forEach((el) => {
				el.classList.toggle(
					"is-active",
					el.dataset.diMenuGroup === String(groupIndex),
				);
			});
		if (groupIndex >= 0) this.root.dataset.diMenuOpen = "true";
		else this.root.removeAttribute("data-di-menu-open");
	}

	// ---------------------------------------------------------------- 目录图标滑动
	/** 选中项的图标层快照（位置 + 当前图标内容），供滑动切换动画取起点 */
	private captureMenuIconSnapshot(): { rect: DOMRect | null; markup: string } {
		const layer = this.menuIconLayer;
		const current = this.menuIconCurrent;
		const next = this.menuIconNext;
		if (!layer || !current || !next) return { rect: null, markup: "" };
		const currentOpacity =
			Number.parseFloat(getComputedStyle(current).opacity) || 0;
		const nextOpacity = Number.parseFloat(getComputedStyle(next).opacity) || 0;
		const markup =
			next.innerHTML && nextOpacity > currentOpacity
				? next.innerHTML
				: current.innerHTML;
		const layerOpacity =
			Number.parseFloat(getComputedStyle(layer).opacity) || 0;
		return {
			rect:
				markup && layerOpacity > 0.01 ? layer.getBoundingClientRect() : null,
			markup,
		};
	}

	/**
	 * 计算目标项图标槽的终点位置：槽宽从 0 过渡到 16px，悬停瞬间量模板宽度还是 0，
	 * 所以按项盒 + 内边距推算终点（DOMRect），滑动动画直接以它为终点。
	 */
	private placeMenuIconBox(target: HTMLElement | null): DOMRect | null {
		const layer = this.menuIconLayer;
		if (!this.menu || !layer || !target) return null;
		const listRect = this.menu.getBoundingClientRect();
		const itemRect = target.getBoundingClientRect();
		if (itemRect.width === 0) return null;
		const padLeft =
			Number.parseFloat(getComputedStyle(target).paddingLeft) || 0;
		const slotLeft = itemRect.left + padLeft;
		const slotTop = itemRect.top + itemRect.height / 2 - 8.5;
		layer.style.left = `${String(slotLeft - listRect.left)}px`;
		layer.style.top = `${String(slotTop - listRect.top)}px`;
		layer.style.width = "16px";
		layer.style.height = "17px";
		return new DOMRect(slotLeft, slotTop, 16, 17);
	}

	private hideMenuIcon(): void {
		this.cancelMenuIconAnimations();
		const layer = this.menuIconLayer;
		const current = this.menuIconCurrent;
		const next = this.menuIconNext;
		if (!layer || !current || !next) return;
		layer.style.opacity = "0";
		layer.style.transform = "none";
		current.style.opacity = "1";
		next.style.opacity = "0";
		current.innerHTML = "";
		next.innerHTML = "";
	}

	private cancelMenuIconAnimations(): number {
		this.menuIconRevision += 1;
		this.menuIconAnimations.forEach((animation) => {
			animation.cancel();
		});
		this.menuIconAnimations = [];
		return this.menuIconRevision;
	}

	/**
	 * 选中项切换：图标层从上一项的位置滑到新项的图标槽，旧图标淡出、新图标淡入
	 * （旧导航栏 syncNavbarIcon 的等价实现）。
	 */
	private syncMenuIcon(
		previousItem: HTMLElement | null,
		nextItem: HTMLElement | null,
	): void {
		const layer = this.menuIconLayer;
		const current = this.menuIconCurrent;
		const next = this.menuIconNext;
		if (!this.menu || !layer || !current || !next) return;
		const template = nextItem?.querySelector<HTMLElement>(".di-nav__menu-icon");
		const targetMarkup = template?.innerHTML.trim() ?? "";
		const canAnimate =
			!this.reduceMotion && typeof layer.animate === "function";

		// 同一项：直接就位，不做动画
		if (previousItem === nextItem && nextItem) {
			const rect = this.placeMenuIconBox(nextItem);
			if (!rect || !targetMarkup) {
				this.hideMenuIcon();
				return;
			}
			this.cancelMenuIconAnimations();
			layer.style.opacity = "1";
			layer.style.transform = "none";
			current.innerHTML = targetMarkup;
			current.style.opacity = "1";
			next.innerHTML = "";
			next.style.opacity = "0";
			return;
		}

		const snapshot = this.captureMenuIconSnapshot();
		const targetRect = this.placeMenuIconBox(nextItem);
		if (!targetRect || !targetMarkup) {
			// 目标没有图标：旧图标原地淡出
			if (canAnimate && snapshot.rect && snapshot.markup) {
				const revision = this.cancelMenuIconAnimations();
				const listRect = this.menu.getBoundingClientRect();
				layer.style.left = `${String(snapshot.rect.left - listRect.left)}px`;
				layer.style.top = `${String(snapshot.rect.top - listRect.top)}px`;
				layer.style.width = `${String(snapshot.rect.width)}px`;
				layer.style.height = `${String(snapshot.rect.height)}px`;
				layer.style.opacity = "1";
				current.innerHTML = snapshot.markup;
				current.style.opacity = "1";
				const fadeOut = layer.animate([{ opacity: 1 }, { opacity: 0 }], {
					duration: 180,
					easing: "ease-out",
					fill: "both",
				});
				this.menuIconAnimations = [fadeOut];
				void Promise.all([fadeOut.finished.catch(() => undefined)]).then(() => {
					if (revision !== this.menuIconRevision) return;
					layer.style.opacity = "0";
					current.innerHTML = "";
				});
			} else {
				this.hideMenuIcon();
			}
			return;
		}

		if (!canAnimate || !snapshot.rect || !snapshot.markup) {
			// 没有旧图标可滑动（首次选中 / 无 rAF 环境）：目标图标直接就位。
			// 先取消上一轮动画，释放 fill:both 钉住的透明度终态，
			// 否则旧动画的填充值会盖住这里的内联样式，图标永远不显示
			this.cancelMenuIconAnimations();
			layer.style.opacity = "1";
			layer.style.transform = "none";
			current.innerHTML = targetMarkup;
			current.style.opacity = "1";
			next.innerHTML = "";
			next.style.opacity = "0";
			return;
		}

		this.cancelMenuIconAnimations();
		layer.style.opacity = "1";
		current.innerHTML = snapshot.markup;
		current.style.opacity = "1";
		next.innerHTML = targetMarkup;
		next.style.opacity = "0";

		// 从旧位置滑到新位置，两个图标交叉淡换
		const deltaX = snapshot.rect.left - targetRect.left;
		const deltaY = snapshot.rect.top - targetRect.top;
		const movement = layer.animate(
			[
				{
					transform: `translate3d(${String(deltaX)}px, ${String(deltaY)}px, 0)`,
				},
				{ transform: "translate3d(0, 0, 0)" },
			],
			{
				duration: 260,
				easing: "cubic-bezier(0.22, 1, 0.36, 1)",
				fill: "both",
			},
		);
		const outgoing = current.animate([{ opacity: 1 }, { opacity: 0 }], {
			duration: 260,
			easing: "ease-in-out",
			fill: "both",
		});
		const incoming = next.animate([{ opacity: 0 }, { opacity: 1 }], {
			duration: 260,
			easing: "ease-in-out",
			fill: "both",
		});
		this.menuIconAnimations = [movement, outgoing, incoming];
		const revision = this.menuIconRevision;
		void Promise.all(
			this.menuIconAnimations.map((animation) =>
				animation.finished.catch(() => undefined),
			),
		).then(() => {
			if (revision !== this.menuIconRevision) return;
			// 动画结束后取消它们：fill:both 的终态会一直压住内联样式，
			// 不取消的话 current 永远停在淡出帧（透明度 0），图标消失
			this.cancelMenuIconAnimations();
			layer.style.transform = "none";
			current.innerHTML = targetMarkup;
			current.style.opacity = "1";
			next.innerHTML = "";
			next.style.opacity = "0";
		});
	}

	// ---------------------------------------------------------------- 公告折叠卡
	/** 公告卡头部点击：展开 / 收起列表 */
	private onNoticeToggle = (event: MouseEvent): void => {
		const head = (event.target as HTMLElement)?.closest<HTMLElement>(
			"[data-di-notice-toggle]",
		);
		if (!head) return;
		const card = head.closest<HTMLElement>(".di-notice-card");
		if (!card) return;
		const isOpen = !card.hasAttribute("data-open");
		card.toggleAttribute("data-open", isOpen);
		head.setAttribute("aria-expanded", String(isOpen));
	};

	private onNavClick = (event: MouseEvent): void => {
		const tab = (event.target as Element)?.closest<HTMLElement>(
			"[data-di-tab]",
		);
		if (!tab) return;
		event.preventDefault();
		const key = tab.dataset.diTab;
		if (key) this.selectTab(key);
		// 对齐 wisland：点标签只切页，不 pin；移出鼠标应正常收起
	};

	private onPlayClick = (event: MouseEvent): void => {
		event.stopPropagation();
		musicApi()?.togglePlay?.();
	};

	private onActionClick = (event: MouseEvent): void => {
		const action = (event.target as Element)?.closest<HTMLElement>(
			"[data-di-action]",
		)?.dataset.diAction;
		if (!action) return;
		event.stopPropagation();
		switch (action) {
			case "mode-hover":
				this.applyExpandMode("hover", true);
				break;
			case "mode-click":
				this.applyExpandMode("click", true);
				break;
			case "reset-edge": {
				this.config.pos = 0.5;
				this.edge = "top";
				this.neckEdge = "top";
				this.stored.edge = "top";
				this.stored.pos = 0.5;
				writeStored(this.stored);
				// 顶部与侧边的展开尺寸不同（侧边是竖版），复位后要按新方向重算
				const [w, h] = this.targetSize();
				this.along.to(this.anchorAlong(w, h), 300, 0.7);
				if (this.expandedState) {
					this.sw.to(w, 420, 0.6);
					this.sh.to(h, 420, 0.6);
					this.syncSitesHeight();
				}
				this.gap.to(0, 300, 0.4);
				this.kick();
				break;
			}
			case "search":
				// 搜索弹窗虽在最上层，但岛保持展开会挡住下方内容：先收起再唤起搜索
				this.collapse();
				window.dispatchEvent(new CustomEvent("firefly:search-modal-toggle"));
				break;
			case "music-toggle":
				musicApi()?.togglePlay?.();
				break;
			case "music-box-on":
			case "music-box-off": {
				const on = action === "music-box-on";
				if (this.musicBox === on) break;
				this.applyMusicBox(on);
				this.stored.musicBox = on;
				writeStored(this.stored);
				break;
			}
			case "music-prev":
				musicApi()?.playPrev?.();
				break;
			case "music-next":
				musicApi()?.playNext?.();
				break;
			case "theme-light":
				this.applyTheme("light");
				break;
			case "theme-dark":
				this.applyTheme("dark");
				break;
			case "theme-system":
				this.applyTheme("system");
				break;
			default:
				break;
		}
		this.syncActionState();
	};

	private applyTheme(value: "light" | "dark" | "system"): void {
		setTheme(value);
		this.syncThemeState();
	}

	private syncActionState(): void {
		this.root
			.querySelectorAll<HTMLElement>("[data-di-action]")
			.forEach((button) => {
				const action = button.dataset.diAction;
				if (action === `mode-${this.config.expandMode}`)
					button.classList.add("is-active");
				else if (action?.startsWith("mode-"))
					button.classList.remove("is-active");
				if (action === (this.musicBox ? "music-box-on" : "music-box-off"))
					button.classList.add("is-active");
				else if (action?.startsWith("music-box-"))
					button.classList.remove("is-active");
			});
	}

	/** 应用音乐盒子显隐：根类控制全局 CSS 隐藏，data 属性驱动分段滑块位置 */
	private applyMusicBox(on: boolean): void {
		this.musicBox = on;
		document.documentElement.classList.toggle("music-box-off", !on);
		this.root.dataset.diMusicBox = String(on);
	}

	// ---------------------------------------------------------------- 音乐
	private bindMusic(): void {
		const on = (name: string, handler: () => void): void => {
			window.addEventListener(name, handler, { signal: this.abort.signal });
			this.musicUnsub.push(() => window.removeEventListener(name, handler));
		};
		on("fm:track", () => this.syncTrack());
		on("fm:play-state", () => this.syncTrack());
		on("fm:init", () => this.syncTrack());
		this.syncTrack();
	}

	private syncTrack(): void {
		const state = musicApi()?.getState?.();
		const track = state?.track;
		const isPlaying = Boolean(state?.isPlaying && track);
		this.root.dataset.diPlaying = isPlaying ? "true" : "false";
		if (this.trackLabel) {
			this.trackLabel.textContent =
				isPlaying && track
					? [track.name, track.artist].filter(Boolean).join(" · ")
					: this.config.labels.notPlaying;
		}
		if (this.lyricInner) {
			const name = track?.name ?? "";
			// 收起态只报歌名，歌词留在音乐面板里；文本必须写在内层，外层只负责裁切
			this.lyricInner.textContent =
				isPlaying && name
					? this.config.labels.nowPlaying.replace("{name}", name)
					: "";
		}
		// 收起态音乐面左侧：有封面用封面，没有则回退唱歌脸
		if (this.cover) {
			const pic = track?.pic ?? "";
			this.cover.classList.toggle("is-on", Boolean(pic));
			if (pic && this.cover.getAttribute("src") !== pic) this.cover.src = pic;
		}
		// 宽度跟着歌名 / 封面的实际内容走，量完再定胶囊宽度与歌名要不要滑动
		this.measureMediaWidth();
		this.syncCompactWidth();
		this.syncLyricScroll();
		this.syncFace();
		this.kick();
	}

	/**
	 * 收起态朝哪一面：未播放显示页面面；普通页播放显示音乐面；
	 * 文章页播放时两面每 5s 翻转一次（看标题还是看歌名都够用）。
	 */
	private syncFace(): void {
		const playing = this.root.dataset.diPlaying === "true";
		const isPost = this.root.dataset.diPageKind === "post";
		if (!playing) {
			this.stopFaceTimer();
			this.root.dataset.diFace = "page";
			return;
		}
		if (!isPost) {
			this.stopFaceTimer();
			this.root.dataset.diFace = "music";
			return;
		}
		if (this.faceTimer !== null) return;
		this.root.dataset.diFace = "page";
		this.faceTimer = window.setInterval(() => {
			this.root.dataset.diFace =
				this.root.dataset.diFace === "music" ? "page" : "music";
		}, 5000);
	}

	private stopFaceTimer(): void {
		if (this.faceTimer === null) return;
		window.clearInterval(this.faceTimer);
		this.faceTimer = null;
	}

	/** 收起态左侧的当前页面：非文章页是「图标 + 页面名」，文章页换成文章标题。 */
	private syncPageInfo(): void {
		const raw = window.location.pathname;
		const path = raw.length > 1 ? raw.replace(/\/+$/, "") : "/";
		const postBase = this.config.postPath.replace(/\/+$/, "");
		// /posts/ 本身是列表页，只有 /posts/{slug} 才当文章页
		const isPost = path !== postBase && path.startsWith(`${postBase}/`);
		this.root.dataset.diPageKind = isPost
			? "post"
			: path === "/"
				? "home"
				: "page";
		// 图标跟随页面：匹配到的导航项点亮自己的图标；文章正文页用「文档」入口图标；
		// 都匹配不上才回落到罗盘兜底
		let matchHref: string | null = null;
		if (isPost) {
			matchHref = postBase;
			const heading = document.querySelector<HTMLElement>(
				"article h1, main h1, h1",
			);
			const title =
				heading?.textContent?.trim() || document.title.split(" - ")[0] || "";
			if (this.pageLabel) this.pageLabel.textContent = title;
		} else {
			// 长的前缀优先，避免 /posts 之类把 /posts/archive 吃掉
			const match = [...this.config.pages]
				.sort((a, b) => b.path.length - a.path.length)
				.find((item) => {
					const itemPath = item.path.replace(/\/+$/, "") || "/";
					return path === itemPath || path.startsWith(`${itemPath}/`);
				});
			matchHref = match?.path ?? null;
			if (this.pageLabel) {
				this.pageLabel.textContent =
					match?.name ?? document.title.split(" - ")[0] ?? "";
			}
		}
		const norm = (value: string): string => value.replace(/\/+$/, "") || "/";
		const current = matchHref === null ? null : norm(matchHref);
		this.pageIcons.forEach((el) => {
			const href = el.dataset.diPageIconHref;
			// 带导航项 href 的槽按路径点亮；无 href 的罗盘槽只在完全没匹配上时点亮
			const on = href
				? current !== null && norm(href) === current
				: current === null;
			el.classList.toggle("is-on", on);
		});
		// 目录菜单的选中项跟随当前页面（图标常驻在选中项上，随导航滑动切换）
		this.currentMatchHref = matchHref;
		this.syncMenuSelection();
		this.syncCompactWidth();
		// 文章页 / 普通页的收起态宽度不同，歌名要不要滑动也跟着一起重算
		this.syncLyricScroll();
		// 播放中进入文章页也要重算朝向：diFace 可能停在上个页面留下的 music，不重算就永远不翻转
		this.syncFace();
	}

	/** 目录菜单选中项 = 当前页面对应的一级项（直跳项按 href、分组项看子项是否命中） */
	private syncMenuSelection(): void {
		const norm = (value: string): string => value.replace(/\/+$/, "") || "/";
		const target =
			this.currentMatchHref === null ? null : norm(this.currentMatchHref);
		let index = -1;
		if (target !== null) {
			index = this.config.navMenu.findIndex((item) => {
				if (item.href) return norm(item.href) === target;
				const group = this.config.navGroups[item.groupIndex ?? -1];
				return group
					? group.items.some((entry) => norm(entry.href) === target)
					: false;
			});
		}
		if (index === this.menuSelectedIndex) return;
		const previous =
			this.menuSelectedIndex >= 0
				? this.menuItems[this.menuSelectedIndex]
				: null;
		const next = index >= 0 ? this.menuItems[index] : null;
		this.menuSelectedIndex = index;
		// 选中项变化：图标从旧项滑动切换到新项
		this.syncMenuIcon(previous, next);
		this.menuItems.forEach((el, i) => {
			el.classList.toggle("is-selected", i === index);
		});
		this.kick();
	}

	/** 页面类型变了会换收起态宽度（文章页需要放下标题），收起时同步一次 */
	private syncCompactWidth(): void {
		if (this.expandedState) return;
		const [w, h] = this.compactSize();
		this.sw.to(w, 420, 0.55);
		this.sh.to(h, 420, 0.55);
		this.kick();
	}

	/**
	 * 量一次音乐面的自然宽度：临时把三列放开成 max-content、本身按内容定宽，
	 * 读一次 offsetWidth 立刻还原。切歌 / 封面切换时才跑，不在每帧里读布局。
	 */
	private measureMediaWidth(): void {
		const face = this.musicFace;
		// 暂停时歌名是空的，量了只会把宽度带偏；保留上一首的宽度即可
		if (!face || this.root.dataset.diPlaying !== "true") return;
		face.classList.add("is-measuring");
		const width = face.offsetWidth;
		face.classList.remove("is-measuring");
		// 窄屏下整层 display:none 时量到 0，保留上一次的值，别把胶囊压到最小
		if (width > 0) this.mediaNatural = width;
	}

	/** 音乐面胶囊宽度：内容宽度夹在上下限之间（上限是原来 440 的一半） */
	private mediaWidth(): number {
		const natural =
			this.mediaNatural > 0 ? this.mediaNatural : COLLAPSED_W_MEDIA_MAX;
		return Math.round(
			clamp(natural, COLLAPSED_W_MEDIA_MIN, COLLAPSED_W_MEDIA_MAX),
		);
	}

	/** 歌名放不下时让它整体左滑：位移量 = 自然宽度 - 胶囊宽度（只压缩中间那列） */
	private syncLyricScroll(): void {
		const lyric = this.lyric;
		if (!lyric) return;
		// 没在播放时歌名是空的，胶囊也回到页面宽度，别拿旧的自然宽度去算溢出
		const playing = this.root.dataset.diPlaying === "true";
		const overflow = playing ? this.mediaNatural - this.compactSize()[0] : 0;
		if (overflow > 1) {
			// 距离越长走得越慢，短标题不会一闪而过
			const duration = clamp(overflow / 26 + 5, 6, 16);
			lyric.style.setProperty("--di-lyric-shift", `-${overflow.toFixed(1)}px`);
			lyric.style.setProperty("--di-lyric-duration", `${duration.toFixed(1)}s`);
			lyric.classList.add("is-scrolling");
		} else {
			lyric.classList.remove("is-scrolling");
			lyric.style.removeProperty("--di-lyric-shift");
			lyric.style.removeProperty("--di-lyric-duration");
		}
	}

	/** 时钟：收起态与设置面板共用一份，20s 刷新一次足够跟手 */
	private startClock(): void {
		const update = (): void => {
			const now = new Date();
			const time = new Intl.DateTimeFormat(this.config.locale, {
				hour: "2-digit",
				minute: "2-digit",
				hour12: false,
			}).format(now);
			if (this.clock) this.clock.textContent = time;
			if (this.timeLabel) this.timeLabel.textContent = time;
			if (this.dateLabel) {
				this.dateLabel.textContent = new Intl.DateTimeFormat(
					this.config.locale,
					{
						month: "long",
						day: "numeric",
					},
				).format(now);
			}
			if (this.weekdayLabel) {
				this.weekdayLabel.textContent = new Intl.DateTimeFormat(
					this.config.locale,
					{
						weekday: "short",
					},
				).format(now);
			}
		};
		update();
		this.clockTimer = window.setInterval(update, 20000);
	}

	private updatePlayHover(): void {
		if (!this.playButton || this.expandedState) return;
		const rect = this.playButton.getBoundingClientRect();
		const near =
			this.pointer.x >= rect.left - 6 &&
			this.pointer.x <= rect.right + 6 &&
			this.pointer.y >= rect.top - 8 &&
			this.pointer.y <= rect.bottom + 8;
		this.playButton.classList.toggle("is-hover", near);
	}

	// ---------------------------------------------------------------- 形态
	/** 固定图层的真实尺寸缓存：render() 每帧从 root 的 rect 同步。 */
	private layerW = 0;
	private layerH = 0;

	/**
	 * 图层（fixed inset:0）的真实尺寸必须取自身 rect：html 开着 scrollbar-gutter:stable，
	 * 图谱页这类 overflow:hidden 的页面没有滚动条但槽位仍被预留，此时
	 * documentElement.clientWidth 会把槽位计入视口（实测 clientW=1280 vs 图层 1270），
	 * viewBox 按 1280 写进 1270 宽的 SVG 会被等比缩放居中，描边/高光与玻璃本体错开。
	 */
	private syncLayerSize(): void {
		const rect = this.root.getBoundingClientRect();
		this.layerW = Math.round(rect.width);
		this.layerH = Math.round(rect.height);
	}

	private viewportWidth(): number {
		return (
			this.layerW || document.documentElement.clientWidth || window.innerWidth
		);
	}

	private viewportHeight(): number {
		return (
			this.layerH || document.documentElement.clientHeight || window.innerHeight
		);
	}

	private compactSize(): [number, number] {
		const api = musicApi()?.getState?.();
		const playing = Boolean(api?.isPlaying && api.track);
		const kind = this.root.dataset.diPageKind;
		if (playing) {
			// 音乐面按内容定宽；文章页两面每 5s 翻转，宽度跟文章页那档，
			// 否则每次翻到歌名都会横着抽一下
			return [
				kind === "post" ? COLLAPSED_W_POST : this.mediaWidth(),
				COLLAPSED_H,
			];
		}
		if (kind === "home") return [COLLAPSED_W_HOME, COLLAPSED_H];
		if (kind === "post") return [COLLAPSED_W_POST, COLLAPSED_H];
		return [COLLAPSED_W_IDLE, COLLAPSED_H];
	}

	private targetSize(): [number, number] {
		if (this.expandedState) return this.expandedSize();
		return this.compactSize();
	}

	/**
	 * 展开尺寸：宽跟视口走并夹在可用区域内；高则优先按个人信息面板的内容量算。
	 * 热力图格子是方的，用固定视口比例定高会在热力图下方空出一条横带；
	 * 其它面板没有这种约束，仍沿用视口比例。
	 */
	private expandedSize(): [number, number] {
		const vw = this.viewportWidth();
		const vh = this.viewportHeight();
		// 目录模式下窗口高度随悬停的分组走，缓存键带上分组下标
		const sizeKey =
			this.menuGroupIndex >= 0
				? `menu-${String(this.menuGroupIndex)}`
				: this.currentTab;
		const cacheKey = `${this.edge}|${sizeKey}|${String(vw)}|${String(vh)}`;
		if (this.sizeCache?.key === cacheKey) return this.sizeCache.size;

		// 液态轮廓贴边需要圆角 + 间隙的余量，再留 16px 呼吸位，避免圆角顶到视口边缘
		const padX = FILLET + EDGE_MARGIN + 16;
		const padY = FILLET + EDGE_MARGIN + 16;
		const maxW = Math.max(EXPANDED_W_MIN, vw - padX * 2);
		const maxH = Math.max(EXPANDED_H_MIN, vh - padY * 2);
		const side = !isHorizontal(this.edge);
		// 侧边（竖版窄条）：目录菜单一行放不下时扩充岛宽，而不是把菜单挤到第二行
		const navRequired = side ? this.navRequiredWidth() + 24 : 0;
		const w = Math.round(
			side
				? clamp(
						Math.max(vw * EXPANDED_SIDE_W_RATIO, navRequired),
						EXPANDED_SIDE_W_MIN,
						Math.min(EXPANDED_SIDE_W_MAX, maxW),
					)
				: clamp(
						vw * EXPANDED_W_RATIO,
						EXPANDED_W_MIN,
						Math.min(EXPANDED_W_MAX, maxW),
					),
		);

		let h: number;
		// 所有面板都按内容定高：热力图格子是方的、文章卡片是自适应的，
		// 用固定视口比例定高会多出空行或把内容裁掉
		const activePanel =
			this.menuGroupIndex >= 0
				? this.menuPanel
				: this.root.querySelector<HTMLElement>(".di-panel.is-active");
		const contentH = this.panelContentHeight(w, activePanel);
		if (contentH > 0) {
			// 目录子列表不套 312px 的最小高度：常只有一行卡片，套了会留大片空白
			h =
				this.menuGroupIndex >= 0
					? Math.min(contentH + EXPANDED_CHROME_H, maxH)
					: clamp(contentH + EXPANDED_CHROME_H, EXPANDED_H_MIN, maxH);
		} else if (side) {
			h = clamp(
				vh * EXPANDED_SIDE_H_RATIO,
				EXPANDED_SIDE_H_MIN,
				Math.min(EXPANDED_SIDE_H_MAX, maxH),
			);
		} else {
			h = clamp(
				vh * EXPANDED_H_RATIO,
				EXPANDED_H_MIN,
				Math.min(EXPANDED_H_MAX, maxH),
			);
		}
		const size: [number, number] = [w, Math.round(h)];
		this.sizeCache = { key: cacheKey, size };
		return size;
	}

	/** 当前面板的自然内容高：临时让面板脱离侧边定位、高度由内容决定，量完立刻还原。 */
	private navRequiredWidth(): number {
		// 导航行（目录菜单 + 功能按钮簇 + 搜索）的自然宽度：临时解除宽度约束量完还原
		if (!this.nav) return 0;
		const prev = this.nav.style.width;
		this.nav.style.width = "max-content";
		const width = this.nav.offsetWidth;
		this.nav.style.width = prev;
		return width;
	}

	/** 当前面板的自然内容高：临时让面板脱离侧边定位、高度由内容决定，量完立刻还原。 */
	private panelContentHeight(width: number, panel: HTMLElement | null): number {
		if (!panel) return 0;
		const prevWidth = this.content.style.width;
		const prevHeight = this.content.style.height;
		const prevExpandedWidth = this.expanded.style.width;
		const prevBottom = panel.style.bottom;
		const prevPanelHeight = panel.style.height;
		// data-edge 由 render 每帧写；测量可能发生在渲染前，先同步一次，
		// 否则贴边切换的排版（竖版单列）还没生效，量到的是旧布局
		this.root.dataset.edge = this.edge;
		// 临时把内容层撑到展开宽度与满高，量出不被 flex 拉伸的真实内容高
		this.content.style.width = `${String(width)}px`;
		this.content.style.height = `${String(this.viewportHeight())}px`;
		// 展开层已是固定目标尺寸（不再随本体伸缩），测量宽度要临时同步到请求宽度
		this.expanded.style.width = `${String(width)}px`;
		panel.style.bottom = "auto";
		panel.style.height = "auto";
		const height = panel.offsetHeight;
		panel.style.bottom = prevBottom;
		panel.style.height = prevPanelHeight;
		this.content.style.width = prevWidth;
		this.content.style.height = prevHeight;
		this.expanded.style.width = prevExpandedWidth;
		return height;
	}

	private line(edge: Edge): number {
		return {
			top: 0,
			bottom: this.viewportHeight() + 1,
			left: 0,
			right: this.viewportWidth() + 1,
		}[edge];
	}

	private alongRange(edge: Edge, w: number, h: number): [number, number] {
		if (isHorizontal(edge)) {
			const half = w / 2 + FILLET + EDGE_MARGIN;
			return [half, this.viewportWidth() + 1 - half];
		}
		const half = h / 2 + FILLET + EDGE_MARGIN;
		return [half, this.viewportHeight() + 1 - half];
	}

	private anchorAlong(w: number, h: number): number {
		const loHi = this.alongRange(this.edge, w, h);
		const along = isHorizontal(this.edge)
			? loHi[0] + this.config.pos * (loHi[1] - loHi[0])
			: loHi[0] + this.config.pos * (loHi[1] - loHi[0]);
		return clamp(along, loHi[0], loHi[1]);
	}

	private centerOnEdge(
		edge: Edge,
		along: number,
		gap: number,
		w: number,
		h: number,
	): Point {
		const line = this.line(edge);
		switch (edge) {
			case "top":
				return { x: along, y: line + gap + h / 2 };
			case "bottom":
				return { x: along, y: line - gap - h / 2 };
			case "left":
				return { x: line + gap + w / 2, y: along };
			case "right":
				return { x: line - gap - w / 2, y: along };
		}
	}

	private placeInitial(): void {
		const [w, h] = this.compactSize();
		const center = this.centerOnEdge(
			this.edge,
			this.anchorAlong(w, h),
			0,
			w,
			h,
		);
		this.fx.snap(center.x);
		this.fy.snap(center.y);
		this.along.snap(centerOnAxis(center, this.edge));
		this.gap.snap(0);
	}

	private applyExpandMode(
		mode: IslandConfig["expandMode"],
		persist: boolean,
	): void {
		this.config.expandMode = mode;
		this.root.dataset.diExpandMode = mode;
		// 只在用户主动切换时写入 localStorage：setup 同步默认值不能烤进存储，
		// 否则改配置里的默认展开方式对老访客永远不生效
		if (persist) {
			this.stored.expandMode = mode;
			writeStored(this.stored);
		}
		if (this.expandedState && !this.pointerNear()) this.collapse();
	}

	expand(animate = true): void {
		if (!this.expandedState) {
			this.expandedState = true;
			// 清掉上一轮展开的「地板」状态：floorTarget 与本次目标同值时不会触发重判，
			// 残留的 floorOn=true 会把刚起跳的弹簧在第一个 tick 就钳到目标尺寸，
			// 第二次展开便瞬间满幅、看不到生长动画
			this.floorTarget = {};
			this.floorOn = {};
			const [w, h] = this.targetSize();
			this.root.dataset.diExpanded = "true";
			this.compactA.to(0, 900, 1);
			// 按压形变不 snap 清零：悬停展开触发时 poke 弹簧还在运动中（约 200ms <
			// 其稳定时长），瞬间清零会让胶囊先跳一下再生长，非常突兀；改用与移出
			// 回弹相同的欠阻尼释放，让压扁在玻璃生长的同时平滑松开
			this.poke.to(0, 300, 0.22);
			this.sw.to(w, animate ? 420 : 900, 0.62);
			this.sh.to(h, animate ? 420 : 900, 0.62);
			this.contentA.snap(0);
			this.updateTabSelection();
			this.loadHeatmap();
			this.syncSitesHeight();
			this.kick();
			// 热力图入场扫描改到 tick 的内容显现帧同步触发：格子钉在起始帧时整层
			// 还不可见，无论弹簧多快到位都不会出现「先看见格子、再消失重扫」的闪烁
		}
	}

	collapse(): void {
		if (!this.expandedState) return;
		this.expandedState = false;
		// 清掉悬停计时器：否则 needsFrames() 会一直为真，帧循环空转
		this.outSince = null;
		this.hoverSince = null;
		// 目录子列表不在这里收：收起只是把岛缩回胶囊，重新展开还要停在同一个分组
		this.root.dataset.diExpanded = "false";
		this.contentA.snap(0);
		// 对齐 wisland _tick 的 compact_a.to(1, 420, 1.0)：胶囊收拢时内容稍慢浮现更柔和
		this.compactA.to(1, 420, 1);
		this.collapseWeek();
		this.hideTooltip();
		this.resetSites();
		const [w, h] = this.compactSize();
		this.sw.to(w, 460, 0.64);
		this.sh.to(h, 460, 0.64);
		this.kick();
	}

	selectTab(key: string): void {
		if (!this.config.tabs.some((tab) => tab.key === key)) return;
		const sameTab = key === this.currentTab;
		// 已选中页重复点击：不重放入场扫描，面板完全可见时重扫必然闪一次；
		// 但目录分组开着时仍要收掉分组，回到功能面板
		if (sameTab && this.menuGroupIndex < 0) return;
		this.currentTab = key;
		this.root.dataset.diTab = key;
		// 顺序要紧：先把面板切到位、作废旧测量，再收目录分组。
		// closeMenuDropdown 里会按「当前内容」重算展开高度，反过来就会量到上一个面板，
		// 并把它按新标签的 key 缓存下来——新面板下方于是被截断，且不再自适应
		this.updateTabSelection();
		this.sizeCache = null;
		if (this.menuGroupIndex >= 0) this.closeMenuDropdown();
		if (key === "home") {
			this.loadHeatmap();
			this.syncSitesHeight();
			// 与 is-active 切换同帧同步触发：新面板还在透明度 0 时就把格子钉在起始帧。
			// 延迟触发（旧实现 120ms）会让面板先淡入、格子再消失重扫，产生闪烁抖动
			if (!sameTab) this.playHomeReveal();
		}
		// 所有面板共用同一套视口尺寸，切页只换内容，不改卡片大小
		const [w, h] = this.targetSize();
		this.sw.to(w, 440, 0.6);
		this.sh.to(h, 440, 0.6);
		this.kick();
	}

	private updateTabSelection(): void {
		this.tabs.forEach((tab) => {
			tab.classList.toggle("is-active", tab.dataset.diTab === this.currentTab);
		});
		this.root
			.querySelectorAll<HTMLElement>("[data-di-panel]")
			.forEach((panel) => {
				panel.classList.toggle(
					"is-active",
					panel.dataset.diPanel === this.currentTab,
				);
			});
	}

	// ---------------------------------------------------------------- 拖拽 / 吸附
	private beginDrag(): void {
		// 拖拽优先于单击展开：取消收起态单击排队的 260ms 展开计时器，
		// 否则按下后拖动会被随后触发的 expand 打断，体感像"要先展开才能拖"。
		if (this.tapTimer !== null) {
			window.clearTimeout(this.tapTimer);
			this.tapTimer = null;
		}
		this.lastTapAt = 0;
		const wasExpanded = this.expandedState;
		// 抓取中心（对齐原项目 begin_drag）：
		// - 收起态：用实际绘制胶囊的中心（renderedBody），fx/fy 是收起基准、与绘制中心不一致；
		// - 展开态：用鼠标位置——面板会收成胶囊，中心向鼠标靠拢，offset=0，胶囊正好在鼠标下。
		let grabCenter: Point;
		if (wasExpanded) {
			grabCenter = { x: this.pointer.x, y: this.pointer.y };
		} else {
			const held =
				this.renderedBody.w > 0
					? this.renderedBody
					: {
							x: this.fx.x - Math.max(40, this.sw.x) / 2,
							y: this.fy.x - Math.max(24, this.sh.x) / 2,
							w: Math.max(40, this.sw.x),
							h: Math.max(24, this.sh.x),
						};
			grabCenter = { x: held.x + held.w / 2, y: held.y + held.h / 2 };
		}
		this.dragOffsetPoint = {
			x: grabCenter.x - this.pointer.x,
			y: grabCenter.y - this.pointer.y,
		};
		this.press = null;
		// 拖拽期间不应用按压形变，但 poke 会停在按下时的量。不清掉的话，吸附完成的第一帧
		// 会突然套用它（本体变宽、变扁），和贴边轮廓的跳变叠在一起更像"闪一下"。
		this.poke.snap(0);
		this.expandedState = false;
		this.root.dataset.diExpanded = "false";
		this.contentA.snap(0);
		this.compactA.to(1, 500, 1);
		const [w, h] = this.compactSize();
		this.sw.to(w, 300, 0.55);
		this.sh.to(h, 300, 0.55);
		this.mode = "drag";
		// 弹簧起点对齐抓取中心，避免切入拖拽瞬间跳一下
		this.fx.snap(grabCenter.x);
		this.fy.snap(grabCenter.y);
		this.root.classList.add("is-dragging");
		this.kick();
	}

	private endDrag(): void {
		this.root.classList.remove("is-dragging");
		const center: Point = { x: this.fx.x, y: this.fy.x };
		const [w, h] = this.compactSize();
		const body: Rect = { x: center.x - w / 2, y: center.y - h / 2, w, h };
		const gaps: Record<Edge, number> = {
			top: body.y - 0,
			bottom: this.viewportHeight() + 1 - (body.y + body.h),
			left: body.x - 0,
			right: this.viewportWidth() + 1 - (body.x + body.w),
		};
		const weights: Record<Edge, number> = {
			top: 1,
			bottom: 1,
			left: 1.35,
			right: 1.35,
		};
		const edge = (Object.keys(gaps) as Edge[]).reduce((best, key) =>
			gaps[key] * weights[key] < gaps[best] * weights[best] ? key : best,
		);
		this.edge = edge;
		const horiz = isHorizontal(edge);
		const along0 = horiz ? center.x : center.y;
		const vAlong = horiz ? this.fx.v : this.fy.v;
		const vToward =
			edge === "top"
				? -this.fy.v
				: edge === "bottom"
					? this.fy.v
					: edge === "left"
						? -this.fx.v
						: this.fx.v;
		this.along.snap(along0);
		this.along.v = vAlong;
		const range = this.alongRange(edge, w, h);
		this.along.to(clamp(along0, range[0], range[1]), 240, 0.74);
		this.gap.snap(Math.max(-4, gaps[edge]));
		this.gap.v = -vToward;
		this.gap.to(0, 300, 0.38);
		this.mode = "snap";
		if (this.neckEdge && this.neckEdge !== edge) this.breakNeck();
		this.kick();
	}

	private breakNeck(): void {
		if (!this.neckEdge) return;
		const edge = this.neckEdge;
		const horiz = isHorizontal(edge);
		const center = { x: this.fx.x, y: this.fy.x };
		const spring = new Spring(7.5, 160, 0.45, 0.05);
		spring.to(0);
		this.drips.push({
			edge,
			line: this.line(edge),
			c: horiz ? center.x : center.y,
			r: spring,
		});
		this.neckEdge = null;
		this.neckS.snap(0);
	}

	private nearestEdge(body: Rect): { edge: Edge; gap: number } {
		const gaps: Record<Edge, number> = {
			top: body.y,
			bottom: this.viewportHeight() + 1 - (body.y + body.h),
			left: body.x,
			right: this.viewportWidth() + 1 - (body.x + body.w),
		};
		const edge = (Object.keys(gaps) as Edge[]).reduce((best, key) =>
			gaps[key] < gaps[best] ? key : best,
		);
		return { edge, gap: gaps[edge] };
	}

	private gapTo(edge: Edge, body: Rect): number {
		return {
			top: body.y,
			bottom: this.line(edge) - (body.y + body.h),
			left: body.x,
			right: this.line(edge) - (body.x + body.w),
		}[edge];
	}

	// ---------------------------------------------------------------- 命中
	private currentBody(): Rect {
		// 展开/贴边时真实本体由 centerOnEdge 重定位，fx/fy 仍是收起态中心，
		// 必须用 render() 写回的实际矩形，否则展开面板下半部分会被判为"岛外"而误收起。
		return this.renderedBody.w > 0
			? this.renderedBody
			: {
					x: this.fx.x - Math.max(40, this.sw.x) / 2,
					y: this.fy.x - Math.max(24, this.sh.x) / 2,
					w: Math.max(40, this.sw.x),
					h: Math.max(24, this.sh.x),
				};
	}

	private inBody(point: Point): boolean {
		const body = this.currentBody();
		return (
			point.x >= body.x - 4 &&
			point.x <= body.x + body.w + 4 &&
			point.y >= body.y - 4 &&
			point.y <= body.y + body.h + 4
		);
	}

	private pointerNear(): boolean {
		return this.inBody(this.pointer);
	}

	private pokeDepth(point: Point): number {
		const body = this.currentBody();
		const nx = (point.x - (body.x + body.w / 2)) / Math.max(1, body.w / 2);
		const ny = (point.y - (body.y + body.h / 2)) / Math.max(1, body.h / 2);
		return (1 - Math.min(1, Math.hypot(nx, ny))) ** 1.4;
	}

	// ---------------------------------------------------------------- 帧循环
	private kick(): void {
		if (!this.raf) {
			this.last = performance.now();
			this.raf = requestAnimationFrame(this.tick);
		}
	}

	private needsFrames(): boolean {
		if (this.mode !== "anchored" || this.drips.length > 0) return true;
		// 悬停展开 / 移出收起的倒计时必须继续推进：
		// 展开态弹簧静止后若直接停帧，鼠标停在原处就永远等不到收起。
		if (this.outSince !== null || this.hoverSince !== null) return true;
		for (const spring of [
			this.sw,
			this.sh,
			this.fx,
			this.fy,
			this.along,
			this.gap,
			this.neckS,
			this.contentA,
			this.compactA,
			this.poke,
		]) {
			if (!spring.rest) return true;
		}
		return !this.expandedState && !this.reduceMotion;
	}

	private tick = (now: number): void => {
		this.raf = 0;
		const dt = Math.min(1 / 30, Math.max(1 / 240, (now - this.last) / 1000));
		this.last = now;

		if (this.mode === "drag") {
			this.fx.to(this.pointer.x + this.dragOffsetPoint.x);
			this.fy.to(this.pointer.y + this.dragOffsetPoint.y);
		}

		if (this.expandedState) {
			const [w, h] = this.targetSize();
			// 形状长到接近目标后才显示内容：避免内容先于玻璃底出现
			if (
				this.sh.x >= h - 1 &&
				this.sw.x >= w - 1 &&
				this.contentA.target < 1
			) {
				this.contentA.snap(0);
				this.contentA.to(1, 700, 1);
				// 此刻右栏才真正撑开，站点浮层要按最终高度重算
				this.syncSitesHeight();
				// 重放面板入场过渡：is-active 在 expand() 时已加上，但整层当时还不可见，
				// 不重放的话内容随玻璃淡入时是静止的，缺少入场感
				const active = this.root.querySelector<HTMLElement>(
					".di-panel.is-active",
				);
				if (active) {
					active.classList.remove("is-active");
					void active.offsetWidth;
					active.classList.add("is-active");
				}
				// 首页面板入场（名片 + 热力图扫描）与整层淡入同帧开始：此刻整层透明度还是 0，
				// 格子被 fill:backwards 钉在起始帧不会被人眼看到，之后随面板一起入场
				this.playHomeReveal();
			}
		}

		const springs = [
			this.sw,
			this.sh,
			this.fx,
			this.fy,
			this.along,
			this.gap,
			this.neckS,
			this.contentA,
			this.compactA,
			this.poke,
		];
		for (const spring of springs) spring.step(dt);
		if (this.expandedState) {
			// wisland 的「地板」（island.py _tick）：展开态尺寸越过目标后不再回落到目标以下，
			// 保留过冲回弹、去掉下坠；没有它，面板淡入时会被弹簧回摆反复挤压
			const floors: Array<[Spring, "w" | "h"]> = [
				[this.sw, "w"],
				[this.sh, "h"],
			];
			for (const [spring, key] of floors) {
				if (this.floorTarget[key] !== spring.target) {
					this.floorTarget[key] = spring.target;
					this.floorOn[key] = spring.x >= spring.target;
				}
				if (spring.x >= spring.target) this.floorOn[key] = true;
				else if (this.floorOn[key]) {
					spring.x = spring.target;
					spring.v = 0;
				}
			}
		}
		if (Math.abs(this.poke.x) > 0.01) {
			if (this.pokeSmooth.x === 0 && this.pokeSmooth.y === 0) {
				this.pokeSmooth = { ...this.pokePoint };
			}
			this.pokeSmooth.x += (this.pokePoint.x - this.pokeSmooth.x) * 0.3;
			this.pokeSmooth.y += (this.pokePoint.y - this.pokeSmooth.y) * 0.3;
		}
		for (const drip of this.drips) drip.r.step(dt);
		const alive: Drip[] = [];
		for (const drip of this.drips) {
			if (!drip.r.rest && !(drip.r.x < 0.3 && drip.r.v < 0)) alive.push(drip);
		}
		this.drips.length = 0;
		this.drips.push(...alive);

		if (this.mode === "snap" && this.along.rest && this.gap.rest) {
			this.mode = "anchored";
			this.dockedAt = (performance.now() - this.startedAt) / 1000;
			// poke 在 beginDrag 里清成了 0，落位后按指针位置重新压入，避免第一帧直接跳到目标值
			this.poke.to(this.pokeDepth(this.pointer), 260, 0.75);
			const range = this.alongRange(this.edge, this.sw.target, this.sh.target);
			this.config.pos =
				(this.along.x - range[0]) / Math.max(1, range[1] - range[0]);
			this.stored.edge = this.edge;
			this.stored.pos = this.config.pos;
			writeStored(this.stored);
			this.neckEdge = this.edge;
			// 液桥在 snap 阶段（gap < JOIN）就已经长满，这里只把它补到 1。
			// 重放 snap(0) 会让贴边轮廓掉回普通圆角矩形：顶边两侧的内凹圆角先缩回、
			// 几帧后再长出来，落位后看起来就是「顶边闪一下」
			this.neckS.to(1, 520, 1);
		}

		this.updateHoverState(now);
		this.render();
		this.updateMusicPeak(dt, now);
		// dt 已是秒；不能再除以 1000，否则 PetFace 的弹簧推进慢 1000 倍、动效几乎静止
		this.updatePet(dt, now / 1000);

		if (this.needsFrames()) {
			this.raf = requestAnimationFrame(this.tick);
		}
	};

	private updateHoverState(now: number): void {
		if (!this.desktopQuery.matches || this.mode !== "anchored") return;
		const inside = this.inBody(this.pointer) && !this.playHovering();
		if (inside) {
			this.outSince = null;
			// 只有悬停展开模式会因停留而自动展开；点击展开模式只认显式点击
			if (!this.expandedState && this.config.expandMode === "hover") {
				if (this.hoverSince === null) this.hoverSince = now;
				else if (now - this.hoverSince >= HOVER_EXPAND_MS) {
					this.hoverSince = null;
					this.expand();
				}
			}
			return;
		}
		this.hoverSince = null;
		if (!this.expandedState) return;
		// 两种模式统一：鼠标移出本体就回缩成胶囊，不必再去点面板外面
		if (this.outSince === null) this.outSince = now;
		else if (now - this.outSince >= COLLAPSE_DELAY_MS) {
			this.outSince = null;
			this.collapse();
		}
	}

	private playHovering(): boolean {
		if (!this.playButton || this.expandedState) return false;
		return this.playButton.classList.contains("is-hover");
	}

	private updateMusicPeak(dt: number, now: number): void {
		const api = musicApi();
		const playing = Boolean(api?.getState?.()?.isPlaying);
		let raw = 0;
		if (playing) {
			const peak = api?.getPeak?.();
			// getPeak 在没有分析器（远程音频被 CORS 挡掉）时恒返回 0：
			// 0 当「拿不到能量」处理，退回合成节拍，否则律动条只剩一两像素的起伏
			raw =
				typeof peak === "number" && Number.isFinite(peak) && peak > 0.02
					? clamp(peak, 0, 1)
					: 0.55 + 0.45 * Math.sin(now / 370) * Math.sin(now / 131 + 0.7);
		}
		this.peakSmoothed += (raw - this.peakSmoothed) * Math.min(1, dt * 16);
		// 不再往根节点写 --di-peak：没有任何规则消费它，而每帧改根上的自定义属性
		// 会让整棵子树重算样式，正好拖在律动最需要顺滑的时候
		const energy = 0.55 + 0.45 * this.peakSmoothed;
		for (let i = 0; i < this.bars.length; i++) {
			// 每根速度、相位都不同：四根不会像一整块跟着呼吸；
			// 速度差只有 ±30%，看起来仍是同一首歌的拍点。
			// 拍点用 (0.5+0.5sin)^2：峰值到顶、低位停留够久，四根才有"打点"感，
			// 直接用 |sin| 会一直挂在中高位，看着像没在动
			const phase = (now / 1000) * (1 + i * 0.09);
			const pulse = (0.5 + 0.5 * Math.sin(phase * 11 + i * 1.9)) ** 2;
			const target = playing ? 0.3 + 0.7 * energy * pulse : 0.3;
			// 上升快、回落慢：电平表的手感；单段插值会把峰值抹平，看着发木
			const rate = target > this.barValues[i] ? 32 : 11;
			this.barValues[i] +=
				(target - this.barValues[i]) * Math.min(1, dt * rate);
			this.bars[i]?.style.setProperty("--di-bar", this.barValues[i].toFixed(3));
		}
	}

	private updatePet(dt: number, now: number): void {
		// 只在页面面可见时驱动表情：音乐面或展开态下小形象是隐藏的
		const face = this.root.dataset.diFace;
		if (this.expandedState || face === "music") {
			this.petFaceEl.style.opacity = "0";
			return;
		}
		this.petFaceEl.style.opacity = "1";
		const body = this.currentBody();
		const look = {
			x: this.pointer.x - (body.x + body.w / 2),
			y: this.pointer.y - (body.y + body.h / 2),
		};
		const near = this.inBody(this.pointer);
		const frame = this.petFace.step(dt, now, look, near, 1);
		this.applyPetFrame(frame);
	}

	private applyPetFrame(frame: PetFrame): void {
		const setEye = (
			el: SVGRectElement,
			eye: PetFrame["left"],
			glow: SVGEllipseElement,
		): void => {
			const x = eye.cx - eye.w / 2;
			el.setAttribute("x", x.toFixed(2));
			el.setAttribute("y", (eye.cy - eye.h / 2).toFixed(2));
			el.setAttribute("width", Math.max(0.5, eye.w).toFixed(2));
			el.setAttribute("height", Math.max(1, eye.h).toFixed(2));
			glow.setAttribute("cx", eye.cx.toFixed(2));
			glow.setAttribute("cy", eye.cy.toFixed(2));
			glow.setAttribute("rx", (eye.w * 0.95 + 3).toFixed(2));
			glow.setAttribute("ry", (eye.h * 0.75 + 3).toFixed(2));
		};
		setEye(this.petEyeL, frame.left, this.petGlowL);
		setEye(this.petEyeR, frame.right, this.petGlowR);

		const mood = frame.mood;
		const isLove = mood === "love";
		const isSquint = mood === "squint";
		const isStar = mood === "star";
		// 特殊形状出现程度
		this.petEyeL.style.opacity =
			isLove || isSquint ? String(1 - frame.morph) : "1";
		this.petEyeR.style.opacity =
			isLove || isSquint ? String(1 - frame.morph) : "1";
		this.petHeart.style.opacity = isLove ? frame.morph.toFixed(2) : "0";
		if (isLove) {
			const s =
				15 *
				(1 + 0.08 * Math.sin(performance.now() / 140)) *
				(0.6 + 0.4 * frame.morph);
			this.petHeart.setAttribute("d", heartPath(0, 1, s));
		}
		this.petSparkles.forEach((spark, index) => {
			spark.style.opacity = isStar ? "0.9" : "0";
			if (isStar)
				spark.setAttribute(
					"d",
					sparklePath(
						index === 0 ? 1.4 : -2.2,
						index === 0 ? -2.2 : 3,
						index === 0 ? 3.4 : 1.6,
					),
				);
		});
		this.petBlushL.style.opacity = frame.blush.toFixed(2);
		this.petBlushR.style.opacity = frame.blush.toFixed(2);

		// 嘴：happy/wink/love/shy 微笑；laugh 张口；surprise/star 圆点；pout 横；squint 小笑
		const mx = frame.mouthX;
		const my = frame.mouthY;
		let mouth = "";
		if (["happy", "wink", "love", "shy"].includes(mood)) {
			mouth = `M ${mx - 3.5} ${my} Q ${mx} ${my + 4.2} ${mx + 3.5} ${my}`;
		} else if (mood === "laugh") {
			mouth = `M ${mx - 4.5} ${my - 0.5} Q ${mx} ${my + 8.5} ${mx + 4.5} ${my - 0.5} Z`;
		} else if (mood === "star" || mood === "surprise") {
			mouth = `M ${mx} ${my - 2.8} a 2.4 2.8 0 1 0 0.01 0 Z`;
		} else if (mood === "pout") {
			mouth = `M ${mx - 3} ${my + 1.5} L ${mx + 3} ${my + 1.5}`;
		} else {
			mouth = `M ${mx - 3} ${my} Q ${mx} ${my + 3.5} ${mx + 3} ${my}`;
		}
		this.petMouth.setAttribute("d", mouth);
	}

	private render(): void {
		this.syncLayerSize();
		const w = Math.max(40, this.sw.x);
		const h = Math.max(24, this.sh.x);
		const center: Point = { x: this.fx.x, y: this.fy.x };
		let squash = 0;
		let vx = this.fx.v;
		let vy = this.fy.v;
		let bodyW = w;
		let bodyH = h;
		let bodyCenter = center;
		let radii: Radii;

		if (this.mode === "anchored") {
			const pk = clamp(this.poke.x, -0.5, 1.2);
			// 不按 !expandedState 门控：展开时按压改为动画释放（expand 里 poke.to(0)），
			// 挤压分量要跟随弹簧一起松开，否则展开第一帧仍会跳一下。
			// 展开期间无人再触发按压（pointermove 分支要求收起态），poke 恒为 0，无副作用
			if (Math.abs(pk) > 0.002) {
				if (isHorizontal(this.edge)) {
					bodyH = h * (1 - 0.16 * pk);
					bodyW = w * (1 + 0.05 * pk);
				} else {
					bodyW = w * (1 - 0.16 * pk);
					bodyH = h * (1 + 0.05 * pk);
				}
			}
			bodyCenter = this.centerOnEdge(
				this.edge,
				this.anchorAlong(bodyW, bodyH),
				0,
				bodyW,
				bodyH,
			);
		} else if (this.mode === "snap") {
			let g = this.gap.x;
			if (g < 0) {
				squash = -g;
				g = 0;
			}
			if (isHorizontal(this.edge)) {
				bodyH = Math.max(h * 0.62, h - squash);
				bodyW = w + squash * 1.1;
			} else {
				bodyW = Math.max(w * 0.62, w - squash);
				bodyH = h + squash * 1.1;
			}
			bodyCenter = this.centerOnEdge(this.edge, this.along.x, g, bodyW, bodyH);
			const va = this.along.v;
			const vg = this.gap.v;
			const vectors: Record<Edge, [number, number]> = {
				top: [va, vg],
				bottom: [va, -vg],
				left: [vg, va],
				right: [-vg, va],
			};
			[vx, vy] = vectors[this.edge];
			if (this.neckEdge === null && g < JOIN) {
				this.neckEdge = this.edge;
				this.neckS.snap(0);
				this.neckS.to(1, 520, 1);
			}
		} else {
			bodyCenter = center;
			vx = this.fx.v;
			vy = this.fy.v;
			if (this.neckEdge) {
				const gn = this.gapTo(this.neckEdge, {
					x: bodyCenter.x - bodyW / 2,
					y: bodyCenter.y - bodyH / 2,
					w: bodyW,
					h: bodyH,
				});
				if (gn > BREAK) this.breakNeck();
			}
			if (!this.neckEdge && this.mode === "drag") {
				const body: Rect = {
					x: bodyCenter.x - bodyW / 2,
					y: bodyCenter.y - bodyH / 2,
					w: bodyW,
					h: bodyH,
				};
				const near = this.nearestEdge(body);
				if (near.gap < JOIN) {
					this.neckEdge = near.edge;
					this.neckS.snap(0);
					this.neckS.to(1, 520, 1);
				}
			}
		}

		const body: Rect = {
			x: bodyCenter.x - bodyW / 2,
			y: bodyCenter.y - bodyH / 2,
			w: bodyW,
			h: bodyH,
		};
		this.renderedBody = body;

		const baseR =
			this.expandedState || bodyH > 60
				? Math.min(30, bodyH / 2, bodyW / 2)
				: Math.min(bodyH / 2, bodyW / 2, 30);
		const time = (performance.now() - this.startedAt) / 1000;
		let fillet = FILLET;
		if (this.mode === "anchored" && !this.expandedState && !this.reduceMotion) {
			// 相位从贴边那一帧起算：按绝对时间算的话，切换瞬间会随相位跳最多 0.9px
			fillet *= 1 + 0.07 * Math.sin((time - this.dockedAt) * 1.7);
		}
		fillet += Math.min(12, (Math.abs(this.sw.v) + Math.abs(this.sh.v)) * 0.012);

		let unifiedEdge: Edge | null = null; // 贴边态：用并集点集轮廓替代 body+neck 拼接，避免内缝
		let unitedPts: Point[] | null = null; // 拉伸态：本体+液桥并集点集（单条轮廓，无底边横线）
		let neckStrength = 0;
		if (this.neckEdge) {
			const edge = this.neckEdge;
			const line = this.line(edge);
			const gapN = Math.max(0, this.gapTo(edge, body));
			const t = clamp((gapN - NECK_LIFT) / (BREAK - NECK_LIFT), 0, 1);
			let corner = baseR * smooth(t * 1.8);
			corner = lerp(baseR, corner, this.neckS.x);
			const flags = edgeCorners(edge);
			radii = flags.map((flag) => (flag ? corner : baseR)) as Radii;
			neckStrength = this.neckS.x;
			if (gapN < DOCK_GAP && neckStrength > 0.5) {
				unifiedEdge = edge;
			} else if (neckStrength > 0.01) {
				// 与原项目 united() 等价：一条连续轮廓从液桥内凹直接过渡到本体顶边，
				// 液桥底边不进入轮廓，描边时衔接处不再出现横杠。
				unitedPts = unitedNeckPoints(
					edge,
					line,
					body,
					baseR,
					fillet,
					corner,
					gapN,
					t,
					neckStrength,
					4,
				);
			}
		} else {
			radii = [baseR, baseR, baseR, baseR];
		}

		const speed = Math.hypot(vx, vy);
		const playing =
			this.root.dataset.diPlaying === "true" && !this.expandedState;
		const poking = this.mode === "anchored" && Math.abs(this.poke.x) > 0.01;
		const far: Point = {
			top: { x: 0, y: 1 },
			bottom: { x: 0, y: -1 },
			left: { x: 1, y: 0 },
			right: { x: -1, y: 0 },
		}[this.edge];
		const wave = (px: number, py: number, nx: number, ny: number): number => {
			let extra = 0;
			if (playing) {
				const wgt = Math.max(0, nx * far.x + ny * far.y);
				if (wgt >= 0.3) {
					const u = far.x === 0 ? px : py;
					extra +=
						this.peakSmoothed * 2.4 * wgt * wgt * Math.sin(u * 0.09 - time * 7);
				}
			}
			if (poking) {
				const horizFar = far.x === 0;
				const nearLine = horizFar
					? this.edge === "top"
						? body.y
						: body.y + body.h
					: this.edge === "left"
						? body.x
						: body.x + body.w;
				const depth = horizFar ? body.h : body.w;
				const v = Math.abs((horizFar ? py : px) - nearLine);
				const wgt = clamp((v - depth * 0.3) / (depth * 0.7), 0, 1);
				if (wgt > 0) {
					const u0 = clamp(
						horizFar ? this.pokeSmooth.x : this.pokeSmooth.y,
						horizFar ? body.x : body.y,
						horizFar ? body.x + body.w : body.y + body.h,
					);
					const sigma = Math.max(20, (horizFar ? body.w : body.h) / 2) * 0.5;
					const d = ((horizFar ? px : py) - u0) / sigma;
					const g = Math.exp(-0.5 * d * d);
					const amp = clamp(this.poke.x, -0.6, 1.2) * 8;
					extra += amp * wgt * wgt * (-g + 0.35 * (1 - g));
				}
			}
			return extra;
		};
		const shouldDeform =
			!this.reduceMotion && (speed > 30 || playing || poking);

		let path: string;
		const outlinePts = unifiedEdge
			? attachedOutlinePoints(
					unifiedEdge,
					this.line(unifiedEdge),
					body,
					baseR,
					fillet,
					neckStrength,
					4,
				)
			: unitedPts;
		if (outlinePts) {
			// 贴边 / 拉伸态：并集点集整体形变，描边与玻璃共用同一条连续轮廓（无液桥底边横线）
			const deformed = shouldDeform
				? deform(
						outlinePts,
						bodyCenter.x,
						bodyCenter.y,
						vx,
						vy,
						Math.min(bodyW, bodyH) / 2 + 12,
						wave,
					)
				: outlinePts;
			path = polyPathD(deformed);
		} else {
			const pts = bodyPoints(body, radii, 4);
			const deformed = shouldDeform
				? deform(
						pts,
						bodyCenter.x,
						bodyCenter.y,
						vx,
						vy,
						Math.min(bodyW, bodyH) / 2 + 12,
						wave,
					)
				: pts;
			path = shouldDeform ? polyPathD(deformed) : bodyPathD(body, radii);
		}
		for (const drip of this.drips) {
			const horiz = isHorizontal(drip.edge);
			path += ` ${dripPathD(
				drip.edge,
				drip.line,
				horiz ? bodyCenter.x : bodyCenter.y,
				Math.max(0, drip.r.x),
			)}`;
		}

		// 与原项目一致：描边描整条融合路径（含液桥内凹曲线），曲线自带圆滑边框
		this.glass.style.clipPath = `path("${path}")`;
		this.shadowPath.setAttribute("d", path);
		this.tintPath.setAttribute("d", path);
		this.flowPath.setAttribute("d", path);
		this.outlinePath.setAttribute("d", path);
		this.rimPath.setAttribute("d", path);
		// 内高光渐变沿本体纵向（userSpaceOnUse），随本体移动
		this.rimGrad.setAttribute("gradientUnits", "userSpaceOnUse");
		this.rimGrad.setAttribute("x1", "0");
		this.rimGrad.setAttribute("y1", `${body.y}`);
		this.rimGrad.setAttribute("x2", "0");
		this.rimGrad.setAttribute("y2", `${body.y + body.h}`);

		const flowPhase = Math.sin(time * 0.55) * 0.5 + 0.5;
		const flowPoint = isHorizontal(this.edge)
			? {
					x: body.x + body.w * flowPhase,
					y: this.edge === "bottom" ? body.y + body.h : body.y,
				}
			: {
					x: this.edge === "left" ? body.x + body.w : body.x,
					y: body.y + body.h * flowPhase,
				};
		this.flowGrad.setAttribute("cx", `${flowPoint.x}`);
		this.flowGrad.setAttribute("cy", `${flowPoint.y}`);

		this.vector.setAttribute(
			"viewBox",
			`0 0 ${this.viewportWidth()} ${this.viewportHeight()}`,
		);
		const contentA = easeOut(clamp(this.contentA.x, 0, 1));
		const compactA = easeOut(clamp(this.compactA.x, 0, 1));
		this.content.style.left = `${body.x}px`;
		this.content.style.top = `${body.y}px`;
		this.content.style.width = `${bodyW}px`;
		this.content.style.height = `${bodyH}px`;
		if (this.expandedState) {
			// wisland _content_rect：展开内容固定为目标尺寸、贴吸附边，只被玻璃形状裁剪，
			// 不随弹簧尺寸伸缩——否则淡入阶段内容会被过冲 / 回摆反复拉伸挤压（「干硬」的来源）
			const [tw, th] = this.targetSize();
			this.expanded.style.left = `${((bodyW - tw) / 2).toFixed(2)}px`;
			this.expanded.style.top = `${(this.edge === "bottom" && this.mode === "anchored" ? bodyH - th : 0).toFixed(2)}px`;
			this.expanded.style.width = `${tw}px`;
			this.expanded.style.height = `${th}px`;
		}
		this.compact.style.opacity = compactA.toFixed(3);
		this.expanded.style.opacity = contentA.toFixed(3);
		this.compact.style.pointerEvents = compactA > 0.5 ? "auto" : "none";
		this.expanded.style.pointerEvents = contentA > 0.5 ? "auto" : "none";
		this.root.dataset.navBottom = this.edge === "bottom" ? "true" : "false";
		this.root.dataset.edge = this.edge;

		// 胶囊跟随目录菜单的悬停项；未悬停时隐藏
		const menuItem =
			this.menuHoverIndex >= 0 ? this.menuItems[this.menuHoverIndex] : null;
		if (menuItem) {
			this.pill.style.opacity = "1";
			this.pill.style.width = `${String(menuItem.offsetWidth)}px`;
			// offsetLeft 以 .di-nav__menu 为基准，胶囊的包含块却是 .di-nav，
			// 补上菜单自身的偏移（导航条内边距），否则高亮整体左移一个内边距
			const menuOffset = this.menu?.offsetLeft ?? 0;
			this.pill.style.transform = `translateX(${String(menuItem.offsetLeft + menuOffset - 4)}px)`;
		} else {
			this.pill.style.opacity = "0";
		}
		// 选中项的图标层跟随布局变化重新就位（窗口宽度 / 菜单项位置变了不至于错位）
		if (this.menuSelectedIndex >= 0) {
			this.placeMenuIconBox(this.menuItems[this.menuSelectedIndex]);
		}
	}

	// ---------------------------------------------------------------- 热力图

	/** 文章按「月-周」分桶（0 基），与资料卡一致：月内 7 天切块 1-7 / 8-14 / 15-21 / 22-月末 */
	private static cellKeyOf(month: number, day: number): string {
		return `${month}-${Math.min(3, Math.floor((day - 1) / 7))}`;
	}

	private static cellDateRangeOf(key: string): {
		month: number;
		start: number;
		end: number;
	} {
		const [monthRaw, weekRaw] = key.split("-").map(Number);
		const start = weekRaw * 7 + 1;
		const lastDay = new Date(
			new Date().getFullYear(),
			monthRaw + 1,
			0,
		).getDate();
		return { month: monthRaw, start, end: weekRaw === 3 ? lastDay : start + 6 };
	}

	private formatWeekLabel(key: string): string {
		const [monthRaw, weekRaw] = key.split("-").map(Number);
		const monthName = new Intl.DateTimeFormat(this.config.locale, {
			month: "short",
		}).format(new Date(2000, monthRaw, 1));
		return this.config.labels.weekFormat
			.replace("{month}", monthName)
			.replace("{week}", String(weekRaw + 1));
	}

	private loadHeatmap(): void {
		if (this.heatLoaded || !this.heatmap || !this.config.api) return;
		this.heatLoaded = true;
		window
			.fetch(this.config.api, { credentials: "same-origin" })
			.then((response) =>
				response.ok ? response.json() : Promise.reject(new Error("heatmap")),
			)
			.then((data: unknown) => {
				if (!Array.isArray(data)) return;
				const year = new Date().getFullYear();
				const buckets = new Map<
					string,
					Array<{ id: string; title: string; published: number }>
				>();
				for (const item of data) {
					if (!item || typeof item !== "object") continue;
					const raw = item as {
						id?: unknown;
						title?: unknown;
						published?: unknown;
					};
					if (typeof raw.published !== "number") continue;
					const date = new Date(raw.published);
					if (date.getFullYear() !== year) continue;
					const key = DynamicIsland.cellKeyOf(date.getMonth(), date.getDate());
					const bucket = buckets.get(key);
					const post = {
						id: String(raw.id ?? ""),
						title: String(raw.title ?? ""),
						published: raw.published,
					};
					if (bucket) bucket.push(post);
					else buckets.set(key, [post]);
				}
				for (const bucket of buckets.values())
					bucket.sort((a, b) => b.published - a.published);
				this.postsByCell = buckets;
				this.renderHeatmapCounts();
				this.markCurrentWeek();
			})
			.catch(() => {
				/* 离线或接口失败时保留空热力图 */
			});
	}

	private renderHeatmapCounts(): void {
		if (!this.heatmap) return;
		const cells = this.heatmap.querySelectorAll<HTMLElement>(
			"[data-di-heat-cell]",
		);
		cells.forEach((cell) => {
			const key = cell.dataset.diHeatCell ?? "";
			const count = this.postsByCell.get(key)?.length ?? 0;
			cell.dataset.diLevel =
				count === 0 ? "0" : count <= 1 ? "1" : count <= 3 ? "2" : "3";
			if (count > 0) cell.dataset.diTooltipCount = String(count);
			else delete cell.dataset.diTooltipCount;
			const label = this.formatWeekLabel(key);
			cell.setAttribute(
				"aria-label",
				count > 0
					? `${label} · ${this.config.labels.postCount.replace("{count}", String(count))}`
					: label,
			);
		});
	}

	private markCurrentWeek(): void {
		if (!this.heatmap) return;
		const now = new Date();
		const cell = this.heatmap.querySelector<HTMLElement>(
			`[data-di-heat-cell="${DynamicIsland.cellKeyOf(now.getMonth(), now.getDate())}"]`,
		);
		cell?.classList.add("is-current");
	}

	/** 首页面板入场：名片逐件浮现 + 热力图逐列扫描（每次展开 / 切回都播，与资料卡一致） */
	private playHomeReveal(): void {
		if (
			!this.heatmap ||
			this.reduceMotion ||
			!this.expandedState ||
			this.currentTab !== "home"
		)
			return;
		this.playProfileReveal();
		const columns = Array.from(
			this.heatmap.querySelectorAll<HTMLElement>(".di-profile__heat-col"),
		);
		// 取消上一次残留的动画，重复展开时从头扫描
		for (const el of this.heatmap.querySelectorAll<HTMLElement>(
			".di-profile__heat-cell, .di-profile__heat-month",
		)) {
			for (const anim of el.getAnimations()) anim.cancel();
		}
		const cellFade = 320;
		const stagger = 20;
		columns.forEach((column, index) => {
			column
				.querySelectorAll<HTMLElement>(".di-profile__heat-cell")
				.forEach((cell) => {
					cell.animate(
						[
							{ opacity: 0, transform: "scale(0.4)" },
							{ opacity: 1, transform: "scale(1)" },
						],
						{
							duration: cellFade,
							delay: index * stagger,
							easing: "cubic-bezier(0.22, 1, 0.36, 1)",
							fill: "backwards",
						},
					);
				});
		});
		const sweepEnd = (columns.length - 1) * stagger + cellFade;
		columns.forEach((column) => {
			column.querySelector<HTMLElement>(".di-profile__heat-month")?.animate(
				[
					{ opacity: 0, filter: "blur(6px)" },
					{ opacity: 1, filter: "blur(0px)" },
				],
				{
					duration: 450,
					delay: sweepEnd,
					easing: "cubic-bezier(0.22, 1, 0.36, 1)",
					fill: "backwards",
				},
			);
		});
	}

	/**
	 * 名片入场：照片墙定格 -> 头像弹入 -> 名字职业上浮 -> 社交图标逐个浮现，
	 * 与热力图扫描（0-660ms）并行推进。同样只在不可见帧钉起始帧，重放无闪烁。
	 */
	private playProfileReveal(): void {
		const card = this.root.querySelector<HTMLElement>(".di-profile-card");
		if (!card) return;
		// 取消上一次残留动画，重复入场时从头播
		for (const el of card.querySelectorAll<HTMLElement>(
			".di-profile-card__banner, .di-profile__avatar, .di-profile__identity, .di-profile__social",
		)) {
			for (const anim of el.getAnimations()) anim.cancel();
		}
		const easeOut = "cubic-bezier(0.22, 1, 0.36, 1)";
		// 头像用带回弹的曲线，与整体「液态」手感一致
		const easePop = "cubic-bezier(0.34, 1.56, 0.64, 1)";
		card.querySelector<HTMLElement>(".di-profile-card__banner")?.animate(
			[
				{ opacity: 0, transform: "scale(1.06)" },
				{ opacity: 1, transform: "scale(1)" },
			],
			{ duration: 480, easing: easeOut, fill: "backwards" },
		);
		card.querySelector<HTMLElement>(".di-profile__avatar")?.animate(
			[
				{ opacity: 0, transform: "scale(0.5)" },
				{ opacity: 1, transform: "scale(1)" },
			],
			{ duration: 380, delay: 90, easing: easePop, fill: "backwards" },
		);
		card.querySelector<HTMLElement>(".di-profile__identity")?.animate(
			[
				{ opacity: 0, transform: "translateY(8px)" },
				{ opacity: 1, transform: "translateY(0)" },
			],
			{ duration: 360, delay: 170, easing: easeOut, fill: "backwards" },
		);
		card
			.querySelectorAll<HTMLElement>(".di-profile__social")
			.forEach((social, index) => {
				social.animate(
					[
						{ opacity: 0, transform: "translateY(6px) scale(0.8)" },
						{ opacity: 1, transform: "translateY(0) scale(1)" },
					],
					{
						duration: 320,
						delay: 240 + index * 40,
						easing: easeOut,
						// 只在延迟期占住起始帧，结束后把 hover 过渡交还给 CSS
						fill: "backwards",
					},
				);
			});
	}

	/* ── 热力图提示浮层 ── */
	private cancelTooltipFrames(): void {
		for (const frame of this.tooltipFrames) cancelAnimationFrame(frame);
		this.tooltipFrames = [];
	}

	private showTooltip(source: HTMLElement): void {
		if (!this.tooltip) return;
		const label = source.dataset.diTooltipLabel;
		if (!label) return;
		const target = Number(source.dataset.diTooltipCount ?? 0);
		const { tooltip } = this;
		this.cancelTooltipFrames();
		tooltip.replaceChildren(
			document.createTextNode(target > 0 ? `${label} · ` : label),
		);
		if (target > 0) {
			const [before, after = ""] =
				this.config.labels.postCount.split("{count}");
			const roll = this.buildCountRoll(target);
			tooltip.append(document.createTextNode(before), roll, after);
			this.animateCountRoll(roll, target);
		}
		const sourceRect = source.getBoundingClientRect();
		// 浮层挂在 .di-home 里，坐标必须以它的包含块为基准；
		// 拿整个视口层（root）算会把提示推到面板外，还会被 overflow 裁掉
		const host = (tooltip.offsetParent as HTMLElement | null) ?? this.root;
		const hostRect = host.getBoundingClientRect();
		tooltip.style.left = `${sourceRect.left - hostRect.left + sourceRect.width / 2}px`;
		tooltip.style.top = `${sourceRect.top - hostRect.top - 4}px`;
		tooltip.classList.add("is-visible");
	}

	private hideTooltip(): void {
		this.cancelTooltipFrames();
		this.tooltip?.classList.remove("is-visible");
	}

	private buildCountRoll(target: number): HTMLElement {
		const roll = document.createElement("span");
		roll.className = "di-profile__tooltip-roll";
		const strip = document.createElement("span");
		strip.className = "di-profile__tooltip-roll-strip";
		for (let value = 0; value <= target; value += 1) {
			const cell = document.createElement("span");
			cell.textContent = String(value);
			strip.append(cell);
		}
		roll.append(strip);
		return roll;
	}

	private animateCountRoll(roll: HTMLElement, target: number): void {
		const strip = roll.firstElementChild;
		if (!(strip instanceof HTMLElement)) return;
		const cellHeight =
			strip.firstElementChild?.getBoundingClientRect().height ?? 0;
		const shift = (value: number): void => {
			strip.style.transform = `translate3d(0, ${String(-value * cellHeight)}px, 0)`;
		};
		if (cellHeight <= 0 || this.reduceMotion) {
			shift(target);
			return;
		}
		const start = performance.now();
		const duration = 420;
		shift(0);
		const tick = (now: number): void => {
			const progress = Math.min(1, (now - start) / duration);
			shift(target * (1 - (1 - progress) ** 3));
			if (progress < 1) this.tooltipFrames.push(requestAnimationFrame(tick));
			else shift(target);
		};
		this.tooltipFrames.push(requestAnimationFrame(tick));
	}

	/* ── 热力图点格：热力图整块上滚，换成该周文章列表 ── */
	private collapseWeek(): void {
		if (this.selectedCellKey) {
			this.heatmap
				?.querySelector<HTMLElement>(
					`[data-di-heat-cell="${this.selectedCellKey}"]`,
				)
				?.classList.remove("is-selected");
			this.heatmap
				?.querySelector<HTMLElement>(
					`[data-di-heat-cell="${this.selectedCellKey}"]`,
				)
				?.setAttribute("aria-pressed", "false");
		}
		this.selectedCellKey = null;
		// 只切视图：列表内容留着垫底，等滚出舞台后再被下一次选中覆盖，
		// 否则回滚动画会先看到一片空白
		if (this.heatRoot) this.heatRoot.dataset.diWeekView = "false";
	}

	private selectCell(key: string): void {
		const posts = this.postsByCell.get(key);
		if (!posts || posts.length === 0) return;
		this.selectedCellKey = key;
		const cell = this.heatmap?.querySelector<HTMLElement>(
			`[data-di-heat-cell="${key}"]`,
		);
		cell?.classList.add("is-selected");
		cell?.setAttribute("aria-pressed", "true");
		if (this.postsTitle) {
			const { month, start, end } = DynamicIsland.cellDateRangeOf(key);
			const pad = (value: number): string => String(value).padStart(2, "0");
			const count = this.config.labels.postCount.replace(
				"{count}",
				String(posts.length),
			);
			this.postsTitle.textContent = `${this.formatWeekLabel(key)} · ${pad(month + 1)}.${pad(start)} – ${pad(month + 1)}.${pad(end)} · ${count}`;
		}
		if (this.postList) {
			this.postList.replaceChildren();
			for (const post of posts) {
				const link = document.createElement("a");
				link.className = "di-profile__post-link";
				link.href = `${this.config.postBaseUrl}${post.id.replace(/^\/+|\/+$/g, "")}/`;
				link.textContent = post.title;
				this.postList.append(link);
			}
		}
		if (this.weekPosts) this.weekPosts.hidden = false;
		// 内容先就位再上滚，滑入过程里列表已经是完整的
		if (this.heatRoot) this.heatRoot.dataset.diWeekView = "true";
	}

	/* ── 站点胶囊开合（展开向上覆盖热力图，头像 FLIP） ── */
	private avatarRects(scope: HTMLElement | null): Map<string, DOMRect> {
		const rects = new Map<string, DOMRect>();
		scope
			?.querySelectorAll<HTMLElement>("[data-profile-avatar]")
			.forEach((avatar) => {
				const key = avatar.dataset.profileAvatar;
				if (key !== undefined) rects.set(key, avatar.getBoundingClientRect());
			});
		return rects;
	}

	private flipAvatars(
		scope: HTMLElement | null,
		from: Map<string, DOMRect>,
	): void {
		if (!scope || this.reduceMotion) return;
		scope
			.querySelectorAll<HTMLElement>("[data-profile-avatar]")
			.forEach((avatar) => {
				const key = avatar.dataset.profileAvatar;
				const source = key === undefined ? undefined : from.get(key);
				if (!source) return;
				const target = avatar.getBoundingClientRect();
				const dx = source.left - target.left;
				const dy = source.top - target.top;
				if (dx === 0 && dy === 0) return;
				avatar.animate(
					[
						{ transform: `translate(${String(dx)}px, ${String(dy)}px)` },
						{ transform: "translate(0px, 0px)" },
					],
					{ duration: 360, easing: "cubic-bezier(0.32, 0.72, 0.29, 1)" },
				);
			});
	}

	private sitesTargetHeight(): number {
		if (!this.sites || !this.sitesBar) return 34;
		// 展开时向上覆盖：顶/底边布局盖住整个热力图区（heat 高度）；
		// 贴左/右边时名片在热力图上方，量上层 .di-home__top 的总高，
		// 面板从 heat 底部向上铺满整张名片，而不只盖住热力图那块
		const scope =
			this.sitesOpen && !isHorizontal(this.edge)
				? (this.sites.closest<HTMLElement>(".di-home__top") ??
					this.sites.parentElement)
				: this.sites.parentElement;
		return this.sitesOpen
			? Math.max(this.sitesBar.offsetHeight, scope?.clientHeight ?? 0)
			: this.sitesBar.offsetHeight;
	}

	private syncSitesHeight(): void {
		if (!this.sites) return;
		// 折叠态交回 CSS 的固定条高：展开初期布局还没稳定时量到 0，
		// 也不会把站点条写成 0 高而从面板里消失
		this.sites.style.height = this.sitesOpen
			? `${String(this.sitesTargetHeight())}px`
			: "";
	}

	private setSitesOpen(next: boolean): void {
		if (!this.sites || next === this.sitesOpen) return;
		const from = this.avatarRects(next ? this.sitesStack : this.sitesList);
		this.sitesOpen = next;
		this.sites.dataset.diSitesOpen = String(next);
		this.sitesToggle?.setAttribute("aria-expanded", String(next));
		this.hideTooltip();
		this.syncSitesHeight();
		this.flipAvatars(next ? this.sitesList : this.sitesStack, from);
	}

	private resetSites(): void {
		if (!this.sites || !this.sitesOpen) return;
		this.sitesOpen = false;
		this.sites.dataset.diSitesOpen = "false";
		this.sitesToggle?.setAttribute("aria-expanded", "false");
		this.syncSitesHeight();
	}

	// ---------------------------------------------------------------- 清理
	private destroy(): void {
		this.abort.abort();
		this.resizeObserver?.disconnect();
		for (const unsub of this.musicUnsub) unsub();
		this.musicUnsub = [];
		if (this.tapTimer !== null) window.clearTimeout(this.tapTimer);
		if (this.clockTimer !== null) window.clearInterval(this.clockTimer);
		this.cancelMenuIconAnimations();
		this.stopFaceTimer();
		this.cancelTooltipFrames();
		if (this.raf) cancelAnimationFrame(this.raf);
		this.raf = 0;
	}

	/** 供工具按钮调用：切换展开方式（hover / always / never）。 */
	setExpandMode(mode: IslandConfig["expandMode"]): void {
		this.applyExpandMode(mode, true);
	}
}

function must<T extends Element>(root: HTMLElement, selector: string): T {
	const node = root.querySelector<T>(selector);
	if (!node) throw new Error(`DynamicIsland: missing ${selector}`);
	return node;
}

function centerOnAxis(point: Point, edge: Edge): number {
	return isHorizontal(edge) ? point.x : point.y;
}

/** 爱心路径（移植 PetFace._heart）。 */
function heartPath(cx: number, cy: number, size: number): string {
	const w = size;
	return (
		`M ${cx} ${cy + w * 0.42} ` +
		`C ${cx - w * 0.9} ${cy - w * 0.05} ${cx - w * 0.45} ${cy - w * 0.75} ${cx} ${cy - w * 0.28} ` +
		`C ${cx + w * 0.45} ${cy - w * 0.75} ${cx + w * 0.9} ${cy - w * 0.05} ${cx} ${cy + w * 0.42} Z`
	);
}

/** 星星闪光路径（移植 PetFace._sparkle）。 */
function sparklePath(cx: number, cy: number, r: number): string {
	return (
		`M ${cx} ${cy - r} Q ${cx} ${cy} ${cx + r} ${cy} ` +
		`Q ${cx} ${cy} ${cx} ${cy + r} Q ${cx} ${cy} ${cx - r} ${cy} Q ${cx} ${cy} ${cx} ${cy - r} Z`
	);
}

export function initDynamicIsland(root: HTMLElement): () => void {
	const island = new DynamicIsland(root);
	return island.setup();
}
