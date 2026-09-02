/**
 * 顶部导航 Logo 资料卡面板控制器（常驻组件作用域）。
 *
 * 面板替代旧的 logo 悬停下拉与悬浮坞日历。桌面端 hover/focus 展开（is-open
 * 类驱动，不再用纯 CSS :has 悬停——JS 需要在展开时机上同步懒加载数据），
 * 移动端点击 logo 弹出底部半屏卡片（遮罩 + 下滑关闭 + 滚动锁定）。
 *
 * 右栏三态：default（周/月/年底倒计时 + 最近节日进度 + 建站日进度）、
 * site（hover 个人网站时的大按钮预览，移出即还原进入前状态）、
 * posts（点击热力图方块后的该周文章列表）。面板关闭或 Swup 导航后强制回
 * default 并清空选中态；数据缓存跨导航保留，仅首次展开时请求。
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
	heatmap: HTMLElement | null;
	cells: Map<string, HTMLButtonElement>;
	siteTriggers: HTMLElement[];
	siteCtas: Map<string, HTMLElement>;
	panes: { default: HTMLElement; site: HTMLElement; posts: HTMLElement };
	days: { week: HTMLElement; month: HTMLElement; year: HTMLElement };
	events: {
		holiday: EventElements | null;
		anniversary: EventElements | null;
	};
	postsTitle: HTMLElement | null;
	postList: HTMLElement | null;
}

interface EventElements {
	title: HTMLElement | null;
	date: HTMLElement | null;
	progress: HTMLElement | null;
	fill: HTMLElement | null;
	remaining: HTMLElement | null;
}

type RightState = "default" | "site" | "posts";

/** 与样式断点（min-width: 1024px 走桌面布局）保持互补 */
const MOBILE_MEDIA = "(max-width: 1023.98px)";
/** 鼠标在 logo 与面板之间移动的过渡余量，避免误收起 */
const CLOSE_DELAY = 260;

let config: ProfileConfig | null = null;
let refs: ProfileRefs | null = null;
let initialized = false;

let data: ProfileData | null = null;
let dataPromise: Promise<void> | null = null;
let postsByCell = new Map<string, PostMeta[]>();

let selectedCellKey: string | null = null;
let hoveredCtaKey: string | null = null;
/** 点击钉住的站点按钮：hover 是临时预览，点击后移出鼠标仍保持该站展示 */
let pinnedSiteKey: string | null = null;
let closeTimer: number | null = null;
let openedAsMobile = false;
let previousBodyOverflow = "";
/** 入场数字滚动的 rAF 句柄，重放/收起时取消 */
let counterFrames: number[] = [];

/** 数字滚动时长，与旧日历组件的计数动画节奏一致 */
const COUNTER_DURATION = 520;

function isMobileViewport(): boolean {
	return window.matchMedia(MOBILE_MEDIA).matches;
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
	const siteCtas = new Map<string, HTMLElement>();
	panel
		.querySelectorAll<HTMLElement>("[data-profile-site-cta]")
		.forEach((cta) => {
			const key = cta.dataset.profileSiteCta;
			if (key !== undefined) siteCtas.set(key, cta);
		});
	const daysWeek = card.querySelector<HTMLElement>(
		"[data-profile-days='week']",
	);
	const daysMonth = card.querySelector<HTMLElement>(
		"[data-profile-days='month']",
	);
	const daysYear = card.querySelector<HTMLElement>(
		"[data-profile-days='year']",
	);
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
	const pane = (name: string) =>
		card.querySelector<HTMLElement>(`[data-profile-pane='${name}']`);
	const defaultPane = pane("default");
	const sitePane = pane("site");
	const postsPane = pane("posts");
	if (!defaultPane || !sitePane || !postsPane) return null;
	if (!daysWeek || !daysMonth || !daysYear) return null;

	return {
		panel,
		card,
		mask: panel.querySelector("[data-profile-mask]"),
		leftSeg: panel.parentElement?.querySelector(".navbar-seg--left") ?? null,
		heatmap: card.querySelector("[data-profile-heatmap]"),
		cells,
		siteTriggers: Array.from(
			card.querySelectorAll<HTMLElement>("[data-profile-site-trigger]"),
		),
		siteCtas,
		panes: { default: defaultPane, site: sitePane, posts: postsPane },
		days: { week: daysWeek, month: daysMonth, year: daysYear },
		events: {
			holiday: readEvent("holiday"),
			anniversary: readEvent("anniversary"),
		},
		postsTitle: card.querySelector("[data-profile-posts-title]"),
		postList: card.querySelector("[data-profile-post-list]"),
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

/** 倒计时只需本地日期，初始化即渲染终值，不等接口；展开时的滚动动效另由 playEntranceAnimation 负责 */
function renderCountdowns(): void {
	applyCountdowns(1);
}

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

/* ── 展开入场动效：数字滚动 + 进度条重充，每次展开面板都重放 ── */

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
	if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
	cancelCounterFrames();
	animateCounters();
	animateEventRemainings();
	replayFills();
}

function renderHeatmapCounts(): void {
	if (!refs || !config || !data) return;
	for (const [key, cell] of refs.cells) {
		const count = data.postsFailed ? 0 : (postsByCell.get(key)?.length ?? 0);
		cell.classList.remove("is-level-1", "is-level-2", "is-level-3");
		if (count > 0) cell.classList.add(`is-level-${Math.min(3, count)}`);
		const label = formatWeekLabel(key);
		const tooltip =
			count > 0
				? `${label} · ${config.labels.postCount.replace("{count}", String(count))}`
				: label;
		cell.dataset.tooltip = tooltip;
		cell.setAttribute("aria-label", tooltip);
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
		// 目标值挂 dataset，供每次展开面板时的滚动动效读取
		target.remaining.dataset.profileTarget = String(milestone.remainingDays);
		target.remaining.textContent = `${milestone.remainingDays}${config?.labels.days ?? ""}`;
	}
	if (target.progress) {
		target.progress.setAttribute("aria-valuenow", String(milestone.progress));
		target.progress.setAttribute("aria-valuetext", `${milestone.progress}%`);
	}
	animateFillTo(target.fill, milestone.progress);
}

/** 进度条从 0 重新充满：数据到达与每次展开面板时都重放 */
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

	// 首次加载即播放天数滚动，后续每次展开由 playEntranceAnimation 重放
	animateEventRemainings();
}

/* ── 右栏状态机 ── */

function setState(next: RightState): void {
	if (!refs) return;
	refs.panes.default.hidden = next !== "default";
	refs.panes.site.hidden = next !== "site";
	refs.panes.posts.hidden = next !== "posts";
	for (const [key, cta] of refs.siteCtas) {
		const visible = next === "site" && key === hoveredCtaKey;
		cta.hidden = !visible;
	}
}

/** hover 个人网站：右侧切换成该站大按钮；移出时还原（有钉住则回钉住站） */
function hoverSite(key: string | null): void {
	if (!key || !refs?.siteCtas.has(key)) return;
	hoveredCtaKey = key;
	setState("site");
}

function hoverSiteEnd(): void {
	if (pinnedSiteKey) {
		hoveredCtaKey = pinnedSiteKey;
		setState("site");
		return;
	}
	hoveredCtaKey = null;
	setState(selectedCellKey ? "posts" : "default");
}

/** 点击站点按钮：只切换右侧展示（钉住/取消钉住），跳转由右侧 CTA 承担 */
function clickSite(key: string | null): void {
	if (!key || !refs?.siteCtas.has(key)) return;
	if (pinnedSiteKey === key) {
		pinnedSiteKey = null;
		hoveredCtaKey = null;
		setState(selectedCellKey ? "posts" : "default");
	} else {
		pinnedSiteKey = key;
		hoveredCtaKey = key;
		setState("site");
	}
	syncSiteTriggerStates();
}

function syncSiteTriggerStates(): void {
	if (!refs) return;
	for (const trigger of refs.siteTriggers) {
		const key = trigger.dataset.profileSiteTrigger;
		trigger.setAttribute("aria-pressed", String(key === pinnedSiteKey));
	}
}

function clearSelection(): void {
	if (!refs) return;
	if (selectedCellKey) {
		const cell = refs.cells.get(selectedCellKey);
		cell?.classList.remove("is-selected");
		cell?.setAttribute("aria-pressed", "false");
	}
	selectedCellKey = null;
	if (refs.postList) refs.postList.replaceChildren();
}

function selectCell(key: string): void {
	if (!refs || !config) return;
	const posts = postsByCell.get(key);
	clearSelection();
	// 选周展示后站点钉住失效
	pinnedSiteKey = null;
	syncSiteTriggerStates();
	// 空周不进文章态，右侧直接回默认
	if (!posts || posts.length === 0) {
		setState("default");
		return;
	}

	selectedCellKey = key;
	const cell = refs.cells.get(key);
	cell?.classList.add("is-selected");
	cell?.setAttribute("aria-pressed", "true");

	if (refs.postsTitle) {
		const { month, start, end } = cellDateRangeOf(key);
		const pad = (value: number): string => String(value).padStart(2, "0");
		refs.postsTitle.textContent = `${formatWeekLabel(key)} · ${pad(month + 1)}.${pad(start)} – ${pad(month + 1)}.${pad(end)}`;
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
	setState("posts");
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

function openPanel(): void {
	if (!refs) return;
	cancelScheduledClose();
	if (refs.panel.classList.contains("is-open")) return;
	ensureData();
	openedAsMobile = isMobileViewport();
	refs.panel.classList.add("is-open");
	// 每次展开都重放数字滚动与进度条动效
	playEntranceAnimation();
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
	cancelCounterFrames();
	if (openedAsMobile) document.body.style.overflow = previousBodyOverflow;
	openedAsMobile = false;
	// 关闭即复位右栏、热力图选中态与站点钉住（数据缓存保留）
	clearSelection();
	pinnedSiteKey = null;
	hoveredCtaKey = null;
	syncSiteTriggerStates();
	setState("default");
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
	const { panel, card, mask, leftSeg, heatmap, siteTriggers } = refs;

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

	document.addEventListener("keydown", (event) => {
		if (event.key !== "Escape" || !panel.classList.contains("is-open")) return;
		event.preventDefault();
		const focusInCard =
			document.activeElement instanceof Node &&
			card.contains(document.activeElement);
		closePanel();
		if (focusInCard) focusLogo();
	});

	// 个人网站文字按钮：无悬停预览，点击选中/取消（右侧展示对应站点，跳转由 CTA 承担）；
	// 键盘 focus 预览保留，Tab 移开后还原
	for (const trigger of siteTriggers) {
		const key = trigger.dataset.profileSiteTrigger ?? null;
		trigger.addEventListener("focusin", () => hoverSite(key));
		trigger.addEventListener("focusout", (event) => {
			const next = event.relatedTarget;
			if (next instanceof Node && trigger.contains(next)) return;
			hoverSiteEnd();
		});
		trigger.addEventListener("click", () => clickSite(key));
	}

	// 热力图点击：有文章进文章态，空周回默认，再点已选中方块取消
	heatmap?.addEventListener("click", (event) => {
		const target = event.target as HTMLElement;
		const cell = target.closest<HTMLButtonElement>("[data-profile-cell]");
		const key = cell?.dataset.profileCell;
		if (!key) return;
		if (key === selectedCellKey) {
			clearSelection();
			setState("default");
			return;
		}
		selectCell(key);
	});

	// 移动端底部卡片：下滑超过阈值关闭
	let touchStartY: number | null = null;
	card.addEventListener(
		"touchstart",
		(event) => {
			touchStartY = event.touches[0]?.clientY ?? null;
		},
		{ passive: true },
	);
	card.addEventListener(
		"touchmove",
		(event) => {
			if (touchStartY === null || !openedAsMobile) return;
			const deltaY = (event.touches[0]?.clientY ?? 0) - touchStartY;
			if (deltaY > 64) {
				touchStartY = null;
				closePanel();
			}
		},
		{ passive: true },
	);
	card.addEventListener(
		"touchend",
		() => {
			touchStartY = null;
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
	renderCountdowns();
	markCurrentWeekCell();
	bindEvents();
}
