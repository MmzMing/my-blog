/**
 * 右侧大纲面板（Obsidian 风格）控制器。
 *
 * 结构：工具栏（手风琴三模式 + 思维导图 + 进度%）/ 节点树（圆点 + SVG 竖轨
 * 主干与进度线 + 阅读位置指示器）/ 思维导图弹窗。树、竖轨与指示器全部由本
 * 控制器在客户端渲染。
 *
 * 坑位备忘：
 * - 面板是 max-height 封顶 + 树内部滚动；底部钳制锚在页脚顶边（不再锚正文卡底）：
 *   面板底边触到页脚顶后随文档滚走，不悬浮在页脚上；
 * - 可切换面板（带 [data-toc-related] 相关文章视图时）：许可协议卡底边与面板
 *   底边对齐后切为堆叠换牌——目录留在文档流撑高（面板几何恒定，底边即固定触发
 *   线），相关文章绝对叠在同位、按自然高度向下溢出。换牌时两层都只做淡入淡出，
 *   位移交给层内逐项落位（按 --toc-stagger 依次下移归位，控制器按文档序编号）；
 *   退场层原地淡出。交错入场在首次真实切换时才启用（is-mode-armed）。
 *   退出带 24px 迟滞；
 * - 竖轨取点用圆点中心相对树容器的位置（含 scrollTop），SVG 作为树的第一个
 *   子节点随内容一起滚，滚动树不需要重画；指示器相反，它挂在外层并按视口坐标
 *   定位（__tree 的 overflow 会裁掉起飞），所以每帧都要用 nav 矩形反算一次，
 *   这条前提是面板祖先链上不能有 transform/filter——见 transition.css 里为
 *   .article-toc-panel 把进出场位移退化成纯 opacity 的那段约定；
 * - 折叠动画用 grid-template-rows 1fr→0fr 过渡（无需 JS 测量高度），动画期间
 *   由 startTrackAnimation 逐帧重画竖轨，让轨跟着行一起动；轨长随折叠变化，
 *   同一阅读位置对应的弧长也变，故每次重画都重新定一次指示器目标；
 * - 手风琴的展开/收起状态挂在行容器的 is-collapsed 类上，子树隐藏交给
 *   CSS 结构（嵌套列表 + 0fr 裁剪），不再逐行打 is-hidden。
 */

import {
	collectTocTree,
	type TocNode,
	type TocTree,
} from "@/utils/article-toc-tree";
import { definePageIsland } from "@/utils/swup-lifecycle";

/** 活动行居中滚动的节流间隔（沿用旧浏览列表的节奏） */
const READING_OFFSET = 80;
const ACTIVE_SCROLL_THROTTLE = 120;
/** 连接线拐角处的圆弧半径（px），思维导图的分支线仍在用 */
const LINE_CORNER_RADIUS = 5;
/** 竖轨在层级变化处的斜向台阶长度 = 两点纵向距离 × 该系数 */
const TRACK_BEND_RATIO = 0.3;
/** 指示器沿轨追赶阅读位置的弹簧；朝向另配一套更硬的，转向要利落 */
const TRAVEL_SPRING = { stiffness: 140, damping: 26, mass: 0.6 };
const TURN_SPRING = { stiffness: 260, damping: 30, mass: 1 };
/** 反向追轨前指示器必须先多走的弧长（px），防止滚动抖动把它来回翻向 */
const TURN_SLACK = 2;
/** 页面贴边后继续滚够这么多像素，指示器才离轨起飞 */
const OVERSCROLL = 720;
/** 滚轮 deltaMode 为「行」时一行折算的像素数 */
const WHEEL_LINE_PIXELS = 16;
/** 起飞轨迹的水平内缩与落地余量（px） */
const FLIGHT_EDGE_INSET = 10;
const FLIGHT_BOTTOM_GAP = 8;
/** 指示器贴可视框边缘时的留隙（px），取 --toc-plane-size 的半长，让它整只留在框内 */
const PLANE_EDGE_INSET = 8;
/** 指示器中心与圆点中心近于这个距离（px）时，圆点算被它压住 */
const PLANE_DOT_COVER = 6;
/** 弹簧收敛判据：位移与速度都低于阈值即视为停住（弧长按 px、朝向按度） */
const SPRING_EPSILON = 0.05;
/** 单帧最大步长（秒）：后台标签页回到前台时帧差会突跳，不夹住会一步跨过整条轨迹 */
const SPRING_MAX_STEP = 0.04;
/* 起飞轨迹的采样与形状常量（量纲是 px 与秒） */
const FALL_STEP = 1 / 60;
const FALL_TIMEOUT = 8;
const THROW_SPEED = 260;
const THROW_DECAY = 0.35;
const THROW_SINK_MIN = 90;
const THROW_SINK_MAX = 240;
const SWAY = 56;
const SWAY_PERIOD = 1.8;
const BOB = 16;
const SKID = 0.35;
const SKID_INSET = 8;
/** 导图缩放边界与步进 */
const MINDMAP_ZOOM_MIN = 0.5;
const MINDMAP_ZOOM_MAX = 2.5;
const MINDMAP_ZOOM_STEP = 0.2;
/** 滚轮缩放的单档倍率与拖拽平移的触发阈值（px） */
const MINDMAP_WHEEL_FACTOR = 1.1;
const MINDMAP_PAN_THRESHOLD = 4;
/* 底边留隙：矮视口 fitTop 保护与页脚钳制共用——面板底边与屏底/页脚顶保持这段距离 */
const RAIL_BOTTOM_GAP = 24;
/** 目录 ↔ 相关文章转换的退出迟滞（px），避免贴边慢滚时来回切换 */
const MODE_HYSTERESIS = 24;
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

function clamp(value: number, minimum: number, maximum: number): number {
	return Math.min(Math.max(value, minimum), maximum);
}

function prefersReducedMotion(): boolean {
	return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

type TrackPoint = { x: number; y: number };

/** 起飞轨迹：相对起飞点的位移序列与朝向序列，按归一化进度插值 */
type FallTrajectory = {
	xs: number[];
	ys: number[];
	angles: number[];
	duration: number;
};

type FlightTween = {
	from: number;
	to: number;
	duration: number;
	elapsed: number;
};

/**
 * 二阶阻尼弹簧（a = (-k·(x-target) - c·v)/m，半隐式欧拉积分）。
 * 只服务指示器的弧长与朝向两个量，所以阈值与单位写死在内部，不做成通用件。
 */
class DampedSpring {
	value: number;
	target: number;
	private velocity = 0;
	private readonly stiffness: number;
	private readonly damping: number;
	private readonly mass: number;

	constructor(initial: number, config: typeof TRAVEL_SPRING) {
		this.value = initial;
		this.target = initial;
		this.stiffness = config.stiffness;
		this.damping = config.damping;
		this.mass = config.mass;
	}

	jump(value: number): void {
		this.value = value;
		this.target = value;
		this.velocity = 0;
	}

	setTarget(value: number): void {
		this.target = value;
	}

	/** 积分一帧，返回是否仍在运动 */
	step(dt: number): boolean {
		const accel =
			(-this.stiffness * (this.value - this.target) -
				this.damping * this.velocity) /
			this.mass;
		this.velocity += accel * dt;
		this.value += this.velocity * dt;
		if (
			Math.abs(this.target - this.value) < SPRING_EPSILON &&
			Math.abs(this.velocity) < SPRING_EPSILON
		) {
			this.value = this.target;
			this.velocity = 0;
			return false;
		}
		return true;
	}
}

/**
 * 竖轨路径：自上而下串联可见圆点。层级变化处插两个点做斜向台阶，
 * 台阶的圆润交给 CSS 的 linejoin，不在 path 里写弧线。
 */
function buildTrackPath(points: TrackPoint[]): string {
	if (points.length === 0) return "";
	const nodes: TrackPoint[] = [points[0]];
	for (let i = 1; i < points.length; i += 1) {
		const from = points[i - 1];
		const to = points[i];
		if (from.x !== to.x) {
			const bend = (to.y - from.y) * TRACK_BEND_RATIO;
			nodes.push({ x: from.x, y: from.y + bend });
			nodes.push({ x: to.x, y: to.y - bend });
		}
		nodes.push(to);
	}
	return nodes
		.map((point, i) => `${i === 0 ? "M" : "L"}${point.x} ${point.y}`)
		.join(" ");
}

/** 轨只向下走，y 沿弧长单调：二分出某个圆点纵坐标对应的弧长 */
function lengthAtY(path: SVGPathElement, total: number, y: number): number {
	let lo = 0;
	let hi = total;
	for (let i = 0; i < 24; i += 1) {
		const mid = (lo + hi) / 2;
		if (path.getPointAtLength(mid).y < y) {
			lo = mid;
		} else {
			hi = mid;
		}
	}
	return hi;
}

function sampleFall(values: number[], progress: number): number {
	const at = clamp(progress, 0, 1) * (values.length - 1);
	const i = Math.floor(at);
	const next = values[Math.min(values.length - 1, i + 1)];
	return values[i] + (next - values[i]) * (at - i);
}

/**
 * 一条被抛出去的纸飞机轨迹：抛掷的惯性衰减成左右摆动的下滑，触地后再贴地
 * 滑行一段并把机头摆平。左右与地面边界都是相对起飞点的位移，故传入的边界
 * 也要在同一坐标系里。
 */
function planFall(
	nose: TrackPoint,
	left: number,
	right: number,
	floor: number,
): FallTrajectory {
	const side = nose.x < 0 ? -1 : 1;
	const sway = Math.max(0, Math.min(SWAY, (right - left) / 2 - SKID_INSET));
	const sink = clamp(floor / 2.6, THROW_SINK_MIN, THROW_SINK_MAX);
	const omega = (2 * Math.PI) / SWAY_PERIOD;
	const xs = [0];
	const ys = [0];

	for (let t = FALL_STEP; t < FALL_TIMEOUT; t += FALL_STEP) {
		const thrown = THROW_SPEED * THROW_DECAY * (1 - Math.exp(-t / THROW_DECAY));
		const grow = 1 - Math.exp(-t / 0.5);
		const fx = nose.x * thrown + side * sway * grow * Math.sin(omega * t);
		const fy =
			nose.y * thrown +
			sink * (t - 0.4 * (1 - Math.exp(-t / 0.4))) +
			(BOB * grow * (Math.cos(2 * omega * t) - 1)) / 2;
		xs.push(clamp(fx, left, right));
		ys.push(Math.min(floor, fy));
		if (fy >= floor) break;
	}

	const airborne = xs.length;
	const drift = (xs[airborne - 1] - xs[airborne - 2]) / FALL_STEP;
	for (let t = FALL_STEP; t <= SKID; t += FALL_STEP) {
		const k = 1 - t / SKID;
		xs.push(clamp(xs[xs.length - 1] + drift * k * FALL_STEP, left, right));
		ys.push(floor);
	}

	const angles: number[] = [];
	for (let i = 0; i < xs.length; i += 1) {
		const a = Math.max(0, i - 1);
		const b = Math.min(xs.length - 1, i + 1);
		let angle = (Math.atan2(ys[b] - ys[a], xs[b] - xs[a]) * 180) / Math.PI + 90;
		if (i >= airborne) {
			const k = Math.min(1, (i - airborne + 1) / (SKID / FALL_STEP));
			angle += (lyingAngle(drift, angle) - angle) * k;
		}
		const prev = angles[i - 1] ?? angle;
		angles.push(angle + 360 * Math.round((prev - angle) / 360));
	}

	return { xs, ys, angles, duration: (xs.length - 1) * FALL_STEP };
}

/** 落地段机头躺向：还有水平漂移就朝漂移方向，否则按当前朝向就近倒下 */
function lyingAngle(drift: number, angle: number): number {
	if (drift !== 0) {
		return drift < 0 ? 270 : 90;
	}
	return angle < 180 ? 90 : 270;
}

export class ArticleTocPanelController {
	private readonly root: HTMLElement;
	private readonly abortController = new AbortController();
	private readonly treeNav: HTMLElement | null;
	private readonly linesSvg: SVGSVGElement | null;
	private readonly autoButton: HTMLButtonElement | null;
	private readonly toggleAllButton: HTMLButtonElement | null;
	private readonly mindmapButton: HTMLButtonElement | null;
	private readonly progressRegion: HTMLElement | null;
	private readonly progressLabel: HTMLElement | null;
	private readonly mindmapDialog: HTMLDialogElement | null;
	private readonly mindmapCanvas: HTMLElement | null;
	private readonly mindmapTree: HTMLElement | null;
	private readonly mindmapLinesSvg: SVGSVGElement | null;
	private readonly mindmapZoomOutButton: HTMLButtonElement | null;
	private readonly mindmapZoomInButton: HTMLButtonElement | null;
	private readonly mindmapResetButton: HTMLButtonElement | null;
	private readonly mindmapFullscreenButton: HTMLButtonElement | null;

	private tree: TocTree | null = null;
	private article: HTMLElement | null = null;
	private articleStart = 0;
	private articleEnd = 0;
	/** 各标题的文档绝对纵坐标，下标对齐 tree.nodes */
	private headingTops: number[] = [];
	/** 自动手风琴（自动收拢）开关；展开跟随不受此开关影响 */
	private autoEnabled = true;
	/** 自动手风琴的手动覆盖：下标 → 期望展开状态（仅开关开启时生效） */
	private manualState = new Map<number, boolean>();
	private activeIndex = -1;
	private activeChain = new Set<number>();
	private lastProgressPercent = -1;
	/** 行 DOM 引用，下标对齐 tree.nodes；根行不在此列 */
	private rows: {
		row: HTMLElement;
		link: HTMLAnchorElement;
		dot: HTMLElement;
		toggle: HTMLButtonElement | null;
	}[] = [];
	private rootDot: HTMLElement | null = null;
	/* ---------- 竖轨与指示器状态 ---------- */
	/** 竖轨两条常驻 path：底层虚线与按弧长填充的进度线，共用同一个 d */
	private trackBase: SVGPathElement | null = null;
	private trackProgress: SVGPathElement | null = null;
	/** 轨上点的弧长与对应的 tree.nodes 下标（-1 是根圆点），两数组下标互相对齐 */
	private trackLengths: number[] = [];
	private trackNodeIndexes: number[] = [];
	/** 轨上点的坐标，与 trackLengths 同序，供指示器算「压住哪颗圆点」 */
	private trackPoints: TrackPoint[] = [];
	private trackTotal = 0;
	/** 上一次写给圆点的已走过数量，-1 表示还没写过（重画轨后重置以强制回写） */
	private coveredCount = -1;
	/** 当前被指示器遮住的那颗圆点 */
	private dotUnderPlane: HTMLElement | null = null;
	/** 首次定轨前不让指示器从轨头弹簧爬起，直接落在当前阅读位置上 */
	private trackPlaced = false;
	/** 指示器挂在 __view 上按视口坐标定位；planeX/planeY 是它在树内容坐标里的锚点 */
	private readonly planeEl: HTMLElement | null;
	private readonly travel = new DampedSpring(0, TRAVEL_SPRING);
	private readonly heading = new DampedSpring(180, TURN_SPRING);
	/** 指示器朝向：沿轨向下为 1、回滚向上为 -1，换向得先攒够 TURN_SLACK */
	private facing: 1 | -1 = 1;
	private turnFrom = 0;
	/** 指示器在树内容坐标里的锚点，起飞位移叠加在它上面 */
	private planeX = 0;
	private planeY = 0;
	/** 起飞状态：flight 是 0..1 的归一化进度，away 记从哪端离轨（0 表示在轨上） */
	private flight = 0;
	private away: -1 | 0 | 1 = 0;
	private flightTween: FlightTween | null = null;
	private fall: FallTrajectory | null = null;
	/** 贴边后累积的滚动量，攒够 OVERSCROLL 才起飞 */
	private spill = 0;
	private touchY = 0;
	private tickFrame: number | null = null;
	private lastTickAt = 0;
	/** 文章标题（根圆点）的绝对纵坐标，指示器在根与首个标题之间插值用 */
	private rootTop = 0;
	private animationFrame: number | null = null;
	private measureFrame: number | null = null;
	private trackFrame: number | null = null;
	/** 折叠动画期间逐帧重画竖轨用的帧句柄与截止时刻 */
	private trackAnimFrame: number | null = null;
	private trackAnimUntil = 0;
	private activeScrollTimer: ReturnType<typeof setTimeout> | null = null;
	private resizeObserver: ResizeObserver | null = null;
	private mindmapNodePills: (HTMLElement | null)[] = [];
	private mindmapRootPill: HTMLElement | null = null;
	/** 导图连接线 path，下标对齐 tree.nodes，供悬停链高亮 */
	private mindmapPaths: (SVGPathElement | null)[] = [];
	/** 导图缩放倍率，通过树容器的 font-size（em 体系）生效 */
	private mindmapZoom = 1;
	/** 画布拖拽平移的进行中状态；null 表示未在拖拽 */
	private panState: {
		pointerId: number;
		startX: number;
		startY: number;
		scrollLeft: number;
		scrollTop: number;
	} | null = null;
	/** 刚完成一次拖拽时吞掉随之而来的 click，避免拖拽结束误触节点跳转 */
	private mindmapPanDragged = false;
	/* 停靠状态：顶部跟随（信息卡顶 → 8rem 停靠线），底部钳制在页脚顶边 */
	private railBaseTop = 0;
	private railHeight = 0;
	/** 相关文章浮层的自然高度（向下溢出面板的部分），参与页脚钳制占位 */
	private relatedHeight = 0;
	private appliedRailTop: number | null = null;
	/** 顶部跟随锚点（过期提示/AI 摘要/封面图信息卡）：初始与卡顶对齐，不存在则恒停靠 */
	private introAnchor: HTMLElement | null = null;
	/** 底部钳制锚点：面板底边触到页脚顶边后随文档滚走，不悬浮在页脚上 */
	private footerEl: HTMLElement | null = null;
	/* 目录 ↔ 相关文章转换状态机：仅有 [data-toc-related] 时启用（transitionEnabled）。
	   目录视图留在文档流撑高，切换只改可见性与淡入淡出，面板几何恒定、触发线稳定 */
	private relatedLayer: HTMLElement | null = null;
	private licenseEl: HTMLElement | null = null;
	private fallbackAnchorEl: HTMLElement | null = null;
	private transitionEnabled = false;
	private mode: "toc" | "related" = "toc";
	/** 首次定态前不播动画（滚动恢复/前进后退落在转换区时防闪） */
	private modeInitialized = false;

	constructor(root: HTMLElement) {
		this.root = root;
		this.treeNav = root.querySelector("[data-toc-tree]");
		this.linesSvg = root.querySelector("[data-toc-lines]");
		this.autoButton = root.querySelector("[data-toc-auto-btn]");
		this.toggleAllButton = root.querySelector("[data-toc-toggle-all-btn]");
		this.mindmapButton = root.querySelector("[data-toc-mindmap-btn]");
		this.progressRegion = root.querySelector("[data-toc-progress]");
		this.progressLabel = root.querySelector("[data-toc-progress-label]");
		this.mindmapDialog = root.querySelector("[data-toc-mindmap]");
		this.mindmapCanvas = root.querySelector("[data-toc-mindmap-canvas]");
		this.mindmapTree = root.querySelector("[data-toc-mindmap-tree]");
		this.mindmapLinesSvg = root.querySelector("[data-toc-mindmap-lines]");
		this.mindmapZoomOutButton = root.querySelector(
			"[data-toc-mindmap-zoom-out]",
		);
		this.mindmapZoomInButton = root.querySelector("[data-toc-mindmap-zoom-in]");
		this.mindmapResetButton = root.querySelector("[data-toc-mindmap-reset]");
		this.mindmapFullscreenButton = root.querySelector(
			"[data-toc-mindmap-fullscreen]",
		);
		this.planeEl = root.querySelector("[data-toc-plane]");
	}

	public init(): boolean {
		this.article =
			document.querySelector(".custom-md") ??
			document.querySelector(".prose") ??
			document.querySelector(".markdown-content");
		this.tree = collectTocTree();
		if (!this.article || !this.tree || !this.treeNav || !this.linesSvg) {
			this.root.hidden = true;
			return false;
		}

		this.root.hidden = false;
		// 信息卡缺省（无摘要/过期/封面）时为 null，syncDock 退化为恒停靠在 railBaseTop
		this.introAnchor = document.querySelector(".post-intro-card");
		// 页脚在容器外常驻，缓存引用安全（不随 Swup 换页重建）
		this.footerEl = document.querySelector("[data-site-footer]");
		// 相关文章视图存在才启用转换；锚点优先许可协议卡，缺省兜底正文卡底
		this.relatedLayer = this.root.querySelector("[data-toc-related]");
		this.transitionEnabled = !!this.relatedLayer;
		if (this.transitionEnabled) {
			this.licenseEl = document.querySelector(".license-container");
			this.fallbackAnchorEl = document.querySelector("#post-container");
		}
		this.cachePositions();
		this.renderRows();
		this.applyStagger();
		this.bindInteractions();
		this.resizeObserver = new ResizeObserver(() => this.scheduleMeasure());
		this.resizeObserver.observe(this.article);
		// 字体换字、封面图折叠等会推移信息卡顶，一并监听以重算停靠位置与标题坐标
		const hero = document.querySelector(".post-hero");
		if (hero) this.resizeObserver.observe(hero);
		if (this.introAnchor) this.resizeObserver.observe(this.introAnchor);
		window.addEventListener("scroll", () => this.scheduleUpdate(), {
			passive: true,
			signal: this.abortController.signal,
		});
		window.addEventListener("resize", () => this.scheduleMeasure(), {
			passive: true,
			signal: this.abortController.signal,
		});

		this.root.classList.remove("is-pending");
		this.applyAutoAccordion();
		this.syncToggleAllButton();
		/* 竖轨必须赶在面板露出第一帧前画好：指示器是视口定位的，晚一帧就会先在
		   屏幕左上角闪一下才跳到轨上 */
		this.drawTrack();
		this.update();
		return true;
	}

	public destroy(): void {
		this.abortController.abort();
		this.resizeObserver?.disconnect();
		this.resizeObserver = null;
		this.root.style.top = "";
		this.root.classList.remove(
			"is-related-mode",
			"is-mode-armed",
			"is-mode-no-anim",
		);
		this.appliedRailTop = null;
		if (this.animationFrame !== null) cancelAnimationFrame(this.animationFrame);
		if (this.measureFrame !== null) cancelAnimationFrame(this.measureFrame);
		if (this.trackFrame !== null) cancelAnimationFrame(this.trackFrame);
		if (this.trackAnimFrame !== null) cancelAnimationFrame(this.trackAnimFrame);
		if (this.tickFrame !== null) cancelAnimationFrame(this.tickFrame);
		if (this.activeScrollTimer) clearTimeout(this.activeScrollTimer);
		this.animationFrame = null;
		this.measureFrame = null;
		this.trackFrame = null;
		this.trackAnimFrame = null;
		this.tickFrame = null;
		this.activeScrollTimer = null;
		/* 弹窗还开着时导航走人：显式关掉，避免顶层 layer 残留焦点陷阱 */
		if (this.mindmapDialog?.open) this.mindmapDialog.close();
	}

	/* ---------- 渲染 ---------- */

	private renderRows(): void {
		const tree = this.tree;
		const svg = this.linesSvg;
		const nav = this.treeNav;
		if (!tree || !nav || !svg) return;

		const fragment = document.createDocumentFragment();
		this.rows = [];
		/* 两条常驻 path：之后每帧只改 d 与 dasharray，不再逐节点增删元素 */
		this.trackBase = document.createElementNS(SVG_NAMESPACE, "path");
		this.trackBase.classList.add("article-toc-panel__track-base");
		this.trackProgress = document.createElementNS(SVG_NAMESPACE, "path");
		this.trackProgress.classList.add("article-toc-panel__track-progress");
		svg.replaceChildren(this.trackBase, this.trackProgress);
		this.trackPlaced = false;
		this.dotUnderPlane = null;
		this.coveredCount = -1;

		const rootRow = document.createElement("div");
		rootRow.className = "article-toc-panel__row article-toc-panel__row--root";
		rootRow.dataset.tocIndex = "-1";
		const rootLink = document.createElement("a");
		rootLink.className = "article-toc-panel__link";
		rootLink.href = "#";
		rootLink.dataset.tocNavigate = "-1";
		rootLink.title = tree.title;
		const rootDot = document.createElement("span");
		rootDot.className = "article-toc-panel__dot";
		const rootText = document.createElement("span");
		rootText.className = "article-toc-panel__text";
		rootText.textContent = tree.title;
		rootLink.append(rootDot, rootText);
		rootRow.appendChild(rootLink);
		fragment.appendChild(rootRow);
		this.rootDot = rootDot;

		/* 嵌套列表：子级挂在父级的 children 容器里，折叠动画由 CSS 结构完成 */
		const rootList = document.createElement("ul");
		rootList.className = "article-toc-panel__list";
		tree.nodes
			.filter((node) => node.parent < 0)
			.forEach((node) => {
				this.buildItem(node, rootList);
			});
		fragment.appendChild(rootList);

		nav.replaceChildren(svg, fragment);
	}

	/** 递归构建列表项；children 顺序即文档序，rows 引用也按此顺序入栈 */
	private buildItem(node: TocNode, list: HTMLElement): void {
		const item = document.createElement("li");
		item.className = "article-toc-panel__item";
		item.dataset.tocIndex = String(node.index);

		const row = document.createElement("div");
		row.className = "article-toc-panel__row";
		row.dataset.tocLevel = String(node.level);
		row.style.setProperty("--toc-level", String(node.level));

		const link = document.createElement("a");
		link.className = "article-toc-panel__link";
		link.href = node.id ? `#${encodeURIComponent(node.id)}` : "#";
		link.dataset.tocNavigate = String(node.index);
		link.title = node.text;

		const dot = document.createElement("span");
		dot.className = "article-toc-panel__dot";
		const text = document.createElement("span");
		text.className = "article-toc-panel__text";
		text.textContent = node.text;
		link.append(dot, text);
		row.appendChild(link);

		let toggle: HTMLButtonElement | null = null;
		if (node.children.length > 0) {
			toggle = document.createElement("button");
			toggle.type = "button";
			toggle.className = "article-toc-panel__toggle";
			toggle.dataset.tocToggle = String(node.index);
			toggle.setAttribute("aria-expanded", "true");
			row.appendChild(toggle);
		}
		item.appendChild(row);

		/* rows 必须按文档序（先序）入栈，下标才与 node.index 对齐 */
		this.rows.push({ row, link, dot, toggle });

		if (node.children.length > 0) {
			const wrap = document.createElement("div");
			wrap.className = "article-toc-panel__children";
			const childList = document.createElement("ul");
			childList.className = "article-toc-panel__list";
			node.children.forEach((childIndex) => {
				const child = this.tree?.nodes[childIndex];
				if (child) this.buildItem(child, childList);
			});
			wrap.appendChild(childList);
			item.appendChild(wrap);
		}

		list.appendChild(item);
	}

	/* ---------- 手风琴 ---------- */

	/** 自动手风琴开关：只控制「自动收拢」；展开跟随不受影响。
	    开启时立即按当前阅读位置收拢一次，关闭则非活动分支保持现状 */
	private setAutoEnabled(enabled: boolean): void {
		this.autoEnabled = enabled;
		this.manualState.clear();
		this.autoButton?.setAttribute("aria-pressed", String(enabled));
		if (!enabled) return;

		if (this.applyAutoAccordion()) this.startTrackAnimation();
		this.scheduleTrack();
		this.syncToggleAllButton();
	}

	/**
	 * 一键展开/收起（一次性动作，与自动开关解耦）：根据当前树状态决定方向，
	 * aria-pressed 表示「当前是否全展开」，图标与 tooltip 预告点击后的动作。
	 */
	private toggleAll(): void {
		this.applyExpandAll(!this.isAllExpanded());
		this.startTrackAnimation();
		this.scheduleTrack();
		this.syncToggleAllButton();
	}

	private isAllExpanded(): boolean {
		const tree = this.tree;
		if (!tree) return false;
		return tree.nodes.every(
			(node) =>
				node.children.length === 0 ||
				!this.rows[node.index]?.row.classList.contains("is-collapsed"),
		);
	}

	private syncToggleAllButton(): void {
		const button = this.toggleAllButton;
		if (!button) return;

		const expanded = this.isAllExpanded();
		button.setAttribute("aria-pressed", String(expanded));
		const label = expanded
			? (button.dataset.tocCollapseLabel ?? "")
			: (button.dataset.tocExpandLabel ?? "");
		if (!label) return;
		button.setAttribute("aria-label", label);
		button.dataset.tooltip = label;
	}

	/** 当前活动节点的祖先链（含自身） */
	private rebuildActiveChain(): void {
		this.activeChain = new Set<number>();
		const tree = this.tree;
		if (!tree) return;
		let cursor = this.activeIndex;
		while (cursor >= 0) {
			this.activeChain.add(cursor);
			cursor = tree.nodes[cursor].parent;
		}
	}

	/**
	 * 展开跟随 + 自动手风琴：
	 * - 展开跟随始终生效——阅读位置进入哪个分支，该分支（活动链）自动展开；
	 * - 开关只控制「自动收拢」这一半：开启时非活动链分支收拢成手风琴，
	 *   关闭时非活动分支保持现状，只展不收；
	 * - 手动覆盖（行尾箭头）优先，阅读位置滚出其子树区间后解除。
	 * 返回本次是否有折叠状态变化（用于决定是否播放动画）。
	 */
	private applyAutoAccordion(): boolean {
		const tree = this.tree;
		if (!tree) return false;

		let changed = false;
		this.manualState.forEach((_, index) => {
			const node = tree.nodes[index];
			const inside =
				this.activeIndex >= node.subtreeStart &&
				this.activeIndex <= node.subtreeEnd;
			if (!inside) this.manualState.delete(index);
		});

		tree.nodes.forEach((node) => {
			const ref = this.rows[node.index];
			if (!ref?.toggle) return;

			const isCollapsedNow = ref.row.classList.contains("is-collapsed");
			let expanded: boolean;
			if (this.manualState.has(node.index)) {
				expanded = this.manualState.get(node.index) === true;
			} else if (this.activeChain.has(node.index)) {
				expanded = true;
			} else if (!this.autoEnabled) {
				expanded = !isCollapsedNow;
			} else {
				expanded = false;
			}

			const willCollapse = !expanded;
			if (isCollapsedNow !== willCollapse) changed = true;
			ref.row.classList.toggle("is-collapsed", willCollapse);
			ref.toggle.setAttribute("aria-expanded", String(expanded));
		});
		return changed;
	}

	/** 一键全展开 / 全收起，直接作用于树，不看活动链也不改自动开关 */
	private applyExpandAll(expand: boolean): void {
		const tree = this.tree;
		if (!tree) return;

		tree.nodes.forEach((node) => {
			const ref = this.rows[node.index];
			if (!ref?.toggle) return;
			ref.row.classList.toggle("is-collapsed", !expand);
			ref.toggle.setAttribute("aria-expanded", String(expand));
		});
	}

	private toggleCollapse(index: number): void {
		const ref = this.rows[index];
		if (!ref?.toggle) return;

		const nextExpanded = ref.row.classList.contains("is-collapsed");
		if (this.autoEnabled) this.manualState.set(index, nextExpanded);
		ref.row.classList.toggle("is-collapsed", !nextExpanded);
		ref.toggle.setAttribute("aria-expanded", String(nextExpanded));
		this.startTrackAnimation();
		this.syncToggleAllButton();
	}

	/** 点击标题：跳转的同时展开该节点（收起只通过行尾箭头） */
	private expandNode(index: number): void {
		const ref = this.rows[index];
		if (!ref?.toggle) return;
		if (!ref.row.classList.contains("is-collapsed")) return;

		this.manualState.set(index, true);
		ref.row.classList.remove("is-collapsed");
		ref.toggle.setAttribute("aria-expanded", "true");
		this.startTrackAnimation();
		this.syncToggleAllButton();
	}

	/* ---------- 竖轨与指示器 ---------- */

	private scheduleTrack(): void {
		if (this.trackFrame !== null) return;
		this.trackFrame = requestAnimationFrame(() => {
			this.trackFrame = null;
			this.drawTrack();
			if (this.mindmapDialog?.open) this.drawMindmapLines();
		});
	}

	/** 折叠动画期间逐帧重画竖轨，让轨跟着行的展开/收起一起动 */
	private startTrackAnimation(durationMs = 280): void {
		if (prefersReducedMotion()) {
			this.scheduleTrack();
			return;
		}
		this.trackAnimUntil = Math.max(
			this.trackAnimUntil,
			performance.now() + durationMs,
		);
		if (this.trackAnimFrame !== null) return;

		const tick = () => {
			this.drawTrack();
			if (performance.now() < this.trackAnimUntil) {
				this.trackAnimFrame = requestAnimationFrame(tick);
				return;
			}
			this.trackAnimFrame = null;
			this.trackAnimUntil = 0;
			this.drawTrack();
		};
		this.trackAnimFrame = requestAnimationFrame(tick);
	}

	/** 树容器的局部坐标：视口坐标 → 容器内容坐标（含滚动） */
	private toTreeLocal(rect: DOMRect): { x: number; y: number } {
		const nav = this.treeNav;
		if (!nav) return { x: 0, y: 0 };
		const navRect = nav.getBoundingClientRect();
		return {
			x: rect.left - navRect.left + nav.scrollLeft,
			y: rect.top - navRect.top + nav.scrollTop,
		};
	}

	/** 圆点中心（树内容坐标）；宽高皆 0 说明量不到（未挂载或已被裁剪） */
	private dotCenter(dot: HTMLElement | null): { x: number; y: number } | null {
		if (!dot) return null;
		const rect = dot.getBoundingClientRect();
		if (rect.width === 0 && rect.height === 0) return null;
		const local = this.toTreeLocal(rect);
		return { x: local.x + rect.width / 2, y: local.y + rect.height / 2 };
	}

	/** 行是否可见：任一祖先收起即被 0fr 裁剪（offsetParent 探测不到） */
	private isNodeVisible(index: number): boolean {
		const tree = this.tree;
		if (!tree) return false;
		let cursor = tree.nodes[index].parent;
		while (cursor >= 0) {
			if (this.rows[cursor]?.row.classList.contains("is-collapsed")) {
				return false;
			}
			cursor = tree.nodes[cursor].parent;
		}
		return true;
	}

	/**
	 * 竖轨：一根自上而下贯穿所有可见圆点的连续路径，上叠一条按阅读弧长填充的
	 * 进度线。折叠掉的子树不参与取点，轨于是自动从父圆点拐向下一个可见兄弟。
	 */
	private drawTrack(): void {
		const tree = this.tree;
		const svg = this.linesSvg;
		const nav = this.treeNav;
		const base = this.trackBase;
		const progress = this.trackProgress;
		if (!tree || !svg || !nav || !base || !progress) return;

		/* 先归零再测量：svg 的旧高度是绝对定位溢出，会污染 scrollHeight
		   （只涨不缩的棘轮），在树里残留大片可滚动的空白 */
		svg.setAttribute("width", "0");
		svg.setAttribute("height", "0");
		svg.setAttribute("width", String(nav.clientWidth));
		svg.setAttribute(
			"height",
			String(Math.max(nav.scrollHeight, nav.clientHeight)),
		);

		const hadTrack = this.trackTotal > 0;
		const points: TrackPoint[] = [];
		const indexes: number[] = [];
		const rootCenter = this.dotCenter(this.rootDot);
		if (rootCenter) {
			points.push(rootCenter);
			indexes.push(-1);
		}
		tree.nodes.forEach((node) => {
			if (!this.isNodeVisible(node.index)) return;
			const center = this.dotCenter(this.rows[node.index]?.dot ?? null);
			if (!center) return;
			points.push(center);
			indexes.push(node.index);
		});

		const d = buildTrackPath(points);
		if (!d) {
			base.removeAttribute("d");
			progress.removeAttribute("d");
			this.trackTotal = 0;
			this.trackLengths = [];
			this.trackNodeIndexes = [];
			this.trackPoints = [];
			this.coveredCount = -1;
			return;
		}
		base.setAttribute("d", d);
		progress.setAttribute("d", d);
		this.trackTotal = base.getTotalLength();
		this.trackLengths = points.map((point) =>
			lengthAtY(base, this.trackTotal, point.y),
		);
		this.trackNodeIndexes = indexes;
		this.trackPoints = points;
		/* 圆点的实心/遮蔽状态是按弧长算的，轨形一变就得整体回写一次 */
		this.coveredCount = -1;

		/* 轨从空到有（窄屏拉宽、加密文章解密出标题）时重新定一次位：
		   已放置过的指示器会按弹簧从 0 弧长一路爬上来，那是条不存在的阅读过程 */
		if (!hadTrack) this.trackPlaced = false;

		/* 收拢/展开会整体改变轨长，同一阅读位置对应的弧长跟着变：重定目标再按当前
		   弧长落位，否则指示器会从旧弧长一路爬过来，看着像线在追自己 */
		this.aim(this.readingLength());
		this.pose(this.travel.value);
	}

	/**
	 * 阅读锚点（窗口滚动 + READING_OFFSET）落在轨上的弧长：在锚点上下两个轨点之间
	 * 按标题纵坐标插值，指示器才是在两段标题之间匀滑地走，而不是逐格跳。
	 */
	private readingLength(): number {
		const lengths = this.trackLengths;
		const indexes = this.trackNodeIndexes;
		if (lengths.length === 0 || this.trackTotal <= 0) return 0;

		const anchor = window.scrollY + READING_OFFSET;
		const topOf = (index: number): number =>
			index < 0 ? this.rootTop : (this.headingTops[index] ?? this.rootTop);
		if (anchor <= topOf(indexes[0])) return lengths[0];

		for (let i = 1; i < indexes.length; i += 1) {
			const fromTop = topOf(indexes[i - 1]);
			const toTop = topOf(indexes[i]);
			if (anchor < toTop) {
				const span = toTop - fromTop;
				const ratio = span > 0 ? clamp((anchor - fromTop) / span, 0, 1) : 1;
				return lengths[i - 1] + ratio * (lengths[i] - lengths[i - 1]);
			}
		}
		return lengths[lengths.length - 1];
	}

	/**
	 * 定指示器的目标弧长。换向必须先攒够 TURN_SLACK：滚动条抖几个像素就掉头的话
	 * 机头会来回翻转，比不动更糟。
	 */
	private aim(length: number): void {
		if (!this.trackPlaced) {
			this.trackPlaced = true;
			this.travel.jump(length);
			this.pose(length);
			this.heading.jump(this.heading.target);
			return;
		}
		if (prefersReducedMotion()) {
			this.travel.jump(length);
			this.pose(length);
			return;
		}

		const from = this.turnFrom;
		if ((length - from) * this.facing > 0) {
			this.turnFrom = length;
		} else if (Math.abs(length - from) > TURN_SLACK) {
			this.facing = this.facing > 0 ? -1 : 1;
			this.turnFrom = length;
		}
		this.travel.setTarget(length);
		this.ensureTick();
	}

	/** 弧长、朝向、起飞进度共用一个帧循环，三者都停了就退帧，不空转 */
	private ensureTick(): void {
		if (this.tickFrame !== null || prefersReducedMotion()) return;
		this.lastTickAt = performance.now();
		this.tickFrame = requestAnimationFrame((now) => this.runTick(now));
	}

	private runTick(now: number): void {
		const dt = clamp((now - this.lastTickAt) / 1000, 0, SPRING_MAX_STEP);
		this.lastTickAt = now;
		const traveling = this.travel.step(dt);
		const turning = this.heading.step(dt);
		const flying = this.stepFlight(dt);
		this.pose(this.travel.value);
		this.tickFrame =
			traveling || turning || flying
				? requestAnimationFrame((next) => this.runTick(next))
				: null;
	}

	/** 把指示器放到给定弧长上：取点定朝向、按弧长写进度、重算视口位置 */
	private pose(length: number): void {
		const path = this.trackBase;
		const total = this.trackTotal;
		if (!path || !total) return;

		const at = path.getPointAtLength(length);
		const behind = path.getPointAtLength(Math.max(0, length - 1));
		const ahead = path.getPointAtLength(Math.min(total, length + 1));
		this.planeX = at.x;
		this.planeY = at.y;
		/* 起飞中不接管朝向：机头由轨迹切线说了算，这里改了会和返航打架 */
		if (!this.flight) {
			const tangent =
				(Math.atan2(ahead.y - behind.y, ahead.x - behind.x) * 180) / Math.PI;
			this.steer(tangent + 90 + (this.facing < 0 ? 180 : 0));
		}

		/* dasharray 按真实弧长写，不走 pathLength 归一——总长本来就在手上，少一层
		   跨浏览器实现差异 */
		const filled = clamp(length / total, 0, 1);
		this.trackProgress?.setAttribute(
			"stroke-dasharray",
			`${filled * total} ${total}`,
		);
		this.syncTrackDots(length);
		this.applyPlane();
	}

	/**
	 * 圆点的两种状态，对齐参照实现里「已走过填实 + 指示器处挖孔」：
	 * - 填实按弧长判定，轨上排在指示器之前的都算已走过；
	 * - 挖孔在这里做不到——圆点是带实底的 HTML span，SVG 的 mask 管不着它，
	 *   改成按 2D 距离判定「离指示器足够近就藏起来」，观感等价。
	 */
	private syncTrackDots(length: number): void {
		const reached = this.trackLengths.filter((n) => n <= length + 0.5).length;
		if (reached !== this.coveredCount) {
			this.coveredCount = reached;
			const covered = new Set<number>();
			this.trackNodeIndexes.forEach((index, i) => {
				if (i < reached && index >= 0) covered.add(index);
			});
			this.rows.forEach((ref, index) => {
				ref.dot.classList.toggle("is-covered", covered.has(index));
			});
		}

		/* 起飞后指示器已经离轨，被遮的那颗要露出来（参照实现是孔随 flight 一起缩掉） */
		let under: HTMLElement | null = null;
		if (this.flight < 0.125) {
			for (let i = 0; i < this.trackPoints.length; i += 1) {
				const point = this.trackPoints[i];
				const near =
					Math.hypot(point.x - this.planeX, point.y - this.planeY) <=
					PLANE_DOT_COVER;
				if (near) {
					under = this.dotOfTrackPoint(this.trackNodeIndexes[i]);
					break;
				}
			}
		}
		if (under === this.dotUnderPlane) return;
		this.dotUnderPlane?.classList.remove("is-under-plane");
		under?.classList.add("is-under-plane");
		this.dotUnderPlane = under;
	}

	/** 轨上某个点对应的圆点元素（-1 是根圆点） */
	private dotOfTrackPoint(index: number): HTMLElement | null {
		return index < 0 ? this.rootDot : (this.rows[index]?.dot ?? null);
	}

	/** 朝向按当前值解算整圈，弹簧才走短线而不是绕 350° 的远路 */
	private steer(angle: number): void {
		const unwrapped =
			angle + 360 * Math.round((this.heading.value - angle) / 360);
		if (prefersReducedMotion()) {
			this.heading.jump(unwrapped);
		} else {
			this.heading.setTarget(unwrapped);
		}
	}

	/**
	 * 指示器是视口定位（要越过 __tree 的 overflow 裁剪），所以每帧把树内容坐标换算
	 * 回视口：加上树矩形的当前位置，再扣掉树自身的滚动。
	 *
	 * 锚点先钳进树的可视框：轨上被裁掉的那些圆点在 SVG 里本来就看不见，视口定位的
	 * 飞机却会从面板底下钻出来。起飞位移在钳制之后才叠加，否则飞出可视框的那段会被
	 * 一路拉回边上。
	 */
	private applyPlane(): void {
		const plane = this.planeEl;
		const nav = this.treeNav;
		if (!plane || !nav) return;

		const navRect = nav.getBoundingClientRect();
		const anchorX = clamp(
			navRect.left - nav.scrollLeft + this.planeX,
			navRect.left + PLANE_EDGE_INSET,
			navRect.right - PLANE_EDGE_INSET,
		);
		const anchorY = clamp(
			navRect.top - nav.scrollTop + this.planeY,
			navRect.top + PLANE_EDGE_INSET,
			navRect.bottom - PLANE_EDGE_INSET,
		);
		const fall = this.flight ? this.fall : null;
		const left = anchorX + (fall ? sampleFall(fall.xs, this.flight) : 0);
		const top = anchorY + (fall ? sampleFall(fall.ys, this.flight) : 0);
		plane.style.transform = `translate3d(${left}px, ${top}px, 0) rotate(${this.heading.value}deg)`;
	}

	/**
	 * 推进起飞/返航的归一化进度。起飞匀速（抛出去的那一段），返航用 cubic
	 * ease-out 沿原轨迹倒着收，机头翻成领队。
	 */
	private stepFlight(dt: number): boolean {
		const tween = this.flightTween;
		if (!tween) return false;
		tween.elapsed += dt;
		const ratio =
			tween.duration > 0 ? Math.min(1, tween.elapsed / tween.duration) : 1;
		const shaped = tween.to < tween.from ? 1 - (1 - ratio) ** 3 : ratio;
		this.flight = tween.from + (tween.to - tween.from) * shaped;

		const fall = this.fall;
		if (fall && this.flight) {
			/* 返航时 away 已归零，机头要翻 180° 才领得到前面 */
			this.steer(sampleFall(fall.angles, this.flight) + (this.away ? 0 : 180));
		}
		if (ratio >= 1) {
			this.flight = tween.to;
			this.flightTween = null;
		}
		return this.flightTween !== null;
	}

	/** 页面是否贴在滚动两端：起飞只允许从这两端发生 */
	private scrollEdges(): { atTop: boolean; atEnd: boolean } {
		const doc = document.documentElement;
		return {
			atTop: window.scrollY <= 1,
			atEnd: window.scrollY >= doc.scrollHeight - window.innerHeight - 1,
		};
	}

	/** 面板不可见（窄屏）或已换成相关文章浮层时不放飞机出去 */
	private canFly(): boolean {
		if (this.mode === "related") return false;
		return getComputedStyle(this.root).display !== "none";
	}

	/**
	 * 累积贴边后的溢出滚量；方向一反向就清零，避免来回搓出起飞。
	 * 这里不查面板可见性：窄屏下累积是惰性的，真起飞时 takeOff 会把住。
	 */
	private spillBy(delta: number): void {
		if (this.away || prefersReducedMotion()) return;
		const { atTop, atEnd } = this.scrollEdges();
		const edge: -1 | 0 | 1 =
			delta > 0 && atEnd ? 1 : delta < 0 && atTop ? -1 : 0;
		if (!edge || Math.sign(this.spill) === -edge) {
			this.spill = 0;
		}
		if (!edge) return;
		this.spill += delta;
		if (Math.abs(this.spill) > OVERSCROLL) {
			this.takeOff(edge > 0 ? 1 : -1);
		}
	}

	private takeOff(edge: -1 | 1): void {
		const plane = this.planeEl;
		if (!plane || this.away || prefersReducedMotion() || !this.canFly()) return;

		this.away = edge;
		this.facing = edge;
		this.turnFrom = this.travel.target;
		const started = this.flight;
		let fall = this.fall;
		/* 还在返航途中又被推出去：沿用上一条轨迹，否则飞机会瞬移 */
		if (!started || !fall) {
			this.pose(this.travel.value);
			const rect = plane.getBoundingClientRect();
			const angle = (this.heading.value * Math.PI) / 180;
			/* 位移与边界同在视口坐标系里算：飞机本来就是视口定位的 */
			const originX = rect.left + rect.width / 2;
			const originY = rect.top + rect.height / 2;
			fall = planFall(
				{ x: Math.sin(angle), y: -Math.cos(angle) },
				FLIGHT_EDGE_INSET - originX,
				window.innerWidth - FLIGHT_EDGE_INSET - originX,
				window.innerHeight - FLIGHT_BOTTOM_GAP - originY,
			);
			this.fall = fall;
		}
		this.flightTween = {
			from: this.flight,
			to: 1,
			duration: (1 - started) * fall.duration,
			elapsed: 0,
		};
		this.ensureTick();
	}

	private land(): void {
		this.spill = 0;
		const edge = this.away;
		const fall = this.fall;
		if (!edge || !fall) return;

		this.away = 0;
		this.facing = edge > 0 ? -1 : 1;
		this.turnFrom = this.travel.target;
		this.flightTween = {
			from: this.flight,
			to: 0,
			duration: Math.max(0.6, this.flight * fall.duration * 0.45),
			elapsed: 0,
		};
		this.ensureTick();
	}

	/** 离开边缘就中断起飞改走返航；中途回滚则把累积的溢出滚量清零 */
	private syncFlightWithScroll(): void {
		const { atTop, atEnd } = this.scrollEdges();
		if (this.away) {
			const stillAtEdge = this.away > 0 ? atEnd : atTop;
			if (!stillAtEdge) this.land();
		}
		if (!atTop && !atEnd) this.spill = 0;
	}

	/* ---------- 滚动同步 ---------- */

	private cachePositions(): void {
		const tree = this.tree;
		if (!tree || !this.article) return;

		/* 停靠线（CSS 的 8rem）挂在 96rem 媒体查询里，窄屏初始化时 computed top 是
		   auto（parse 出 NaN），所以每次测量都重取，窄屏↔宽屏切换后才有正确值。
		   先摘掉内联 top 再读：否则读到的是 syncDock 自己写上去的跟随值 */
		const appliedTop = this.root.style.top;
		this.root.style.top = "";
		const rootTop = Number.parseFloat(getComputedStyle(this.root).top);
		this.root.style.top = appliedTop;
		this.railBaseTop = Number.isNaN(rootTop) ? 0 : rootTop;

		const scrollY = window.scrollY;
		const articleRect = this.article.getBoundingClientRect();
		this.articleStart = articleRect.top + scrollY;
		this.articleEnd = articleRect.bottom + scrollY;
		this.railHeight = this.root.offsetHeight;
		/* 相关文章浮层按自然高度向下溢出面板，页脚钳制要把它算进占位高度 */
		this.relatedHeight = this.relatedLayer?.scrollHeight ?? 0;
		this.headingTops = tree.nodes.map(
			(node) => node.element.getBoundingClientRect().top + scrollY,
		);
		/* 根圆点对应文章标题：指示器在根与首个标题之间也要走一段，量不到标题元素
		   就退到正文卡顶 */
		this.rootTop = tree.titleElement
			? tree.titleElement.getBoundingClientRect().top + scrollY
			: this.articleStart;
	}

	private getProgress(): number {
		const end = this.articleEnd - window.innerHeight + READING_OFFSET;
		if (end <= this.articleStart) {
			return window.scrollY + READING_OFFSET >= this.articleStart ? 1 : 0;
		}
		return clamp(
			(window.scrollY - this.articleStart) / (end - this.articleStart),
			0,
			1,
		);
	}

	/* 顶部跟随：页面在顶时面板顶与信息卡顶对齐；信息卡随页面上移越过停靠线
	   （CSS 的 8rem，即原本与标题对齐的位置）后，钳制在停靠线悬停跟随。
	   每帧实时取视口坐标，字体加载/折叠卡片导致的位移无需额外缓存。
	   fitTop 防止矮视口下初始位置把面板底边撑出屏幕。
	   底部钳制：面板底边触到页脚顶边后随文档滚走，不悬浮在页脚上。占位高度取
	   目录高与相关文章自然高的较大值——相关文章向下溢出不撑高面板，不预留就会
	   压到页脚上；顶边贴到视口上沿即止，不再向上移出屏幕。 */
	private syncDock(): void {
		if (!this.railHeight) return;

		let followTop = this.railBaseTop;
		const introTop = this.introAnchor?.getBoundingClientRect().top;
		if (introTop !== undefined) {
			const fitTop = window.innerHeight - this.railHeight - RAIL_BOTTOM_GAP;
			followTop = Math.min(Math.max(this.railBaseTop, introTop), fitTop);
		}

		if (this.footerEl) {
			const footerTop = this.footerEl.getBoundingClientRect().top;
			const clampHeight = Math.max(this.railHeight, this.relatedHeight);
			const maxTop = Math.max(0, footerTop - clampHeight - RAIL_BOTTOM_GAP);
			followTop = Math.min(followTop, maxTop);
		}

		if (followTop === this.appliedRailTop) return;

		this.appliedRailTop = followTop;
		this.root.style.top = `${followTop}px`;
	}

	/* 目录 → 相关文章转换评估（每帧随 update 调用）。
	   触发：许可协议卡（兜底：正文卡）底边上移到面板底边水平线 → 进入相关态；
	   退出：锚点底边回落越过面板底边 + 迟滞带 → 恢复目录态。
	   坐标全部实时读取。两层同框、面板高度不随模式变化，底边即固定触发线，
	   切换过程中它不动，因此不会因几何漂移而反向命中条件来回振荡。 */
	private evaluateMode(): void {
		if (!this.transitionEnabled) return;
		if (getComputedStyle(this.root).display === "none") return; // 窄屏面板不可见
		const anchorEl = this.licenseEl ?? this.fallbackAnchorEl;
		if (!anchorEl) return;

		const anchorBottom = anchorEl.getBoundingClientRect().bottom;
		const panelBottom = this.root.getBoundingClientRect().bottom;

		if (this.mode === "toc") {
			if (anchorBottom <= panelBottom) this.setMode("related");
		} else if (anchorBottom > panelBottom + MODE_HYSTERESIS) {
			this.setMode("toc");
		}

		if (!this.modeInitialized) {
			this.modeInitialized = true;
			// 首次定态不播过渡（滚动恢复/前进后退落在转换区时面板直接以正确模式出现）
			this.root.classList.add("is-mode-no-anim");
			requestAnimationFrame(() =>
				this.root.classList.remove("is-mode-no-anim"),
			);
		}
	}

	private setMode(mode: "toc" | "related"): void {
		if (mode === this.mode) return;
		this.mode = mode;
		/* 交错入场只在真正的切换里播：首次定态（滚动恢复/前进后退落在转换区）时
		   modeInitialized 还是 false，面板直接以正确模式静默出现 */
		if (this.modeInitialized) this.root.classList.add("is-mode-armed");
		// 只翻类：两层同框、面板高度不随模式变化，淡入淡出与落位全由 CSS 时长控制
		this.root.classList.toggle("is-related-mode", mode === "related");
	}

	/** 按文档序给两层各自的可动元素写 --toc-stagger，供 CSS 逐项落位算延迟 */
	private applyStagger(): void {
		const assign = (targets: NodeListOf<HTMLElement>): void => {
			targets.forEach((el, order) => {
				el.style.setProperty("--toc-stagger", String(order));
			});
		};
		assign(
			this.root.querySelectorAll<HTMLElement>(
				".article-toc-panel__toolbar, .article-toc-panel__row",
			),
		);
		if (this.relatedLayer) {
			assign(
				this.relatedLayer.querySelectorAll<HTMLElement>(
					".related-cards__title, .related-cards__item",
				),
			);
		}
	}

	private getActiveIndex(): number {
		const tree = this.tree;
		if (!tree || this.headingTops.length === 0) return -1;
		const readingPosition = window.scrollY + READING_OFFSET;
		let lower = 0;
		let upper = this.headingTops.length - 1;
		let result = 0;
		while (lower <= upper) {
			const middle = Math.floor((lower + upper) / 2);
			if (this.headingTops[middle] <= readingPosition) {
				result = middle;
				lower = middle + 1;
			} else {
				upper = middle - 1;
			}
		}
		return result;
	}

	private scheduleUpdate(): void {
		if (this.animationFrame !== null) return;
		this.animationFrame = requestAnimationFrame(() => {
			this.animationFrame = null;
			this.update();
		});
	}

	private scheduleMeasure(): void {
		if (this.measureFrame !== null) return;
		this.measureFrame = requestAnimationFrame(() => {
			this.measureFrame = null;
			if (!this.tree) return;
			this.cachePositions();
			this.scheduleTrack();
			this.activeIndex = -1;
			this.update();
		});
	}

	private update(): void {
		if (!this.tree) return;

		this.syncDock();
		this.evaluateMode();
		this.syncFlightWithScroll();

		const progressPercent = Math.round(this.getProgress() * 100);
		if (progressPercent !== this.lastProgressPercent) {
			this.lastProgressPercent = progressPercent;
			this.progressRegion?.setAttribute(
				"aria-valuenow",
				String(progressPercent),
			);
			if (this.progressLabel)
				this.progressLabel.textContent = `${progressPercent}%`;
		}

		const nextActiveIndex = this.getActiveIndex();
		if (nextActiveIndex !== this.activeIndex) {
			this.activeIndex = nextActiveIndex;
			this.syncActive();
		}
		/* 指示器要连续跟随锚点插值，不能只在活动行变化时才动；applyPlane 无条件跑——
		   syncDock 刚挪过面板顶边，树也可能被读者自己滚过 */
		this.aim(this.readingLength());
		this.applyPlane();
	}

	private syncActive(): void {
		const tree = this.tree;
		if (!tree) return;

		this.rows.forEach((ref, index) => {
			const isActive = index === this.activeIndex;
			ref.row.classList.toggle("is-active", isActive);
			if (isActive) ref.link.setAttribute("aria-current", "location");
			else ref.link.removeAttribute("aria-current");
		});

		this.rebuildActiveChain();
		if (this.applyAutoAccordion()) this.startTrackAnimation();
		this.syncToggleAllButton();

		this.scheduleTrack();
		this.scheduleActiveRowScroll();
	}

	private scheduleActiveRowScroll(): void {
		if (this.activeScrollTimer) clearTimeout(this.activeScrollTimer);
		this.activeScrollTimer = setTimeout(() => {
			this.activeScrollTimer = null;
			const nav = this.treeNav;
			const ref = this.rows[this.activeIndex];
			if (!nav || !ref) return;
			const navRect = nav.getBoundingClientRect();
			const rowRect = ref.row.getBoundingClientRect();
			const isVisible =
				rowRect.top >= navRect.top && rowRect.bottom <= navRect.bottom;
			if (isVisible) return;
			const targetScroll =
				ref.row.offsetTop - nav.clientHeight / 2 + ref.row.clientHeight / 2;
			nav.scrollTo({
				top: Math.max(0, targetScroll),
				behavior: prefersReducedMotion() ? "auto" : "smooth",
			});
		}, ACTIVE_SCROLL_THROTTLE);
	}

	/* ---------- 导航 ---------- */

	private navigateTo(index: number): void {
		const tree = this.tree;
		if (!tree) return;

		/* 点击跳转把飞着的指示器收回轨上（参照实现的 select 语义）。它那套 pin——点住
		   之后定在目标上直到读者再滚——没有跟过来：本项目活动态本来就由 getActiveIndex
		   的二分决定，多一套状态反而和它打架 */
		this.land();
		window.tocInternalNavigation = true;
		let targetTop: number;
		let hashId: string | null = null;
		if (index < 0) {
			targetTop = tree.titleElement
				? tree.titleElement.getBoundingClientRect().top +
					window.scrollY -
					READING_OFFSET
				: 0;
		} else {
			const node = tree.nodes[index];
			targetTop = this.headingTops[index] - READING_OFFSET;
			hashId = node.id;
		}

		if (hashId) {
			const destination = new URL(window.location.href);
			destination.hash = hashId;
			window.history.pushState(null, "", destination);
		}
		window.scrollTo({
			top: Math.max(0, targetTop),
			behavior: prefersReducedMotion() ? "auto" : "smooth",
		});
	}

	/* ---------- 思维导图弹窗 ---------- */

	private openMindmap(): void {
		const tree = this.tree;
		const dialog = this.mindmapDialog;
		if (!tree || !dialog || !this.mindmapTree) return;

		/* 每次打开回到 1:1，缩放只在当次浏览里持续 */
		this.mindmapZoom = 1;
		this.applyMindmapZoom();
		this.panState = null;
		this.mindmapPanDragged = false;
		this.renderMindmap();
		dialog.showModal();
		requestAnimationFrame(() => this.drawMindmapLines());
	}

	/**
	 * 嵌套递归布局（markmap 同款观感）：父节点所在行与其子树子列垂直居中对齐，
	 * 组内小间距、组间大间距——间距全部用 em 表达，缩放只改树容器 font-size。
	 */
	private renderMindmap(): void {
		const tree = this.tree;
		if (!tree || !this.mindmapTree) return;

		this.mindmapNodePills = [];
		this.mindmapRootPill = null;
		this.mindmapPaths = [];

		const treeEl = document.createElement("div");
		treeEl.className = "article-toc-mindmap__tree";

		const rootPill = this.buildMindmapPill(-1, tree.title, true);
		treeEl.appendChild(rootPill);
		this.mindmapRootPill = rootPill;

		const roots = tree.nodes.filter((node) => node.parent < 0);
		if (roots.length > 0) {
			const children = document.createElement("div");
			children.className = "article-toc-mindmap__children";
			roots.forEach((node) => {
				this.buildMindmapBranch(node, children);
			});
			treeEl.appendChild(children);
		}

		if (this.mindmapLinesSvg) {
			this.mindmapTree.replaceChildren(this.mindmapLinesSvg, treeEl);
		} else {
			this.mindmapTree.replaceChildren(treeEl);
		}
	}

	/** 一棵子树 = 「节点胶囊 + 子级竖列」的水平组合 */
	private buildMindmapBranch(node: TocNode, parent: HTMLElement): void {
		const branch = document.createElement("div");
		branch.className = "article-toc-mindmap__branch";
		branch.appendChild(this.buildMindmapPill(node.index, node.text, false));

		if (node.children.length > 0) {
			const children = document.createElement("div");
			children.className = "article-toc-mindmap__children";
			node.children.forEach((childIndex) => {
				const child = this.tree?.nodes[childIndex];
				if (child) this.buildMindmapBranch(child, children);
			});
			branch.appendChild(children);
		}
		parent.appendChild(branch);
	}

	private buildMindmapPill(
		index: number,
		text: string,
		isRoot: boolean,
	): HTMLButtonElement {
		const pill = document.createElement("button");
		pill.type = "button";
		pill.className = isRoot
			? "article-toc-mindmap__node article-toc-mindmap__node--root"
			: "article-toc-mindmap__node";
		if (index >= 0) pill.dataset.tocMindmapIndex = String(index);
		pill.title = text;
		const dot = document.createElement("span");
		if (!isRoot) dot.className = "article-toc-mindmap__node-dot";
		const textEl = document.createElement("span");
		textEl.className = "article-toc-mindmap__node-text";
		textEl.textContent = text;
		pill.append(dot, textEl);
		if (index >= 0) this.mindmapNodePills[index] = pill;
		return pill;
	}

	/** 缩放改树容器 font-size：em 体系整体缩放，布局尺寸随之变化，滚动区自然正确 */
	private applyMindmapZoom(): void {
		this.mindmapTree?.style.setProperty(
			"--mindmap-zoom",
			String(this.mindmapZoom),
		);
	}

	private setMindmapZoom(zoom: number): void {
		this.mindmapZoom = clamp(zoom, MINDMAP_ZOOM_MIN, MINDMAP_ZOOM_MAX);
		this.applyMindmapZoom();
		this.drawMindmapLines();
	}

	/** 画布式缩放：以光标为锚点，缩放前后光标下的内容点保持不动 */
	private zoomMindmapAt(
		factor: number,
		clientX: number,
		clientY: number,
	): void {
		const canvas = this.mindmapCanvas;
		if (!canvas) return;

		const oldZoom = this.mindmapZoom;
		const newZoom = clamp(oldZoom * factor, MINDMAP_ZOOM_MIN, MINDMAP_ZOOM_MAX);
		if (newZoom === oldZoom) return;

		const rect = canvas.getBoundingClientRect();
		const contentX = clientX - rect.left + canvas.scrollLeft;
		const contentY = clientY - rect.top + canvas.scrollTop;

		this.mindmapZoom = newZoom;
		this.applyMindmapZoom();

		/* em 体系下布局尺寸随 font-size 等比缩放，内容点坐标同比例放大 */
		const ratio = newZoom / oldZoom;
		canvas.scrollLeft = contentX * ratio - (clientX - rect.left);
		canvas.scrollTop = contentY * ratio - (clientY - rect.top);
		this.drawMindmapLines();
	}

	private toggleMindmapFullscreen(): void {
		const panel = this.mindmapDialog?.querySelector<HTMLElement>(
			".article-toc-mindmap__panel",
		);
		if (!panel) return;
		if (document.fullscreenElement) {
			void document.exitFullscreen();
		} else {
			void panel.requestFullscreen();
		}
	}

	private drawMindmapLines(): void {
		const tree = this.tree;
		const svg = this.mindmapLinesSvg;
		const canvas = this.mindmapCanvas;
		if (!tree || !svg || !canvas) return;

		/* 同 drawTrack：先归零排除自身（与旧 path）对滚动尺寸的污染 */
		svg.setAttribute("width", "0");
		svg.setAttribute("height", "0");
		svg.replaceChildren();
		this.mindmapPaths = [];
		svg.setAttribute("width", String(canvas.scrollWidth));
		svg.setAttribute("height", String(canvas.scrollHeight));

		const canvasRect = canvas.getBoundingClientRect();
		const pillCenter = (pill: HTMLElement | null) => {
			if (!pill) return null;
			const rect = pill.getBoundingClientRect();
			if (rect.width === 0 && rect.height === 0) return null;
			return {
				left: rect.left - canvasRect.left + canvas.scrollLeft,
				right: rect.right - canvasRect.left + canvas.scrollLeft,
				y: rect.top - canvasRect.top + canvas.scrollTop + rect.height / 2,
			};
		};

		const rootBox = pillCenter(this.mindmapRootPill);
		tree.nodes.forEach((node) => {
			const start =
				node.parent >= 0
					? pillCenter(this.mindmapNodePills[node.parent] ?? null)
					: rootBox;
			const end = pillCenter(this.mindmapNodePills[node.index] ?? null);
			if (!start || !end) return;

			const path = document.createElementNS(SVG_NAMESPACE, "path");
			path.classList.add("article-toc-mindmap__line");
			/* markmap 同款共享主干：水平出父节点 → 中点处垂直转弯 → 水平入子节点，
			   各兄弟路径的公共段重叠，视觉上是一根主干分出多条分支 */
			const branchX = (start.right + end.left) / 2;
			const corner = Math.min(
				LINE_CORNER_RADIUS,
				Math.abs(end.y - start.y) / 2,
				Math.max(0, end.left - branchX),
			);
			const turn =
				corner < 0.5
					? [`M ${start.right} ${start.y}`, `H ${end.left}`]
					: end.y > start.y
						? [
								`M ${start.right} ${start.y}`,
								`H ${branchX - corner}`,
								`Q ${branchX} ${start.y} ${branchX} ${start.y + corner}`,
								`V ${end.y - corner}`,
								`Q ${branchX} ${end.y} ${branchX + corner} ${end.y}`,
								`H ${end.left}`,
							]
						: [
								`M ${start.right} ${start.y}`,
								`H ${branchX - corner}`,
								`Q ${branchX} ${start.y} ${branchX} ${start.y - corner}`,
								`V ${end.y + corner}`,
								`Q ${branchX} ${end.y} ${branchX + corner} ${end.y}`,
								`H ${end.left}`,
							];
			path.setAttribute("d", turn.join(" "));
			svg.appendChild(path);
			this.mindmapPaths[node.index] = path;
		});
	}

	/** 导图悬停高亮：根到悬停节点整条链的连线、节点边框与文字（Obsidian 路径语义） */
	private setMindmapTrail(index: number): void {
		this.clearMindmapTrail();
		const tree = this.tree;
		if (!tree || index < 0) return;

		let cursor = index;
		while (cursor >= 0) {
			this.mindmapNodePills[cursor]?.classList.add("is-trail");
			this.mindmapPaths[cursor]?.classList.add("is-active");
			cursor = tree.nodes[cursor].parent;
		}
	}

	private clearMindmapTrail(): void {
		this.mindmapNodePills.forEach((pill) => {
			pill?.classList.remove("is-trail");
		});
		this.mindmapPaths.forEach((path) => {
			path?.classList.remove("is-active");
		});
	}

	/* ---------- 事件绑定 ---------- */

	private bindInteractions(): void {
		const { signal } = this.abortController;

		this.autoButton?.addEventListener(
			"click",
			() => this.setAutoEnabled(!this.autoEnabled),
			{ signal },
		);
		this.toggleAllButton?.addEventListener("click", () => this.toggleAll(), {
			signal,
		});
		this.mindmapButton?.addEventListener("click", () => this.openMindmap(), {
			signal,
		});
		this.mindmapZoomOutButton?.addEventListener(
			"click",
			() => this.setMindmapZoom(this.mindmapZoom - MINDMAP_ZOOM_STEP),
			{ signal },
		);
		this.mindmapZoomInButton?.addEventListener(
			"click",
			() => this.setMindmapZoom(this.mindmapZoom + MINDMAP_ZOOM_STEP),
			{ signal },
		);
		this.mindmapResetButton?.addEventListener(
			"click",
			() => this.setMindmapZoom(1),
			{ signal },
		);
		this.mindmapFullscreenButton?.addEventListener(
			"click",
			() => this.toggleMindmapFullscreen(),
			{ signal },
		);

		this.treeNav?.addEventListener(
			"click",
			(event) => {
				const target = event.target as HTMLElement | null;
				const toggle = target?.closest<HTMLElement>("[data-toc-toggle]");
				if (toggle) {
					event.preventDefault();
					this.toggleCollapse(Number(toggle.dataset.tocToggle));
					return;
				}
				const link = target?.closest<HTMLElement>("[data-toc-navigate]");
				if (link) {
					event.preventDefault();
					const index = Number(link.dataset.tocNavigate);
					this.navigateTo(index);
					this.expandNode(index);
				}
			},
			{ signal },
		);

		/* 指示器挂在外层按视口定位，树内部滚动只挪 nav.scrollTop：竖轨跟着内容走，
		   指示器却要重算一次视口位置 */
		this.treeNav?.addEventListener("scroll", () => this.applyPlane(), {
			passive: true,
			signal,
		});

		/* 起飞只由用户主动滚动触发：监听挂在 window 上且一律 passive，不拦默认行为。
		   鼠标停在面板上、由树自己消化滚动时 wheel 仍会冒泡到这里 */
		window.addEventListener(
			"wheel",
			(event) => {
				this.spillBy(
					event.deltaMode === 1
						? event.deltaY * WHEEL_LINE_PIXELS
						: event.deltaY,
				);
			},
			{ passive: true, signal },
		);
		window.addEventListener(
			"touchstart",
			(event) => {
				this.touchY = event.touches[0]?.clientY ?? 0;
			},
			{ passive: true, signal },
		);
		window.addEventListener(
			"touchmove",
			(event) => {
				const next = event.touches[0]?.clientY ?? this.touchY;
				this.spillBy(this.touchY - next);
				this.touchY = next;
			},
			{ passive: true, signal },
		);

		this.mindmapCanvas?.addEventListener(
			"wheel",
			(event) => {
				event.preventDefault();
				const factor =
					event.deltaY < 0 ? MINDMAP_WHEEL_FACTOR : 1 / MINDMAP_WHEEL_FACTOR;
				this.zoomMindmapAt(factor, event.clientX, event.clientY);
			},
			{ passive: false, signal },
		);

		/* 画布拖拽平移：按下先只记录起点（不接管指针，保证胶囊正常点击），
		   移动超过阈值才 setPointerCapture 进入平移，随后到来的 click 被吞掉 */
		const canvas = this.mindmapCanvas;
		if (canvas) {
			canvas.addEventListener(
				"pointerdown",
				(event) => {
					if (event.button !== 0) return;
					this.panState = {
						pointerId: event.pointerId,
						startX: event.clientX,
						startY: event.clientY,
						scrollLeft: canvas.scrollLeft,
						scrollTop: canvas.scrollTop,
					};
					this.mindmapPanDragged = false;
				},
				{ signal },
			);
			canvas.addEventListener(
				"pointermove",
				(event) => {
					const state = this.panState;
					if (!state || event.pointerId !== state.pointerId) return;
					const dx = event.clientX - state.startX;
					const dy = event.clientY - state.startY;
					if (!this.mindmapPanDragged) {
						if (Math.hypot(dx, dy) <= MINDMAP_PAN_THRESHOLD) return;
						this.mindmapPanDragged = true;
						canvas.setPointerCapture(event.pointerId);
						canvas.classList.add("is-panning");
					}
					canvas.scrollLeft = state.scrollLeft - dx;
					canvas.scrollTop = state.scrollTop - dy;
				},
				{ signal },
			);
			const endPan = (event: PointerEvent) => {
				if (!this.panState || event.pointerId !== this.panState.pointerId) {
					return;
				}
				this.panState = null;
				canvas.classList.remove("is-panning");
			};
			canvas.addEventListener("pointerup", endPan, { signal });
			canvas.addEventListener("pointercancel", endPan, { signal });
		}

		this.mindmapDialog?.addEventListener(
			"click",
			(event) => {
				if (this.mindmapPanDragged) {
					this.mindmapPanDragged = false;
					return;
				}
				const target = event.target as HTMLElement | null;
				if (target?.closest("[data-toc-mindmap-close]")) {
					this.mindmapDialog?.close();
					return;
				}
				const pill = target?.closest<HTMLElement>("[data-toc-mindmap-index]");
				if (pill) {
					this.navigateTo(Number(pill.dataset.tocMindmapIndex));
					this.mindmapDialog?.close();
				}
			},
			{ signal },
		);

		this.mindmapCanvas?.addEventListener(
			"mouseover",
			(event) => {
				const pill = (event.target as HTMLElement | null)?.closest<HTMLElement>(
					"[data-toc-mindmap-index]",
				);
				if (!pill) return;
				this.setMindmapTrail(Number(pill.dataset.tocMindmapIndex));
			},
			{ signal },
		);
		this.mindmapCanvas?.addEventListener(
			"mouseleave",
			() => this.clearMindmapTrail(),
			{ signal },
		);
	}
}

export class ArticleTocPanelRuntime {
	private readonly abortController = new AbortController();
	private controller: ArticleTocPanelController | null = null;

	public start(): void {
		// 首次加载 + 每次导航各挂一次，容器替换前拆掉：时序统一交给 swup-lifecycle
		definePageIsland({
			name: "article-toc-panel",
			mount: () => this.initialize(),
			unmount: () => this.destroyCurrent(),
		});
		// 加密文章解密后正文标题才出现，需要补建一次（initialize 自带幂等）
		document.addEventListener("password:decrypted", () => this.initialize(), {
			signal: this.abortController.signal,
		});
	}

	public destroy(): void {
		this.abortController.abort();
		this.destroyCurrent();
	}

	private initialize(): void {
		this.destroyCurrent();
		const root = document.getElementById("article-toc-panel");
		if (!root) return;

		const controller = new ArticleTocPanelController(root);
		if (controller.init()) this.controller = controller;
	}

	private destroyCurrent(): void {
		this.controller?.destroy();
		this.controller = null;
	}
}
