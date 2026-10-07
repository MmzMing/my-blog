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
 * 卡片自上而下四层：横幅+头像堆叠 / 名字职业+社交 / 内容区 / 分段标签 dock。
 * 内容区三页（heatmap / dates / sites）互斥且高度跟随当前页，切换带方向感知：
 * 标签索引增大时新页从右侧滑入、旧页向左滑出，反向对称。热力图点格在同一页
 * 内联展开该周文章；日期页的入场动效（数字滚动 + 进度条重充）改由「日期页
 * 可见」触发，不再挂在面板展开上。面板关闭或 Swup 导航后回到默认页并清空
 * 选中态；数据缓存跨导航保留，仅首次展开时请求。
 */

import {
	formatYmd,
	getHolidayOccurrences,
	type Milestone,
	milestoneFromOccurrences,
} from "@/utils/calendar-milestones";
import { onNavigation } from "@/utils/swup-lifecycle";

interface ProfileConfig {
	api: { holidays: string; posts: string };
	postBaseUrl: string;
	locale: string;
	anniversary: {
		name: string;
		/** 构建期展开的前后三年公历日期（YYYY-MM-DD） */
		occurrences: string[];
	};
	labels: {
		/** 「{month}第{week}周」样式模板，month 为 Intl 月份名 */
		weekFormat: string;
		/** 「{count}篇」样式模板 */
		postCount: string;
		days: string;
		unavailable: string;
		noHoliday: string;
	};
}

interface PostMeta {
	id: string;
	title: string;
	published: number;
}

interface HolidayEntry {
	date: string;
	name: string;
	isWorkday?: boolean;
}

interface ProfileData {
	holidays: HolidayEntry[];
	holidaysFailed: boolean;
	posts: PostMeta[];
	postsFailed: boolean;
}

interface ProfileRefs {
	panel: HTMLElement;
	card: HTMLElement;
	mask: HTMLElement | null;
	leftSeg: HTMLElement | null;
	content: HTMLElement;
	tablist: HTMLElement;
	/** DOM 实际渲染出的标签顺序，方向判定与键盘循环都以它为准 */
	tabs: ProfileTab[];
	panes: Map<ProfileTab, HTMLElement>;
	tabButtons: Map<ProfileTab, HTMLButtonElement>;
	heatmap: HTMLElement | null;
	cells: Map<string, HTMLButtonElement>;
	weekPosts: HTMLElement | null;
	days: { week: HTMLElement; month: HTMLElement; year: HTMLElement };
	events: {
		holiday: EventElements | null;
		anniversary: EventElements | null;
	};
	postsTitle: HTMLElement | null;
	postList: HTMLElement | null;
	tooltip: HTMLElement | null;
	bannerImg: HTMLElement | null;
}

interface EventElements {
	title: HTMLElement | null;
	date: HTMLElement | null;
	progress: HTMLElement | null;
	fill: HTMLElement | null;
	remaining: HTMLElement | null;
}

const PROFILE_TABS = ["heatmap", "dates", "sites"] as const;

type ProfileTab = (typeof PROFILE_TABS)[number];

function isProfileTab(value: string | undefined): value is ProfileTab {
	return value !== undefined && PROFILE_TABS.some((tab) => tab === value);
}

/** 与样式断点（min-width: 1024px 走桌面布局）保持互补 */
const MOBILE_MEDIA = "(max-width: 1023.98px)";
/** 鼠标在 logo 与面板之间移动的过渡余量，避免误收起 */
const CLOSE_DELAY = 260;
/** 兜底默认页；模板未渲染出该页时退到实际首个标签 */
const DEFAULT_TAB: ProfileTab = "heatmap";
/** 标签页横向滑动时长 */
const SLIDE_DURATION = 240;
/** 与移动端底部卡片入场同一条曲线，两处动效节奏对齐 */
const SLIDE_EASING = "cubic-bezier(0.32, 0.72, 0.29, 1)";
/** 触摸手势判定主轴所需的最低位移，越过即锁定本手势轴向 */
const SWIPE_AXIS_LOCK = 16;
/** 移动端横向每滑动多少像素换一格标签 */
const SWIPE_TAB_DISTANCE = 48;
/** 移动端竖向下滑关闭阈值 */
const SWIPE_CLOSE_DISTANCE = 64;

/** MobileDock 站名按钮等外部入口请求开合面板时派发的窗口事件名 */
export const NAVBAR_PROFILE_TOGGLE_EVENT = "navbar-profile:toggle";

let config: ProfileConfig | null = null;
let refs: ProfileRefs | null = null;
let initialized = false;

let data: ProfileData | null = null;
let dataPromise: Promise<void> | null = null;
let postsByCell = new Map<string, PostMeta[]>();

let selectedCellKey: string | null = null;
let activeTab: ProfileTab | null = null;
let defaultTab: ProfileTab = DEFAULT_TAB;
/** 滑动代数：每次新切换自增，过期回调据此放弃提交终态 */
let slideRevision = 0;
let slideAnimations: Animation[] = [];
let closeTimer: number | null = null;
let openedAsMobile = false;
let previousBodyOverflow = "";
/** 入场数字滚动的 rAF 句柄，重放/收起时取消 */
let counterFrames: number[] = [];
/** 浮层篇数滚动的 rAF 句柄，浮层收起或改挂别处时取消 */
let tooltipFrames: number[] = [];

function cancelTooltipFrames(): void {
	for (const frame of tooltipFrames) cancelAnimationFrame(frame);
	tooltipFrames = [];
}

/** 数字滚动时长，与旧日历组件的计数动画节奏一致 */
const COUNTER_DURATION = 520;
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
	const content = card.querySelector<HTMLElement>("[data-profile-content]");
	const tablist = card.querySelector<HTMLElement>("[data-profile-tabs]");
	if (!content || !tablist) return null;
	// 标签与面板按 DOM 实际结果配对：sites 页在 personalSites 为空时整块不渲染，
	// 收 Map 而不是 Record，方向判定与键盘循环都只认这份顺序
	const panes = new Map<ProfileTab, HTMLElement>();
	const tabButtons = new Map<ProfileTab, HTMLButtonElement>();
	tablist
		.querySelectorAll<HTMLButtonElement>("[data-profile-tab]")
		.forEach((button) => {
			const tab = button.dataset.profileTab;
			if (!isProfileTab(tab)) return;
			const pane = card.querySelector<HTMLElement>(
				`[data-profile-pane='${tab}']`,
			);
			if (!pane) return;
			tabButtons.set(tab, button);
			panes.set(tab, pane);
		});
	const tabs = [...panes.keys()];
	if (tabs.length === 0) return null;
	const daysWeek = card.querySelector<HTMLElement>(
		"[data-profile-days='week']",
	);
	const daysMonth = card.querySelector<HTMLElement>(
		"[data-profile-days='month']",
	);
	const daysYear = card.querySelector<HTMLElement>(
		"[data-profile-days='year']",
	);
	if (!daysWeek || !daysMonth || !daysYear) return null;
	const readEvent = (name: string): EventElements | null => {
		const root = card.querySelector<HTMLElement>(
			`[data-profile-event='${name}']`,
		);
		if (!root) return null;
		return {
			title: root.querySelector("[data-profile-event-title]"),
			date: root.querySelector("[data-profile-event-date]"),
			progress: root.querySelector("[data-profile-event-progress]"),
			fill: root.querySelector("[data-profile-event-progress-fill]"),
			remaining: root.querySelector("[data-profile-event-remaining]"),
		};
	};

	return {
		panel,
		card,
		mask: panel.querySelector("[data-profile-mask]"),
		// 面板挂在 body 末尾，左段改从文档级查找（hover/focus 触发源 + 桌面端锚点）
		leftSeg: document.querySelector("#navbar .navbar-seg--left"),
		content,
		tablist,
		tabs,
		panes,
		tabButtons,
		heatmap: card.querySelector("[data-profile-heatmap]"),
		cells,
		weekPosts: card.querySelector("[data-profile-week]"),
		days: { week: daysWeek, month: daysMonth, year: daysYear },
		events: {
			holiday: readEvent("holiday"),
			anniversary: readEvent("anniversary"),
		},
		postsTitle: card.querySelector("[data-profile-posts-title]"),
		postList: card.querySelector("[data-profile-post-list]"),
		tooltip: card.querySelector("[data-profile-tooltip]"),
		bannerImg: card.querySelector("[data-profile-banner-img]"),
	};
}

/* ── 数据加载 ── */

async function fetchData(): Promise<ProfileData> {
	if (!config)
		return { holidays: [], holidaysFailed: true, posts: [], postsFailed: true };
	const request = async (path: string): Promise<unknown> => {
		const response = await fetch(path, {
			headers: { Accept: "application/json" },
		});
		if (!response.ok)
			throw new Error(`Profile card request failed: ${response.status}`);
		return response.json();
	};
	// 两份数据相互独立：一份失败不拖垮另一份，各自降级
	const [holidayResult, postResult] = await Promise.allSettled([
		request(config.api.holidays),
		request(config.api.posts),
	]);
	const holidays =
		holidayResult.status === "fulfilled" && Array.isArray(holidayResult.value)
			? (holidayResult.value as HolidayEntry[])
			: [];
	const posts =
		postResult.status === "fulfilled" && Array.isArray(postResult.value)
			? (postResult.value as PostMeta[])
			: [];
	return {
		holidays,
		holidaysFailed: holidayResult.status !== "fulfilled",
		posts,
		postsFailed: postResult.status !== "fulfilled",
	};
}

function ensureData(): void {
	if (!config || !refs || dataPromise) return;
	refs.card.setAttribute("aria-busy", "true");
	dataPromise = fetchData()
		.then((result) => {
			data = result;
			postsByCell = buildPostsByCell(result.posts);
			renderHeatmapCounts();
			renderEvents();
			// 数据可能在用户已经切到日期页之后才到，此时补播一次入场动效
			if (activeTab === "dates") playEntranceAnimation();
		})
		.finally(() => {
			refs?.card.setAttribute("aria-busy", "false");
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
		month: "long",
	}).format(new Date(2000, monthRaw, 1));
	return config.labels.weekFormat
		.replace("{month}", monthName)
		.replace("{week}", String(weekRaw + 1));
}

/* ── 渲染 ── */

function computeCountdownTargets(): {
	week: number;
	month: number;
	year: number;
} {
	const now = new Date();
	const startOfDay = (date: Date): number =>
		new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
	const remaining = (target: Date): number =>
		Math.max(0, Math.round((startOfDay(target) - startOfDay(now)) / 86400000));
	// 周一为一周之首：getDay() 周日为 0，换算成周一为 0
	const weekEnd = new Date(
		now.getFullYear(),
		now.getMonth(),
		now.getDate() + (6 - ((now.getDay() + 6) % 7)),
	);
	return {
		week: remaining(weekEnd),
		month: remaining(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
		year: remaining(new Date(now.getFullYear(), 11, 31)),
	};
}

/** scale ∈ [0,1]：1 为终值，入场动画期间按缓动系数取中间值 */
function applyCountdowns(scale: number): void {
	if (!refs || !config) return;
	const targets = computeCountdownTargets();
	const daysSuffix = config.labels.days;
	refs.days.week.textContent = `${Math.round(targets.week * scale)}${daysSuffix}`;
	refs.days.month.textContent = `${Math.round(targets.month * scale)}${daysSuffix}`;
	refs.days.year.textContent = `${Math.round(targets.year * scale)}${daysSuffix}`;
}

function cancelCounterFrames(): void {
	for (const frame of counterFrames) cancelAnimationFrame(frame);
	counterFrames = [];
}

/* ── 日期页入场动效：数字滚动 + 进度条重充，日期页每次可见都重放 ── */

function animateCounters(): void {
	if (!refs || !config) return;
	const targets = computeCountdownTargets();
	const daysSuffix = config.labels.days;
	const start = performance.now();
	const tick = (now: number): void => {
		if (!refs) return;
		const progress = Math.min(1, (now - start) / COUNTER_DURATION);
		const eased = 1 - (1 - progress) ** 3;
		refs.days.week.textContent = `${Math.round(targets.week * eased)}${daysSuffix}`;
		refs.days.month.textContent = `${Math.round(targets.month * eased)}${daysSuffix}`;
		refs.days.year.textContent = `${Math.round(targets.year * eased)}${daysSuffix}`;
		if (progress < 1) counterFrames.push(requestAnimationFrame(tick));
	};
	counterFrames.push(requestAnimationFrame(tick));
}

function animateEventRemainings(): void {
	if (!refs || !config) return;
	const targets = [refs.events.holiday, refs.events.anniversary]
		.map((event) => event?.remaining ?? null)
		.filter(
			(el): el is HTMLElement => !!el && el.dataset.profileTarget !== undefined,
		)
		.map((el) => ({ el, value: Number(el.dataset.profileTarget) }));
	if (targets.length === 0) return;
	const daysSuffix = config.labels.days;
	const start = performance.now();
	const tick = (now: number): void => {
		if (!refs) return;
		const progress = Math.min(1, (now - start) / COUNTER_DURATION);
		const eased = 1 - (1 - progress) ** 3;
		for (const { el, value } of targets) {
			el.textContent = `${Math.round(value * eased)}${daysSuffix}`;
		}
		if (progress < 1) counterFrames.push(requestAnimationFrame(tick));
	};
	counterFrames.push(requestAnimationFrame(tick));
}

function replayFills(): void {
	if (!refs) return;
	for (const event of [refs.events.holiday, refs.events.anniversary]) {
		if (!event?.fill || !event.progress) continue;
		animateFillTo(
			event.fill,
			Number(event.progress.getAttribute("aria-valuenow") ?? 0),
		);
	}
}

function playEntranceAnimation(): void {
	if (!refs) return;
	if (prefersReducedMotion()) return;
	cancelCounterFrames();
	animateCounters();
	animateEventRemainings();
	replayFills();
}

/** 日期页可见才重放入场动效（默认页是简介，打开面板时不放） */
function onDatesVisible(): void {
	if (activeTab !== "dates") return;
	playEntranceAnimation();
}

/** 把日期页的数字与进度钉在终值：动效中途切走 / 关闭面板时收口，不留半程值 */
function finalizeDates(): void {
	if (!refs || !config) return;
	cancelCounterFrames();
	applyCountdowns(1);
	for (const event of [refs.events.holiday, refs.events.anniversary]) {
		if (!event?.remaining) continue;
		const target = event.remaining.dataset.profileTarget;
		if (target !== undefined) {
			event.remaining.textContent = `${target}${config.labels.days}`;
		}
		if (event.fill && event.progress) {
			setFillWidth(
				event.fill,
				Number(event.progress.getAttribute("aria-valuenow") ?? 0),
			);
		}
	}
}

function renderHeatmapCounts(): void {
	if (!refs || !config || !data) return;
	for (const [key, cell] of refs.cells) {
		const count = data.postsFailed ? 0 : (postsByCell.get(key)?.length ?? 0);
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

function renderEventCard(
	target: EventElements | null,
	milestone: Milestone | null,
	emptyLabel: string,
): void {
	if (!target) return;
	if (!milestone) {
		if (target.title) target.title.textContent = emptyLabel;
		if (target.date) target.date.textContent = "";
		if (target.remaining) {
			target.remaining.textContent = "--";
			delete target.remaining.dataset.profileTarget;
		}
		if (target.progress) target.progress.setAttribute("aria-valuenow", "0");
		if (target.fill) target.fill.style.width = "0%";
		return;
	}
	if (target.title) target.title.textContent = milestone.title;
	if (target.date) {
		target.date.textContent = formatDateKey(milestone.date);
	}
	if (target.remaining) {
		// 目标值挂 dataset，供日期页每次可见时的滚动动效读取
		target.remaining.dataset.profileTarget = String(milestone.remainingDays);
		target.remaining.textContent = `${milestone.remainingDays}${config?.labels.days ?? ""}`;
	}
	if (target.progress) {
		target.progress.setAttribute("aria-valuenow", String(milestone.progress));
		target.progress.setAttribute("aria-valuetext", `${milestone.progress}%`);
	}
	// 渲染只落终值，重放统一走 playEntranceAnimation，避免双重播
	setFillWidth(target.fill, milestone.progress);
}

function setFillWidth(fill: HTMLElement | null, progress: number): void {
	if (fill) fill.style.width = `${progress}%`;
}

/** 进度条从 0 重新充满：入场动效重放时用 */
function animateFillTo(fill: HTMLElement | null, progress: number): void {
	if (!fill) return;
	fill.style.transition = "none";
	fill.style.width = "0%";
	void fill.offsetWidth;
	fill.style.removeProperty("transition");
	fill.style.width = `${progress}%`;
}

function formatDateKey(dateKey: string): string {
	if (!config) return dateKey;
	const [year, month, day] = dateKey.split("-").map(Number);
	try {
		return new Intl.DateTimeFormat(config.locale, {
			month: "long",
			day: "numeric",
		}).format(new Date(year, month - 1, day));
	} catch {
		return dateKey;
	}
}

function renderEvents(): void {
	if (!refs || !config || !data) return;
	const currentConfig = config;
	const todayKey = formatYmd(new Date());

	renderEventCard(
		refs.events.holiday,
		data.holidaysFailed
			? null
			: milestoneFromOccurrences(
					getHolidayOccurrences(data.holidays),
					todayKey,
				),
		data.holidaysFailed
			? currentConfig.labels.unavailable
			: currentConfig.labels.noHoliday,
	);

	// 建站日事件序列在构建期内联，无网络依赖
	renderEventCard(
		refs.events.anniversary,
		milestoneFromOccurrences(
			currentConfig.anniversary.occurrences.map((date) => ({
				title: currentConfig.anniversary.name,
				date,
			})),
			todayKey,
		),
		currentConfig.labels.unavailable,
	);
}

/* ── 标签页状态机 ── */

/**
 * 内容区高度跟随当前页。面板是绝对堆叠在容器里的，被容器夹住时 scrollHeight
 * 不会小于 clientHeight，所以先临时放开容器高度量一次自然高，再写回目标值，
 * 让高度过渡与横向滑动同步进行；超出 CSS 的 max-height 才走页内滚动。
 */
function syncContentHeight(): void {
	if (!refs || !activeTab) return;
	const pane = refs.panes.get(activeTab);
	if (!pane) return;
	const { content } = refs;
	const from = content.getBoundingClientRect().height;
	content.style.transition = "none";
	content.style.height = "auto";
	const natural = Math.ceil(pane.scrollHeight);
	content.style.height = `${String(from)}px`;
	void content.offsetWidth;
	content.style.removeProperty("transition");
	content.style.height = `${String(natural)}px`;
}

/** 让 DOM 与 activeTab 一致：激活页可见，其余隐藏且不留内联样式 */
function syncPaneVisibility(): void {
	if (!refs) return;
	for (const [tab, pane] of refs.panes) {
		pane.hidden = tab !== activeTab;
		pane.style.removeProperty("pointer-events");
	}
}

function syncTabButtons(): void {
	if (!refs) return;
	for (const [tab, button] of refs.tabButtons) {
		const isActive = tab === activeTab;
		button.setAttribute("aria-selected", String(isActive));
		// roving tabindex：整个标签条在 Tab 序列里只占一站
		button.tabIndex = isActive ? 0 : -1;
		button.classList.toggle("profile-card__tab--active", isActive);
		button.classList.toggle("profile-card__tab--inactive", !isActive);
	}
}

/** 结束进行中的滑动并收回所有非激活页：连点标签时不排队、不堆叠 */
function settleSlides(): void {
	slideRevision += 1;
	for (const animation of slideAnimations) animation.cancel();
	slideAnimations = [];
	refs?.content.classList.remove("is-sliding");
	syncPaneVisibility();
}

/** 索引增大 = 前进 = 新页从右侧滑入 */
function slideDirection(from: ProfileTab, to: ProfileTab): 1 | -1 {
	if (!refs) return 1;
	return refs.tabs.indexOf(to) >= refs.tabs.indexOf(from) ? 1 : -1;
}

function activateTab(next: ProfileTab, withSlide: boolean): void {
	if (!refs || next === activeTab) return;
	const toPane = refs.panes.get(next);
	if (!toPane) return;
	const fromTab = activeTab;
	const fromPane = fromTab ? refs.panes.get(fromTab) : undefined;

	activeTab = next;
	syncTabButtons();
	hideTooltip();
	if (fromTab === "dates") finalizeDates();
	// 焦点若还留在旧页内，先挪到新标签按钮：否则旧页被 hidden 时焦点掉回
	// body，面板 focusout 会把 relatedTarget 为空的这次移动误判成离开面板
	if (fromPane?.contains(document.activeElement)) {
		refs.tabButtons.get(next)?.focus();
	}
	settleSlides();

	const canSlide =
		withSlide &&
		!!fromPane &&
		!!fromTab &&
		!prefersReducedMotion() &&
		typeof fromPane.animate === "function" &&
		typeof toPane.animate === "function";
	if (!canSlide || !fromPane || !fromTab) {
		syncContentHeight();
		onDatesVisible();
		return;
	}

	const dir = slideDirection(fromTab, next);
	const revision = slideRevision;
	const options: KeyframeAnimationOptions = {
		duration: SLIDE_DURATION,
		easing: SLIDE_EASING,
	};
	// settleSlides 已把旧页收回，双向滑动要把它重新摆回轨道上
	fromPane.hidden = false;
	fromPane.style.pointerEvents = "none";
	toPane.style.pointerEvents = "none";
	refs.content.classList.add("is-sliding");
	// outgoing 停在屏外（fill: both），incoming 结束后回到 CSS 无 transform 态
	const outgoing = fromPane.animate(
		[
			{ transform: "translateX(0)" },
			{ transform: `translateX(${-dir * 100}%)` },
		],
		{ ...options, fill: "both" },
	);
	const incoming = toPane.animate(
		[
			{ transform: `translateX(${dir * 100}%)` },
			{ transform: "translateX(0)" },
		],
		options,
	);
	slideAnimations = [outgoing, incoming];
	void Promise.all([
		outgoing.finished.catch(() => undefined),
		incoming.finished.catch(() => undefined),
	]).then(() => {
		// 已被更新的切换接管：过期回调不提交终态，否则会盖掉新页
		if (revision !== slideRevision) return;
		fromPane.hidden = true;
		outgoing.cancel();
		fromPane.style.removeProperty("pointer-events");
		toPane.style.removeProperty("pointer-events");
		slideAnimations = [];
		refs?.content.classList.remove("is-sliding");
	});
	// 高度过渡与横向滑动同帧启动，两者共用时长与曲线
	syncContentHeight();
	onDatesVisible();
}

function selectTabByIndex(index: number): void {
	if (!refs) return;
	const bounded = Math.min(refs.tabs.length - 1, Math.max(0, index));
	const next = refs.tabs[bounded];
	if (next) activateTab(next, true);
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
}

function closePanel(): void {
	if (!refs) return;
	cancelScheduledClose();
	if (!refs.panel.classList.contains("is-open")) return;
	refs.panel.classList.remove("is-open");
	// 面板在 Swup 容器之外、DOM 跨导航复用，这里是唯一的状态归位点
	settleSlides();
	collapseWeek();
	hideTooltip();
	activeTab = defaultTab;
	syncTabButtons();
	syncPaneVisibility();
	syncContentHeight();
	finalizeDates();
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
	const { panel, card, mask, leftSeg, heatmap, tablist } = refs;

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
		// 标签按钮失焦回 body 时 relatedTarget 为空，会被误判成焦点离开
		// 面板，点站点 CTA 就等于把卡片关了
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
	// 视口变化改变居中布局与高度上限，面板开着时重锚定并重新量一次内容高度
	window.addEventListener(
		"resize",
		() => {
			if (!panel.classList.contains("is-open") || openedAsMobile) return;
			positionPanel();
			syncContentHeight();
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

	// 标签条：点击切换 + 方向键/Home/End 循环（automatic activation）
	tablist.addEventListener("click", (event) => {
		const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
			"[data-profile-tab]",
		);
		const tab = button?.dataset.profileTab;
		if (!isProfileTab(tab)) return;
		activateTab(tab, true);
	});
	tablist.addEventListener("keydown", (event) => {
		const current = activeTab ? (refs?.tabs.indexOf(activeTab) ?? 0) : 0;
		const total = refs?.tabs.length ?? 0;
		if (total === 0) return;
		let nextIndex: number;
		switch (event.key) {
			case "ArrowRight": {
				nextIndex = (current + 1) % total;
				break;
			}
			case "ArrowLeft": {
				nextIndex = (current - 1 + total) % total;
				break;
			}
			case "Home": {
				nextIndex = 0;
				break;
			}
			case "End": {
				nextIndex = total - 1;
				break;
			}
			default:
				return;
		}
		event.preventDefault();
		const next = refs?.tabs[nextIndex];
		if (next) refs?.tabButtons.get(next)?.focus();
		selectTabByIndex(nextIndex);
	});

	// 热力图：点格内联展开该周文章，再点已选中方块收起
	heatmap?.addEventListener("click", (event) => {
		const target = event.target as HTMLElement;
		const cell = target.closest<HTMLButtonElement>("[data-profile-cell]");
		const key = cell?.dataset.profileCell;
		if (!key) return;
		const same = key === selectedCellKey;
		collapseWeek();
		if (!same) selectCell(key);
		// 展开/收起改变了本页自然高度，收口处统一同步一次，避免中途多段动画
		syncContentHeight();
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
	// scroll 不冒泡，靠捕获阶段一个监听同时覆盖内容页与移动端整卡滚动
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

	// 移动端底部卡片：竖向下滑关闭，横向滑动切标签。
	// 页内自带滚动，故起点落在内容页里时禁用竖向关闭，否则滚一下顺手就关卡片
	let touchStartX = 0;
	let touchStartY = 0;
	let touchStartTab = 0;
	let touchAxis: "h" | "v" | null = null;
	let swipeCloseEnabled = false;
	let tabStepsApplied = 0;
	card.addEventListener(
		"touchstart",
		(event) => {
			const touch = event.touches[0];
			if (!touch) return;
			touchStartX = touch.clientX;
			touchStartY = touch.clientY;
			touchStartTab = activeTab ? (refs?.tabs.indexOf(activeTab) ?? 0) : 0;
			touchAxis = null;
			tabStepsApplied = 0;
			swipeCloseEnabled = !(event.target as HTMLElement).closest(
				"[data-profile-pane]",
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
			if (touchAxis === "v") {
				if (swipeCloseEnabled && deltaY > SWIPE_CLOSE_DISTANCE) closePanel();
				return;
			}
			const steps = Math.trunc(-deltaX / SWIPE_TAB_DISTANCE);
			if (steps === tabStepsApplied) return;
			tabStepsApplied = steps;
			selectTabByIndex(touchStartTab + steps);
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
	// 默认页取 DOM 里的首个标签，与模板 hidden 的判据同源（模板恒以 heatmap 打头）
	defaultTab = refs.tabs[0] ?? DEFAULT_TAB;
	activeTab = defaultTab;
	syncTabButtons();
	syncPaneVisibility();
	syncContentHeight();
	// 倒计时只依赖本地日期，初始化即落终值，不等接口；日期页可见时的滚动另由 playEntranceAnimation 负责
	applyCountdowns(1);
	markCurrentWeekCell();
	bindEvents();
}
