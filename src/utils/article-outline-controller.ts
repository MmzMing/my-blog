import { definePageIsland } from "@/utils/swup-lifecycle";

type OutlineLevel = 1 | 2 | 3;

interface OutlineHeading {
	index: number;
	level: OutlineLevel;
	text: string;
	element: HTMLElement;
	absoluteTop: number;
	sectionEnd: number;
}

const READING_OFFSET = 80;
const MINIMAP_TICK_BUDGET = 48;
const MAX_TICKS_PER_SECTION = 12;
const COLLAPSE_DELAY = 320;
const MIN_HEADING_MARK_WIDTH = 1.5;
const MAX_HEADING_MARK_WIDTH = 4;
const HEADING_MARK_WIDTH_PER_CHARACTER = 0.16;
const SUMMARY_EDGE_GUTTER = 64;
const SCROLL_SETTLE_DELAY = 140;
const BAR_CHARGE_DURATION = 260;
const BAR_CHARGE_STEP = 14;

function clamp(value: number, minimum: number, maximum: number): number {
	return Math.min(Math.max(value, minimum), maximum);
}

function getHeadingText(heading: HTMLElement): string {
	const clone = heading.cloneNode(true) as HTMLElement;
	clone
		.querySelectorAll(
			"script, style, .anchor, .anchor-icon, [data-pagefind-ignore]",
		)
		.forEach((element) => {
			element.remove();
		});

	const text = clone.textContent?.replace(/#+\s*$/, "").trim();
	return text || heading.getAttribute("aria-label") || heading.id || "Heading";
}

function getHeadingMarkWidth(text: string): string {
	const characterCount = Array.from(text.replace(/\s+/gu, " ").trim()).length;
	const width = clamp(
		MIN_HEADING_MARK_WIDTH +
			Math.max(0, characterCount - 1) * HEADING_MARK_WIDTH_PER_CHARACTER,
		MIN_HEADING_MARK_WIDTH,
		MAX_HEADING_MARK_WIDTH,
	);
	return `${width.toFixed(2)}rem`;
}

export class ArticleOutlineRailController {
	private readonly root: HTMLElement;
	private readonly abortController = new AbortController();
	private readonly detailPanel: HTMLElement | null;
	private readonly detailTitleSlots: HTMLElement[];
	private readonly minimap: HTMLElement | null;
	private readonly browsePanel: HTMLElement | null;
	private readonly browseList: HTMLElement | null;
	private readonly progressRegion: HTMLElement | null;
	private readonly progressLabel: HTMLElement | null;
	private article: HTMLElement | null = null;
	private headings: OutlineHeading[] = [];
	private railBarsByHeading: HTMLElement[][] = [];
	private railBarCentersByHeading: number[][] = [];
	private activeIndex = -1;
	private activeRailBar: HTMLElement | null = null;
	private isScrolling = false;
	private articleStart = 0;
	private articleEnd = 0;
	private railHeight = 0;
	private lastProgressPercent = -1;
	private animationFrame: number | null = null;
	private measureFrame: number | null = null;
	private collapseTimer: ReturnType<typeof setTimeout> | null = null;
	private scrollSettleTimer: ReturnType<typeof setTimeout> | null = null;
	private chargeTimer: ReturnType<typeof setTimeout> | null = null;
	private titleUpdateFrame: number | null = null;
	private pendingTitle: string | null = null;
	private activeTitleSlot = 0;
	private resizeObserver: ResizeObserver | null = null;

	constructor(root: HTMLElement) {
		this.root = root;
		this.detailPanel = root.querySelector("[data-outline-details]");
		this.detailTitleSlots = Array.from(
			root.querySelectorAll<HTMLElement>("[data-outline-detail-title]"),
		);
		this.minimap = root.querySelector("[data-outline-minimap]");
		this.browsePanel = root.querySelector("[data-outline-browse]");
		this.browseList = root.querySelector("[data-outline-browse-list]");
		this.progressRegion = root.querySelector("[data-outline-progress-region]");
		this.progressLabel = root.querySelector("[data-outline-progress-label]");
	}

	public init(): boolean {
		this.article = document.querySelector<HTMLElement>(".custom-md");
		if (!this.article || !this.collectHeadings()) {
			this.root.hidden = true;
			return false;
		}

		this.root.hidden = false;
		this.cachePositions();
		this.renderMinimap();
		this.cacheRailGeometry();
		this.renderBrowseList();
		this.bindInteractions();
		this.resizeObserver = new ResizeObserver(() => this.scheduleMeasure());
		this.resizeObserver.observe(this.article);
		window.addEventListener("scroll", () => this.handleScroll(), {
			passive: true,
			signal: this.abortController.signal,
		});
		window.addEventListener("resize", () => this.scheduleMeasure(), {
			passive: true,
			signal: this.abortController.signal,
		});

		this.root.classList.remove("is-pending");
		this.update();
		return true;
	}

	public destroy(): void {
		this.abortController.abort();
		this.resizeObserver?.disconnect();
		this.resizeObserver = null;
		if (this.animationFrame !== null) cancelAnimationFrame(this.animationFrame);
		if (this.measureFrame !== null) cancelAnimationFrame(this.measureFrame);
		if (this.collapseTimer) clearTimeout(this.collapseTimer);
		if (this.scrollSettleTimer) clearTimeout(this.scrollSettleTimer);
		if (this.chargeTimer) clearTimeout(this.chargeTimer);
		if (this.titleUpdateFrame !== null)
			cancelAnimationFrame(this.titleUpdateFrame);
		this.animationFrame = null;
		this.measureFrame = null;
		this.collapseTimer = null;
		this.scrollSettleTimer = null;
		this.chargeTimer = null;
		this.titleUpdateFrame = null;
		this.pendingTitle = null;
		this.isScrolling = false;
	}

	private collectHeadings(): boolean {
		if (!this.article) return false;

		this.headings = Array.from(
			this.article.querySelectorAll<HTMLElement>("h1, h2, h3"),
		).map((element, index) => {
			const level = Number.parseInt(
				element.tagName.slice(1),
				10,
			) as OutlineLevel;
			const heading: OutlineHeading = {
				index,
				level,
				text: getHeadingText(element),
				element,
				absoluteTop: 0,
				sectionEnd: 0,
			};
			return heading;
		});

		return this.headings.length > 0;
	}

	private cachePositions(): void {
		if (!this.article) return;

		const scrollY = window.scrollY;
		const articleRect = this.article.getBoundingClientRect();
		this.articleStart = articleRect.top + scrollY;
		this.articleEnd = articleRect.bottom + scrollY;
		this.headings.forEach((heading, index) => {
			heading.absoluteTop =
				heading.element.getBoundingClientRect().top + scrollY;
			const nextHeading = this.headings[index + 1];
			heading.sectionEnd = nextHeading
				? nextHeading.element.getBoundingClientRect().top + scrollY
				: this.articleEnd;
		});
	}

	private renderMinimap(): void {
		if (!this.minimap) return;

		const totalLength = Math.max(1, this.articleEnd - this.articleStart);
		const fragment = document.createDocumentFragment();
		const allBars: HTMLElement[] = [];
		this.railBarsByHeading = [];
		let rowCount = 0;
		this.headings.forEach((heading) => {
			const sectionLength = Math.max(
				1,
				heading.sectionEnd - heading.absoluteTop,
			);
			const tickCount = clamp(
				Math.round((sectionLength / totalLength) * MINIMAP_TICK_BUDGET),
				1,
				MAX_TICKS_PER_SECTION,
			);
			rowCount += tickCount;
			const segment = document.createElement("span");
			segment.className = "article-outline-rail__segment";
			segment.dataset.outlineIndex = String(heading.index);
			segment.dataset.outlineLevel = String(heading.level);

			const marker = document.createElement("span");
			marker.className = "article-outline-rail__heading-mark";
			marker.dataset.outlineIndex = String(heading.index);
			marker.style.setProperty(
				"--article-outline-heading-width",
				getHeadingMarkWidth(heading.text),
			);
			segment.appendChild(marker);
			const bars: HTMLElement[] = [marker];

			const bodyTicks = document.createElement("span");
			bodyTicks.className = "article-outline-rail__body-ticks";
			for (let tickIndex = 1; tickIndex < tickCount; tickIndex += 1) {
				const tick = document.createElement("span");
				tick.className = "article-outline-rail__body-tick";
				tick.dataset.outlineLevel = "4";
				bodyTicks.appendChild(tick);
				bars.push(tick);
			}
			segment.appendChild(bodyTicks);
			fragment.appendChild(segment);
			this.railBarsByHeading.push(bars);
			allBars.push(...bars);
		});
		this.assignBarChargeOrder(allBars);

		this.minimap.style.setProperty(
			"--article-outline-row-count",
			String(rowCount),
		);
		this.minimap.replaceChildren(fragment);
		this.railBarCentersByHeading = [];
		this.activeRailBar = null;
	}

	private assignBarChargeOrder(bars: HTMLElement[]): void {
		const center = (bars.length - 1) / 2;
		const order = bars
			.map((_, index) => index)
			.sort(
				(left, right) =>
					Math.abs(left - center) - Math.abs(right - center) || left - right,
			);

		order.forEach((barIndex, chargeIndex) => {
			bars[barIndex]?.style.setProperty(
				"--article-outline-charge-index",
				String(chargeIndex),
			);
		});
	}

	private cacheRailGeometry(): void {
		if (!this.minimap) return;

		const minimapRect = this.minimap.getBoundingClientRect();
		this.railHeight = minimapRect.height;
		this.railBarCentersByHeading = this.railBarsByHeading.map((bars) =>
			bars.map((bar) => {
				const rect = bar.getBoundingClientRect();
				return rect.top - minimapRect.top + rect.height / 2;
			}),
		);

		const firstBarCenter = this.railBarCentersByHeading[0]?.[0];
		const lastBarCenters =
			this.railBarCentersByHeading[this.railBarCentersByHeading.length - 1];
		const lastBarCenter = lastBarCenters?.[lastBarCenters.length - 1];
		if (firstBarCenter === undefined || lastBarCenter === undefined) {
			return;
		}
	}

	private renderBrowseList(): void {
		if (!this.browseList) return;

		const fragment = document.createDocumentFragment();
		this.headings.forEach((heading) => {
			const item = document.createElement("a");
			item.className = "article-outline-rail__browse-item";
			item.dataset.outlineTarget = String(heading.index);
			item.dataset.outlineLevel = String(heading.level);
			item.href = heading.element.id
				? `#${encodeURIComponent(heading.element.id)}`
				: "#";
			item.title = heading.text;
			item.textContent = heading.text;
			fragment.appendChild(item);
		});
		this.browseList.replaceChildren(fragment);
	}

	private bindInteractions(): void {
		this.root.addEventListener("pointerenter", () => this.expand(), {
			signal: this.abortController.signal,
		});
		this.root.addEventListener("pointerleave", () => this.scheduleCollapse(), {
			signal: this.abortController.signal,
		});
		this.root.addEventListener("focusin", () => this.expand(), {
			signal: this.abortController.signal,
		});
		this.root.addEventListener("focusout", () => this.scheduleCollapse(), {
			signal: this.abortController.signal,
		});
		this.root.addEventListener(
			"click",
			(event) => this.navigateToHeading(event),
			{ signal: this.abortController.signal },
		);
	}

	private scheduleUpdate(): void {
		if (this.animationFrame !== null) return;
		this.animationFrame = requestAnimationFrame(() => {
			this.animationFrame = null;
			this.update();
		});
	}

	private handleScroll(): void {
		if (!this.isScrolling) {
			this.isScrolling = true;
			this.root.classList.add("is-scrolling");
			this.syncDetailAccessibility();
		}

		if (this.scrollSettleTimer) clearTimeout(this.scrollSettleTimer);
		this.scrollSettleTimer = setTimeout(
			() => this.settleScroll(),
			SCROLL_SETTLE_DELAY,
		);
		this.scheduleUpdate();
	}

	private settleScroll(): void {
		this.scrollSettleTimer = null;
		this.update();
		this.isScrolling = false;
		this.root.classList.remove("is-scrolling");
		this.syncDetailAccessibility();

		const activeHeading = this.headings[this.activeIndex];
		if (!activeHeading) return;
		this.syncActiveHeading(activeHeading);
		this.syncActiveRailBar(activeHeading);
	}

	private scheduleMeasure(): void {
		if (this.measureFrame !== null) return;
		this.measureFrame = requestAnimationFrame(() => {
			this.measureFrame = null;
			this.cachePositions();
			this.renderMinimap();
			this.cacheRailGeometry();
			this.renderBrowseList();
			this.activeIndex = -1;
			this.update();
		});
	}

	private update(): void {
		if (!this.headings.length) return;

		const progress = this.getProgress();
		this.syncReadingProgress(progress);

		const nextActiveIndex = this.getActiveIndex();
		if (nextActiveIndex !== this.activeIndex) {
			this.activeIndex = nextActiveIndex;
			if (!this.isScrolling || this.root.classList.contains("is-expanded")) {
				this.syncActiveHeading(this.headings[nextActiveIndex]);
			}
		}
		this.syncActiveRailBar(this.headings[nextActiveIndex]);
	}

	private syncReadingProgress(progress: number): void {
		this.root.style.setProperty("--article-outline-progress", String(progress));

		const progressPercent = Math.round(progress * 100);
		if (progressPercent === this.lastProgressPercent) return;

		this.lastProgressPercent = progressPercent;
		this.progressRegion?.setAttribute("aria-valuenow", String(progressPercent));
		if (this.progressLabel)
			this.progressLabel.textContent = `${progressPercent}%`;
	}

	private syncActiveRailBar(activeHeading: OutlineHeading): void {
		const bars = this.railBarsByHeading[activeHeading.index];
		const centers = this.railBarCentersByHeading[activeHeading.index];
		if (!bars?.length || !centers?.length) return;

		const readingPosition = window.scrollY + READING_OFFSET;
		const sectionProgress = clamp(
			(readingPosition - activeHeading.absoluteTop) /
				Math.max(1, activeHeading.sectionEnd - activeHeading.absoluteTop),
			0,
			1,
		);
		const activeBarIndex = Math.min(
			bars.length - 1,
			Math.floor(sectionProgress * bars.length),
		);
		const nextActiveRailBar = bars[activeBarIndex];
		const activeBarCenter = centers?.[activeBarIndex];
		if (activeBarCenter === undefined) return;

		if (nextActiveRailBar === this.activeRailBar) {
			if (!this.isScrolling) this.syncSummaryPosition(activeBarCenter);
			return;
		}

		this.activeRailBar?.classList.remove("is-active");
		nextActiveRailBar.classList.add("is-active");
		this.activeRailBar = nextActiveRailBar;
		if (!this.isScrolling) this.syncSummaryPosition(activeBarCenter);
	}

	private syncSummaryPosition(position: number): void {
		const summaryPosition = clamp(
			position,
			SUMMARY_EDGE_GUTTER,
			Math.max(SUMMARY_EDGE_GUTTER, this.railHeight - SUMMARY_EDGE_GUTTER),
		);
		this.root.style.setProperty(
			"--article-outline-summary-y",
			`${summaryPosition}px`,
		);
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

	private getActiveIndex(): number {
		const readingPosition = window.scrollY + READING_OFFSET;
		let lower = 0;
		let upper = this.headings.length - 1;
		let result = 0;

		while (lower <= upper) {
			const middle = Math.floor((lower + upper) / 2);
			if (this.headings[middle].absoluteTop <= readingPosition) {
				result = middle;
				lower = middle + 1;
			} else {
				upper = middle - 1;
			}
		}

		return result;
	}

	private syncActiveHeading(activeHeading: OutlineHeading): void {
		this.root
			.querySelectorAll<HTMLElement>("[data-outline-target]")
			.forEach((item) => {
				const isActive =
					item.dataset.outlineTarget === String(activeHeading.index);
				item.classList.toggle("is-active", isActive);
				if (isActive) item.setAttribute("aria-current", "location");
				else item.removeAttribute("aria-current");
			});
		this.syncDetailTitle(activeHeading.text);
	}

	private syncDetailTitle(text: string): void {
		if (this.detailTitleSlots.length < 2) return;

		const currentSlot = this.detailTitleSlots[this.activeTitleSlot];
		if (currentSlot?.textContent === text && this.pendingTitle === null) return;

		this.pendingTitle = text;
		if (this.titleUpdateFrame !== null) return;

		this.titleUpdateFrame = requestAnimationFrame(() => {
			this.titleUpdateFrame = null;
			const nextTitle = this.pendingTitle;
			this.pendingTitle = null;
			if (nextTitle === null) return;

			const currentIndex = this.activeTitleSlot;
			const nextIndex = currentIndex === 0 ? 1 : 0;
			const currentSlot = this.detailTitleSlots[currentIndex];
			const nextSlot = this.detailTitleSlots[nextIndex];
			if (!currentSlot || !nextSlot) return;

			nextSlot.textContent = nextTitle;
			nextSlot.title = nextTitle;
			nextSlot.setAttribute("aria-hidden", "false");
			currentSlot.setAttribute("aria-hidden", "true");
			nextSlot.classList.add("is-current");
			currentSlot.classList.remove("is-current");
			this.activeTitleSlot = nextIndex;
		});
	}

	private navigateToHeading(event: Event): void {
		const target = event.target as Element | null;
		const item = target?.closest<HTMLElement>("[data-outline-target]");
		if (!item) return;

		const heading = this.headings[Number(item.dataset.outlineTarget)];
		if (!heading) return;

		event.preventDefault();
		window.tocInternalNavigation = true;
		if (heading.element.id) {
			const destination = new URL(window.location.href);
			destination.hash = heading.element.id;
			window.history.pushState(null, "", destination);
		}
		window.scrollTo({
			top: heading.absoluteTop - READING_OFFSET,
			behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
				? "auto"
				: "smooth",
		});
	}

	private expand(): void {
		if (this.collapseTimer) clearTimeout(this.collapseTimer);
		this.collapseTimer = null;
		this.cancelBarCharge();
		this.root.classList.add("is-expanded");
		this.browsePanel?.setAttribute("aria-hidden", "false");
		this.syncDetailAccessibility();
	}

	private syncDetailAccessibility(): void {
		const hidden =
			this.isScrolling || this.root.classList.contains("is-expanded");
		this.detailPanel?.setAttribute("aria-hidden", String(hidden));
	}

	private scheduleCollapse(): void {
		if (this.collapseTimer) clearTimeout(this.collapseTimer);
		if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
			this.root.classList.remove("is-expanded");
			this.browsePanel?.setAttribute("aria-hidden", "true");
			this.cancelBarCharge();
			this.syncDetailAccessibility();
			return;
		}
		this.collapseTimer = setTimeout(() => {
			if (this.root.matches(":hover, :focus-within")) {
				this.collapseTimer = null;
				return;
			}
			this.root.classList.remove("is-expanded");
			this.browsePanel?.setAttribute("aria-hidden", "true");
			this.startBarCharge();
			this.syncDetailAccessibility();
			this.collapseTimer = null;
		}, COLLAPSE_DELAY);
	}

	private startBarCharge(): void {
		this.cancelBarCharge();
		if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

		const barCount = this.minimap?.querySelectorAll<HTMLElement>(
			".article-outline-rail__heading-mark, .article-outline-rail__body-tick",
		).length;
		if (!barCount) return;

		this.root.classList.add("is-charging");
		this.chargeTimer = setTimeout(
			() => {
				this.root.classList.remove("is-charging");
				this.chargeTimer = null;
			},
			BAR_CHARGE_DURATION + (barCount - 1) * BAR_CHARGE_STEP,
		);
	}

	private cancelBarCharge(): void {
		if (this.chargeTimer) clearTimeout(this.chargeTimer);
		this.chargeTimer = null;
		this.root.classList.remove("is-charging");
	}
}

export class ArticleOutlineRailRuntime {
	private readonly abortController = new AbortController();
	private controller: ArticleOutlineRailController | null = null;

	public start(): void {
		// 首次加载 + 每次导航各挂一次，容器替换前拆掉：时序统一交给 swup-lifecycle
		definePageIsland({
			name: "article-outline-rail",
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
		const root = document.getElementById("article-outline-rail");
		if (!root) return;

		const controller = new ArticleOutlineRailController(root);
		if (controller.init()) this.controller = controller;
	}

	private destroyCurrent(): void {
		this.controller?.destroy();
		this.controller = null;
	}
}
