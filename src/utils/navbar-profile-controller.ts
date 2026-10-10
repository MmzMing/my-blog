/**
 * 顶部导航 Logo 资料卡面板控制器（常驻组件作用域）。
 *
 * 面板替代旧的 logo 悬停下拉与悬浮坞日历。桌面端 hover/focus 展开（is-open
 * 类驱动，不再用纯 CSS :has 悬停——JS 需要在展开时机上同步懒加载数据），
 * 移动端点击 logo 或 MobileDock 站名按钮（NAVBAR_PROFILE_TOGGLE_EVENT）
 * 弹出底部半屏卡片（遮罩 + 下滑关闭 + 滚动锁定）。
 *
 * 面板 DOM 挂在 body 末尾（Layout.astro）：移动端 #navbar / #top-row 整体
 * display:none（mobile-dock.css），留在其中会被连带隐藏。桌面端打开时实测
 * 导航左段位置写入 fixed 锚点；锚点随滚动失效（左段收缩成球位移），与工具
 * 面板同一策略——滚动即收起。
 *
 * 卡片自上而下四层：横幅+头像堆叠 / 名字职业+社交 / 热力图内容区 / 底部站点
 * 面板。内容区自然高度、超出上限才页内滚动；打开面板时热力图按列逐格扫描入场，
 * 月份名在扫描收尾后去模糊显现。站点面板是贴在卡片底部的浮层：折叠态只占一条
 * 高度，展开时向上顶到卡片顶部盖住内容区，堆叠头像与列表头像按序号配对做 FLIP
 * 位移，视觉上就是同一枚图标从堆叠飞进列表。列表用 visibility 而非 hidden 收起
 * （见样式里的延迟切换），关闭动画期间仍占位被 overflow 裁掉，收尾才摘出可访问
 * 性树。面板关闭或 Swup 导航后回到折叠态并清空选中；数据缓存跨导航保留，仅首次
 * 展开时请求。
 */

import { onNavigation } from "@/utils/swup-lifecycle";

interface ProfileConfig {
	api: { posts: string };
	postBaseUrl: string;
	locale: string;
	labels: {
		/** 「{month}第{week}周」样式模板，month 为 Intl 月份名 */
		weekFormat: string;
		/** 「{count}篇」样式模板 */
		postCount: string;
	};
}

interface PostMeta {
	id: string;
	title: string;
	published: number;
}

interface ProfileRefs {
	panel: HTMLElement;
	card: HTMLElement;
	mask: HTMLElement | null;
	leftSeg: HTMLElement | null;
	heatmap: HTMLElement | null;
	cells: Map<string, HTMLButtonElement>;
	weekPosts: HTMLElement | null;
	postsTitle: HTMLElement | null;
	postList: HTMLElement | null;
	tooltip: HTMLElement | null;
	bannerImg: HTMLElement | null;
	/** 站点面板整块缺位（personalSites 为空）时为 null */
	sites: HTMLElement | null;
	sitesBar: HTMLElement | null;
	sitesStack: HTMLElement | null;
	sitesList: HTMLElement | null;
	sitesToggle: HTMLButtonElement | null;
}

/** 与样式断点（min-width: 1024px 走桌面布局）保持互补 */
const MOBILE_MEDIA = "(max-width: 1023.98px)";
/** 鼠标在 logo 与面板之间移动的过渡余量，避免误收起 */
const CLOSE_DELAY = 260;
/** 站点面板与卡片边缘的间距，需与样式里的 --profile-sites-inset 一致 */
const SITES_INSET = 12;
/** 面板高度与头像飞行共用时长 */
const SITES_DURATION = 360;
/** 与移动端底部卡片入场同一条曲线，两处动效节奏对齐 */
const SITES_EASING = "cubic-bezier(0.32, 0.72, 0.29, 1)";
/** 热力图逐列扫描：单格时长与列间隔，与参考实现的节奏一致 */
const CELL_FADE = 200;
const COLUMN_STAGGER = 12;
/** 月份名入场：等扫描收尾再去模糊 */
const LABEL_BLUR = 6;
const LABEL_REVEAL = 450;
const EASE_OUT = "cubic-bezier(0.22, 1, 0.36, 1)";
/** 触摸手势判定主轴所需的最低位移，越过即锁定本手势轴向 */
const SWIPE_AXIS_LOCK = 16;
/** 移动端竖向下滑关闭阈值 */
const SWIPE_CLOSE_DISTANCE = 64;

/** MobileDock 站名按钮等外部入口请求开合面板时派发的窗口事件名 */
export const NAVBAR_PROFILE_TOGGLE_EVENT = "navbar-profile:toggle";

let config: ProfileConfig | null = null;
let refs: ProfileRefs | null = null;
let initialized = false;

let dataPromise: Promise<void> | null = null;
let postsByCell = new Map<string, PostMeta[]>();

let selectedCellKey: string | null = null;
let sitesOpen = false;
let closeTimer: number | null = null;
let openedAsMobile = false;
let previousBodyOverflow = "";
/** 浮层篇数滚动的 rAF 句柄，浮层收起或改挂别处时取消 */
let tooltipFrames: number[] = [];

function cancelTooltipFrames(): void {
	for (const frame of tooltipFrames) cancelAnimationFrame(frame);
	tooltipFrames = [];
}

/** 篇数上滚时长：比面板入场的 520ms 短，悬停反馈要更跟手 */
const TOOLTIP_COUNT_DURATION = 420;

function isMobileViewport(): boolean {
	return window.matchMedia(MOBILE_MEDIA).matches;
}

function prefersReducedMotion(): boolean {
	return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function parseConfig(card: HTMLElement): ProfileConfig | null {
	const raw = card.dataset.profileConfig;
	if (!raw) return null;
	try {
		return JSON.parse(raw) as ProfileConfig;
	} catch {
		return null;
	}
}

function collectRefs(
	panel: HTMLElement,
	card: HTMLElement,
): ProfileRefs | null {
	const cells = new Map<string, HTMLButtonElement>();
	panel
		.querySelectorAll<HTMLButtonElement>("[data-profile-cell]")
		.forEach((cell) => {
			const key = cell.dataset.profileCell;
			if (key !== undefined) cells.set(key, cell);
		});
	const sites = card.querySelector<HTMLElement>("[data-profile-sites]");

	return {
		panel,
		card,
		mask: panel.querySelector("[data-profile-mask]"),
		// 面板挂在 body 末尾，左段改从文档级查找（hover/focus 触发源 + 桌面端锚点）
		leftSeg: document.querySelector("#navbar .navbar-seg--left"),
		heatmap: card.querySelector("[data-profile-heatmap]"),
		cells,
		weekPosts: card.querySelector("[data-profile-week]"),
		postsTitle: card.querySelector("[data-profile-posts-title]"),
		postList: card.querySelector("[data-profile-post-list]"),
		tooltip: card.querySelector("[data-profile-tooltip]"),
		bannerImg: card.querySelector("[data-profile-banner-img]"),
		sites,
		sitesBar: card.querySelector("[data-profile-sites-bar]"),
		sitesStack: card.querySelector("[data-profile-sites-stack]"),
		sitesList: card.querySelector("[data-profile-sites-list]"),
		sitesToggle: card.querySelector<HTMLButtonElement>(
			"[data-profile-sites-toggle]",
		),
	};
}

/* ── 数据加载 ── */

async function fetchData(): Promise<PostMeta[]> {
	if (!config) return [];
	const response = await fetch(config.api.posts, {
		headers: { Accept: "application/json" },
	});
	if (!response.ok) {
		throw new Error(
			`Profile card request failed: ${String(response.status)} ${response.statusText}`,
		);
	}
	const value: unknown = await response.json();
	if (!Array.isArray(value)) {
		throw new Error("Profile card posts payload is not an array");
	}
	return value as PostMeta[];
}

function ensureData(): void {
	if (!config || !refs || dataPromise) return;
	refs.card.setAttribute("aria-busy", "true");
	dataPromise = fetchData()
		.then((posts) => {
			postsByCell = buildPostsByCell(posts);
		})
		.catch(() => {
			// 文章接口不可用时热力图整块留空即可，卡片其余部分不依赖它，故不额外提示
			postsByCell = new Map();
		})
		.finally(() => {
			if (!refs) return;
			refs.card.setAttribute("aria-busy", "false");
			renderHeatmapCounts();
		});
}

/** 文章按「月-周」分桶（0 基）：月内 7 天切块 1-7 / 8-14 / 15-21 / 22-月末 */
function buildPostsByCell(posts: PostMeta[]): Map<string, PostMeta[]> {
	const year = new Date().getFullYear();
	const buckets = new Map<string, PostMeta[]>();
	for (const post of posts) {
		const published = Number(post.published);
		if (!Number.isFinite(published)) continue;
		const date = new Date(published);
		if (date.getFullYear() !== year) continue;
		const key = cellKeyOf(date.getMonth(), date.getDate());
		const bucket = buckets.get(key);
		if (bucket) bucket.push(post);
		else buckets.set(key, [post]);
	}
	for (const bucket of buckets.values()) {
		bucket.sort((a, b) => b.published - a.published);
	}
	return buckets;
}

function cellKeyOf(month: number, day: number): string {
	return `${month}-${Math.min(3, Math.floor((day - 1) / 7))}`;
}

function cellDateRangeOf(key: string): {
	month: number;
	start: number;
	end: number;
} {
	const [monthRaw, weekRaw] = key.split("-").map(Number);
	const start = weekRaw * 7 + 1;
	const lastDay = new Date(new Date().getFullYear(), monthRaw + 1, 0).getDate();
	return { month: monthRaw, start, end: weekRaw === 3 ? lastDay : start + 6 };
}

/** 「N月第M周」；月份名走 Intl，模板由 i18n 提供 */
function formatWeekLabel(key: string): string {
	if (!config) return "";
	const [monthRaw, weekRaw] = key.split("-").map(Number);
	const monthName = new Intl.DateTimeFormat(config.locale, {
		month: "short",
	}).format(new Date(2000, monthRaw, 1));
	return config.labels.weekFormat
		.replace("{month}", monthName)
		.replace("{week}", String(weekRaw + 1));
}

/* ── 渲染 ── */

function renderHeatmapCounts(): void {
	if (!refs || !config) return;
	for (const [key, cell] of refs.cells) {
		const count = postsByCell.get(key)?.length ?? 0;
		cell.classList.remove("is-level-1", "is-level-2", "is-level-3");
		if (count > 0) cell.classList.add(`is-level-${Math.min(3, count)}`);
		const label = formatWeekLabel(key);
		// 篇数单独挂 data，交给浮层现挂现滚；aria-label 仍是完整静态文案
		if (count > 0) cell.dataset.tooltipCount = String(count);
		else delete cell.dataset.tooltipCount;
		cell.setAttribute(
			"aria-label",
			count > 0
				? `${label} · ${config.labels.postCount.replace("{count}", String(count))}`
				: label,
		);
	}
}

/** 当周方块描边高亮（仅当年视图，无需等接口） */
function markCurrentWeekCell(): void {
	if (!refs) return;
	const now = new Date();
	const cell = refs.cells.get(cellKeyOf(now.getMonth(), now.getDate()));
	cell?.classList.add("is-current");
}

/* ── 热力图入场：按列逐格缩放淡入，收尾后月份名去模糊 ── */

function playHeatmapReveal(): void {
	if (!refs || prefersReducedMotion() || !refs.heatmap) return;
	const columns = Array.from(
		refs.heatmap.querySelectorAll<HTMLElement>(".profile-card__heat-col"),
	);
	columns.forEach((column, index) => {
		column
			.querySelectorAll<HTMLElement>(".profile-card__heat-cell")
			.forEach((cell) => {
				cell.animate(
					[
						{ opacity: 0, transform: "scale(0.4)" },
						{ opacity: 1, transform: "scale(1)" },
					],
					{
						duration: CELL_FADE,
						delay: index * COLUMN_STAGGER,
						easing: EASE_OUT,
						// 只在延迟期占住起始帧，结束后把 opacity 交还给 CSS（悬停淡出要用）
						fill: "backwards",
					},
				);
			});
	});
	const sweepEnd = (columns.length - 1) * COLUMN_STAGGER + CELL_FADE;
	columns.forEach((column) => {
		const label = column.querySelector<HTMLElement>(
			".profile-card__heat-month",
		);
		label?.animate(
			[
				{ opacity: 0, filter: `blur(${LABEL_BLUR}px)` },
				{ opacity: 1, filter: "blur(0px)" },
			],
			{
				duration: LABEL_REVEAL,
				delay: sweepEnd,
				easing: EASE_OUT,
				fill: "backwards",
			},
		);
	});
}

/* ── 站点面板开合 ── */

/** 折叠态只露出头部条，展开态顶到卡片上沿盖住内容区 */
function sitesTargetHeight(): number {
	if (!refs?.sites || !refs.sitesBar) return 0;
	return sitesOpen
		? Math.max(0, refs.card.clientHeight - SITES_INSET * 2)
		: refs.sitesBar.offsetHeight;
}

/** 把面板高度钉成具体像素：auto 与 calc 之间无法插值，过渡需要两端都是长度 */
function syncSitesHeight(): void {
	if (!refs?.sites) return;
	refs.sites.style.height = `${String(sitesTargetHeight())}px`;
}

function avatarRects(scope: HTMLElement | null): Map<string, DOMRect> {
	const rects = new Map<string, DOMRect>();
	scope
		?.querySelectorAll<HTMLElement>("[data-profile-avatar]")
		.forEach((avatar) => {
			const key = avatar.dataset.profileAvatar;
			if (key !== undefined) rects.set(key, avatar.getBoundingClientRect());
		});
	return rects;
}

/**
 * 头像飞行：按 data-profile-avatar 序号配对，把目标侧头像从源侧位置平移过来。
 * 两侧同尺寸同圆角，只差位移，故不需要 scale；序号对不上的（站点数超过堆叠
 * 上限）留在原地，视觉上等于列表多出的项淡入。
 */
function flipAvatars(
	scope: HTMLElement | null,
	from: Map<string, DOMRect>,
): void {
	if (!scope || prefersReducedMotion()) return;
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
				{ duration: SITES_DURATION, easing: SITES_EASING },
			);
		});
}

function setSitesOpen(next: boolean): void {
	if (!refs?.sites || next === sitesOpen) return;
	// 起点矩形必须在状态写入前读：展开态会 display:none 掉堆叠头像
	const from = avatarRects(next ? refs.sitesStack : refs.sitesList);
	sitesOpen = next;
	refs.sites.dataset.profileSitesOpen = String(next);
	refs.sitesToggle?.setAttribute("aria-expanded", String(next));
	hideTooltip();
	syncSitesHeight();
	flipAvatars(next ? refs.sitesList : refs.sitesStack, from);
}

function resetSites(): void {
	if (!refs?.sites || !sitesOpen) return;
	sitesOpen = false;
	refs.sites.dataset.profileSitesOpen = "false";
	refs.sitesToggle?.setAttribute("aria-expanded", "false");
	syncSitesHeight();
}

/* ── 热力图内联展开 ── */

function collapseWeek(): void {
	if (!refs) return;
	if (selectedCellKey) {
		const cell = refs.cells.get(selectedCellKey);
		cell?.classList.remove("is-selected");
		cell?.setAttribute("aria-pressed", "false");
	}
	selectedCellKey = null;
	refs.postList?.replaceChildren();
	if (refs.weekPosts) refs.weekPosts.hidden = true;
}

/** 点格：该周文章在同一页内联展开，不再换掉整块内容 */
function selectCell(key: string): void {
	if (!refs || !config) return;
	const posts = postsByCell.get(key);
	if (!posts || posts.length === 0) return;

	selectedCellKey = key;
	const cell = refs.cells.get(key);
	cell?.classList.add("is-selected");
	cell?.setAttribute("aria-pressed", "true");

	if (refs.postsTitle) {
		const { month, start, end } = cellDateRangeOf(key);
		const pad = (value: number): string => String(value).padStart(2, "0");
		const count = config.labels.postCount.replace(
			"{count}",
			String(posts.length),
		);
		refs.postsTitle.textContent = `${formatWeekLabel(key)} · ${pad(month + 1)}.${pad(start)} – ${pad(month + 1)}.${pad(end)} · ${count}`;
	}
	if (refs.postList) {
		refs.postList.replaceChildren();
		for (const post of posts) {
			const link = document.createElement("a");
			link.className = "profile-card__post-link";
			link.href = `${config.postBaseUrl}${String(post.id).replace(/^\/+|\/+$/g, "")}/`;
			link.textContent = post.title;
			refs.postList.appendChild(link);
		}
	}
	if (refs.weekPosts) refs.weekPosts.hidden = false;
}

/* ── 热力图提示浮层 ── */

/**
 * 浮层与内容区同级、不在滚动容器内，因此不受页内 overflow 裁剪。
 * 坐标取源元素与卡片的 rect 差值：两个 rect 同处一个 transform 空间，
 * 差值天然抵消祖先的 translateY，比 position: fixed 稳。
 *
 * 源元素靠 data-tooltip-label 认领（热力图方块与社交图标共用一套），
 * 带 data-tooltip-count 时把篇数交给里程表式数字条上滚到终值。
 */
function showTooltip(source: HTMLElement): void {
	if (!refs?.tooltip || !config) return;
	const label = source.dataset.tooltipLabel;
	if (!label) return;
	const target = Number(source.dataset.tooltipCount ?? 0);
	const { tooltip } = refs;
	cancelTooltipFrames();
	tooltip.replaceChildren(
		document.createTextNode(target > 0 ? `${label} · ` : label),
	);
	if (target > 0) {
		const [before, after = ""] = config.labels.postCount.split("{count}");
		const roll = buildCountRoll(target);
		tooltip.append(document.createTextNode(before), roll, after);
		animateCountRoll(roll, target);
	}
	const sourceRect = source.getBoundingClientRect();
	const cardRect = refs.card.getBoundingClientRect();
	tooltip.style.left = `${sourceRect.left - cardRect.left + sourceRect.width / 2}px`;
	tooltip.style.top = `${sourceRect.top - cardRect.top}px`;
	tooltip.classList.add("is-visible");
}

/** 取事件目标所属的浮层源元素；不在任何源内则返回 null */
function tooltipSourceFrom(target: EventTarget | null): HTMLElement | null {
	return target instanceof Element
		? target.closest<HTMLElement>("[data-tooltip-label]")
		: null;
}

function hideTooltip(): void {
	cancelTooltipFrames();
	refs?.tooltip?.classList.remove("is-visible");
}

/** 造一条 0..target 的竖排数字条，套在一行高的窗口里当里程表 */
function buildCountRoll(target: number): HTMLElement {
	const roll = document.createElement("span");
	roll.className = "profile-card__tooltip-roll";
	const strip = document.createElement("span");
	strip.className = "profile-card__tooltip-roll-strip";
	for (let value = 0; value <= target; value += 1) {
		const cell = document.createElement("span");
		cell.textContent = String(value);
		strip.append(cell);
	}
	roll.append(strip);
	return roll;
}

/**
 * 数字条整体上滚到终值。窗口宽度由最宽的一格（终值本身）撑开，
 * 所以滚动过程不会左右抖；每格高度实测，不依赖 CSS 里的行高常量。
 */
function animateCountRoll(roll: HTMLElement, target: number): void {
	const strip = roll.firstElementChild;
	if (!(strip instanceof HTMLElement)) return;
	const cellHeight =
		strip.firstElementChild?.getBoundingClientRect().height ?? 0;
	const shift = (value: number): void => {
		strip.style.transform = `translate3d(0, ${String(-value * cellHeight)}px, 0)`;
	};
	if (cellHeight <= 0 || prefersReducedMotion()) {
		shift(target);
		return;
	}
	const start = performance.now();
	shift(0);
	const tick = (now: number): void => {
		const progress = Math.min(1, (now - start) / TOOLTIP_COUNT_DURATION);
		const eased = 1 - (1 - progress) ** 3;
		shift(target * eased);
		if (progress < 1) tooltipFrames.push(requestAnimationFrame(tick));
		else shift(target);
	};
	tooltipFrames.push(requestAnimationFrame(tick));
}

/* ── 开合控制 ── */

function cancelScheduledClose(): void {
	if (closeTimer !== null) {
		window.clearTimeout(closeTimer);
		closeTimer = null;
	}
}

function scheduleClose(): void {
	if (closeTimer !== null) return;
	closeTimer = window.setTimeout(() => {
		closeTimer = null;
		closePanel();
	}, CLOSE_DELAY);
}

/**
 * 桌面端把面板锚定到导航左段下缘。面板是 body 级 fixed 元素，
 * left/top 内联写入；移动端是全屏卡片，不使用该锚点
 */
function positionPanel(): void {
	if (!refs?.leftSeg) return;
	const rect = refs.leftSeg.getBoundingClientRect();
	refs.panel.style.left = `${rect.left}px`;
	refs.panel.style.top = `${rect.bottom}px`;
}

function openPanel(): void {
	if (!refs) return;
	cancelScheduledClose();
	if (refs.panel.classList.contains("is-open")) return;
	const mobile = isMobileViewport();
	// 无导航栏的页面桌面端无从锚定，放弃打开（移动端是全屏卡片，不受影响）
	if (!mobile && !refs.leftSeg) return;
	ensureData();
	openedAsMobile = mobile;
	if (mobile) {
		// 清掉桌面端可能写入的内联锚点，避免覆盖移动端 inset:0
		refs.panel.style.removeProperty("left");
		refs.panel.style.removeProperty("top");
	} else {
		positionPanel();
	}
	refs.panel.classList.add("is-open");
	if (openedAsMobile) {
		previousBodyOverflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";
	}
	// 卡片此刻已从 display:none 切过来，头像与条高只有现在才量得准
	syncSitesHeight();
	playHeatmapReveal();
}

function closePanel(): void {
	if (!refs) return;
	cancelScheduledClose();
	if (!refs.panel.classList.contains("is-open")) return;
	refs.panel.classList.remove("is-open");
	// 面板在 Swup 容器之外、DOM 跨导航复用，这里是唯一的状态归位点
	collapseWeek();
	hideTooltip();
	resetSites();
	if (openedAsMobile) document.body.style.overflow = previousBodyOverflow;
	openedAsMobile = false;
}

function togglePanel(): void {
	if (refs?.panel.classList.contains("is-open")) closePanel();
	else openPanel();
}

/** Escape 收起后把焦点还给 logo，保持键盘路径可用 */
function focusLogo(): void {
	refs?.leftSeg?.querySelector<HTMLElement>(".navbar-logo")?.focus();
}

/* ── 事件绑定 ── */

function bindEvents(): void {
	if (!refs) return;
	const { panel, card, mask, leftSeg, heatmap, sitesToggle } = refs;

	// 移动端：点击 logo 开合面板。必须阻断冒泡——Swup 的文档级点击委托会把
	// logo 当内部链接拦截导航，preventDefault 挡不住它；桌面端保持回主页
	leftSeg?.addEventListener("click", (event) => {
		const target = event.target as HTMLElement;
		if (!target.closest(".navbar-logo")) return;
		if (!isMobileViewport()) return;
		event.preventDefault();
		event.stopPropagation();
		togglePanel();
	});

	// 桌面：hover / focus 展开与延迟收起
	leftSeg?.addEventListener("mouseenter", () => {
		if (!isMobileViewport()) openPanel();
	});
	leftSeg?.addEventListener("mouseleave", () => {
		if (!isMobileViewport()) scheduleClose();
	});
	leftSeg?.addEventListener("focusin", openPanel);
	leftSeg?.addEventListener("focusout", (event) => {
		const next = event.relatedTarget;
		if (next instanceof Node && (card.contains(next) || leftSeg.contains(next)))
			return;
		scheduleClose();
	});

	panel.addEventListener("mouseenter", cancelScheduledClose);
	panel.addEventListener("mouseleave", () => {
		if (!isMobileViewport()) scheduleClose();
	});
	panel.addEventListener("focusout", (event) => {
		// 移动端底部卡片不随焦点移出收起：触屏点链接不会把焦点挪过去，
		// 面板内元素失焦回 body 时 relatedTarget 为空，会被误判成焦点离开
		// 面板，点站点链接就等于把卡片关了
		if (openedAsMobile) return;
		const next = event.relatedTarget;
		if (
			next instanceof Node &&
			(card.contains(next) || (leftSeg?.contains(next) ?? false))
		) {
			return;
		}
		scheduleClose();
	});

	mask?.addEventListener("click", closePanel);

	// MobileDock 站名按钮等外部入口：仅移动端响应（dock 只在移动断点渲染）
	window.addEventListener(NAVBAR_PROFILE_TOGGLE_EVENT, () => {
		if (!isMobileViewport()) return;
		togglePanel();
	});

	// 桌面端锚点随滚动失效（左段收缩成球位移），与工具面板同一策略：滚动即收起
	window.addEventListener(
		"scroll",
		() => {
			if (!panel.classList.contains("is-open") || openedAsMobile) return;
			closePanel();
		},
		{ passive: true },
	);
	// 视口变化改变居中布局与卡片高度，面板开着时重锚定并按新高度重钉
	window.addEventListener(
		"resize",
		() => {
			if (!panel.classList.contains("is-open") || openedAsMobile) return;
			positionPanel();
			syncSitesHeight();
		},
		{ passive: true },
	);

	document.addEventListener("keydown", (event) => {
		if (event.key !== "Escape" || !panel.classList.contains("is-open")) return;
		event.preventDefault();
		const focusInCard =
			document.activeElement instanceof Node &&
			card.contains(document.activeElement);
		closePanel();
		if (focusInCard) focusLogo();
	});

	// 站点面板：折叠条上的按钮开合，展开后列出全部站点
	sitesToggle?.addEventListener("click", () => setSitesOpen(!sitesOpen));

	// 热力图：点格内联展开该周文章，再点已选中方块收起
	heatmap?.addEventListener("click", (event) => {
		const target = event.target as HTMLElement;
		const cell = target.closest<HTMLButtonElement>("[data-profile-cell]");
		const key = cell?.dataset.profileCell;
		if (!key) return;
		const same = key === selectedCellKey;
		collapseWeek();
		if (!same) selectCell(key);
	});

	// 提示浮层：热力图方块与社交图标共用一套，源元素靠 data-tooltip-label 认领
	card.addEventListener("mouseover", (event) => {
		const source = tooltipSourceFrom(event.target);
		if (source) showTooltip(source);
	});
	card.addEventListener("mouseout", (event) => {
		// 源内部换子节点（社交图标移到内层 svg）不算离开，否则浮层会闪一下
		if (tooltipSourceFrom(event.relatedTarget)) return;
		hideTooltip();
	});
	card.addEventListener("focusin", (event) => {
		const source = tooltipSourceFrom(event.target);
		if (source) showTooltip(source);
	});
	card.addEventListener("focusout", () => hideTooltip());
	// 页内滚动会让方块位移，浮层先收起避免悬在半空。
	// scroll 不冒泡，靠捕获阶段一个监听同时覆盖内容区与移动端整卡滚动
	card.addEventListener("scroll", hideTooltip, {
		capture: true,
		passive: true,
	});

	// 横幅图加载失败：撤掉上层，露出底下糊化的头像垫底层。
	// error 不冒泡，只能靠捕获阶段在包裹层上接住
	refs.bannerImg?.addEventListener(
		"error",
		() => {
			if (refs) refs.card.dataset.profileBannerState = "failed";
		},
		true,
	);

	// 站点图标加载失败：撤下 img，露出底下垫底的首字符。同样只在捕获阶段接
	card.addEventListener(
		"error",
		(event) => {
			const img = event.target as HTMLElement;
			if (img.dataset.profileSiteIcon !== undefined) {
				img.dataset.avatarFailed = "true";
			}
		},
		true,
	);

	// 移动端底部卡片：竖向下滑关闭。内容区自带滚动，故起点落在内容区或
	// 站点面板里时禁用竖向关闭，否则滚一下顺手就关卡片
	let touchStartX = 0;
	let touchStartY = 0;
	let touchAxis: "h" | "v" | null = null;
	let swipeCloseEnabled = false;
	card.addEventListener(
		"touchstart",
		(event) => {
			const touch = event.touches[0];
			if (!touch) return;
			touchStartX = touch.clientX;
			touchStartY = touch.clientY;
			touchAxis = null;
			swipeCloseEnabled = !(event.target as HTMLElement).closest(
				"[data-profile-content], [data-profile-sites]",
			);
		},
		{ passive: true },
	);
	card.addEventListener(
		"touchmove",
		(event) => {
			if (!openedAsMobile) return;
			const touch = event.touches[0];
			if (!touch) return;
			const deltaX = touch.clientX - touchStartX;
			const deltaY = touch.clientY - touchStartY;
			if (touchAxis === null) {
				if (
					Math.abs(deltaX) < SWIPE_AXIS_LOCK &&
					Math.abs(deltaY) < SWIPE_AXIS_LOCK
				) {
					return;
				}
				touchAxis = Math.abs(deltaX) > Math.abs(deltaY) ? "h" : "v";
			}
			if (touchAxis === "h") return;
			if (swipeCloseEnabled && deltaY > SWIPE_CLOSE_DISTANCE) closePanel();
		},
		{ passive: true },
	);
	card.addEventListener(
		"touchend",
		() => {
			touchAxis = null;
		},
		{ passive: true },
	);

	// 面板在 Swup 容器之外，导航后强制收起并复位状态
	onNavigation(() => closePanel());
	window.addEventListener("pageshow", () => closePanel());
}

/**
 * 常驻初始化入口：NavbarProfileCard.astro 经 definePersistentIsland 调用，
 * 整个文档生命周期只执行一次。
 */
export function initNavbarProfileCard(): void {
	if (initialized) return;
	initialized = true;
	const panel = document.querySelector<HTMLElement>(
		"[data-navbar-profile-panel]",
	);
	const card = panel?.querySelector<HTMLElement>("[data-profile-card]");
	if (!panel || !card) return;
	const parsedConfig = parseConfig(card);
	if (!parsedConfig) return;
	config = parsedConfig;
	refs = collectRefs(panel, card);
	if (!refs) return;
	markCurrentWeekCell();
	// 折叠高度先钉成像素值：面板靠 height 过渡开合，起点不能是 auto
	syncSitesHeight();
	bindEvents();
}
