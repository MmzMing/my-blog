type OutlineLevel = 1 | 2 | 3;

interface OutlineHeading {
	index: number;
	level: OutlineLevel;
	text: string;
	element: HTMLElement;
	path: Partial<Record<OutlineLevel, OutlineHeading>>;
	absoluteTop: number;
	sectionEnd: number;
}

const READING_OFFSET = 80;
const MINIMAP_TICK_BUDGET = 48;
const MAX_TICKS_PER_SECTION = 12;
const COLLAPSE_DELAY = 250;
const MIN_HEADING_MARK_WIDTH = 1.5;
const MAX_HEADING_MARK_WIDTH = 4;
const HEADING_MARK_WIDTH_PER_CHARACTER = 0.16;
const SUMMARY_EDGE_GUTTER = 64;

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
	private readonly minimap: HTMLElement | null;
	private readonly browsePanel: HTMLElement | null;
	private readonly browseList: HTMLElement | null;
	private readonly progressRegion: HTMLElement | null;
	private readonly progressLabel: HTMLElement | null;
	private article: HTMLElement | null = null;
	private headings: OutlineHeading[] = [];
	private activeIndex = -1;
	private activeRailBar: HTMLElement | null = null;
	private articleStart = 0;
	private articleEnd = 0;
	private railStart = 0;
	private railEnd = 0;
	private railHeight = 0;
	private lastProgressPercent = -1;
	private animationFrame: number | null = null;
	private measureFrame: number | null = null;
	private collapseTimer: ReturnType<typeof setTimeout> | null = null;
	private resizeObserver: ResizeObserver | null = null;

	constructor(root: HTMLElement) {
		this.root = root;
		this.detailPanel = root.querySelector("[data-outline-details]");
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
		window.addEventListener("scroll", () => this.scheduleUpdate(), {
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
		this.animationFrame = null;
		this.measureFrame = null;
		this.collapseTimer = null;
	}

	private collectHeadings(): boolean {
		if (!this.article) return false;

		const path: Partial<Record<OutlineLevel, OutlineHeading>> = {};
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
				path: {},
				absoluteTop: 0,
				sectionEnd: 0,
			};

			path[level] = heading;
			if (level === 1) {
				delete path[2];
				delete path[3];
			} else if (level === 2) {
				delete path[3];
			}
			heading.path = { ...path };
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

			const bodyTicks = document.createElement("span");
			bodyTicks.className = "article-outline-rail__body-ticks";
			for (let tickIndex = 1; tickIndex < tickCount; tickIndex += 1) {
				const tick = document.createElement("span");
				tick.className = "article-outline-rail__body-tick";
				tick.dataset.outlineLevel = "4";
				bodyTicks.appendChild(tick);
			}
			segment.appendChild(bodyTicks);
			fragment.appendChild(segment);
		});

		this.minimap.style.setProperty(
			"--article-outline-row-count",
			String(rowCount),
		);
		this.minimap.replaceChildren(fragment);
		this.activeRailBar = null;
	}

	private cacheRailGeometry(): void {
		if (!this.minimap) return;

		const bars = this.minimap.querySelectorAll<HTMLElement>(
			".article-outline-rail__heading-mark, .article-outline-rail__body-tick",
		);
		const firstBar = bars.item(0);
		const lastBar = bars.item(bars.length - 1);
		const minimapRect = this.minimap.getBoundingClientRect();
		this.railHeight = minimapRect.height;
		if (!firstBar || !lastBar) {
			this.railStart = 0;
			this.railEnd = 0;
			return;
		}

		const firstRect = firstBar.getBoundingClientRect();
		const lastRect = lastBar.getBoundingClientRect();
		this.railStart = firstRect.top - minimapRect.top + firstRect.height / 2;
		this.railEnd = lastRect.top - minimapRect.top + lastRect.height / 2;
	}

	private renderBrowseList(): void {
		if (!this.browseList) return;

		const fragment = document.createDocumentFragment();
		this.headings.forEach((heading) => {
			const item = document.createElement("a");
			item.className = "article-outline-rail__browse-item";
			item.style.borderRadius = "0.5rem";
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
			this.syncActiveHeading(this.headings[nextActiveIndex]);
		}
		this.syncActiveRailBar(this.headings[nextActiveIndex]);
	}

	private syncReadingProgress(progress: number): void {
		const readerCenter =
			this.railStart + (this.railEnd - this.railStart) * progress;
		const summaryPosition = clamp(
			readerCenter,
			SUMMARY_EDGE_GUTTER,
			Math.max(SUMMARY_EDGE_GUTTER, this.railHeight - SUMMARY_EDGE_GUTTER),
		);

		this.root.style.setProperty("--article-outline-progress", String(progress));
		this.root.style.setProperty(
			"--article-outline-summary-y",
			`${summaryPosition}px`,
		);

		const progressPercent = Math.round(progress * 100);
		if (progressPercent === this.lastProgressPercent) return;

		this.lastProgressPercent = progressPercent;
		this.progressRegion?.setAttribute("aria-valuenow", String(progressPercent));
		if (this.progressLabel)
			this.progressLabel.textContent = `${progressPercent}%`;
	}

	private syncActiveRailBar(activeHeading: OutlineHeading): void {
		if (!this.minimap) return;
		const segment = this.minimap.querySelector<HTMLElement>(
			`.article-outline-rail__segment[data-outline-index="${activeHeading.index}"]`,
		);
		if (!segment) return;

		const bars = Array.from(
			segment.querySelectorAll<HTMLElement>(
				".article-outline-rail__heading-mark, .article-outline-rail__body-tick",
			),
		);
		if (!bars.length) return;

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
		if (nextActiveRailBar === this.activeRailBar) return;

		this.activeRailBar?.classList.remove("is-active");
		nextActiveRailBar.classList.add("is-active");
		this.activeRailBar = nextActiveRailBar;
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

		([1, 2, 3] as const).forEach((level) => {
			const line = this.root.querySelector<HTMLElement>(
				`[data-outline-detail="${level}"]`,
			);
			const title = line?.querySelector<HTMLElement>(
				"[data-outline-detail-title]",
			);
			const heading = activeHeading.path[level];
			if (!line || !title) return;

			line.classList.toggle("is-empty", !heading);
			line.classList.toggle(
				"is-active",
				heading?.index === activeHeading.index,
			);
			title.textContent = heading?.text ?? "";
			title.title = heading?.text ?? "";
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
		this.root.classList.add("is-expanded");
		this.detailPanel?.setAttribute("aria-hidden", "true");
		this.browsePanel?.setAttribute("aria-hidden", "false");
	}

	private scheduleCollapse(): void {
		if (this.collapseTimer) clearTimeout(this.collapseTimer);
		if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
			this.root.classList.remove("is-expanded");
			this.detailPanel?.setAttribute("aria-hidden", "false");
			this.browsePanel?.setAttribute("aria-hidden", "true");
			return;
		}
		this.collapseTimer = setTimeout(() => {
			if (this.root.matches(":hover, :focus-within")) {
				this.collapseTimer = null;
				return;
			}
			this.root.classList.remove("is-expanded");
			this.detailPanel?.setAttribute("aria-hidden", "false");
			this.browsePanel?.setAttribute("aria-hidden", "true");
			this.collapseTimer = null;
		}, COLLAPSE_DELAY);
	}
}

export class ArticleOutlineRailRuntime {
	private readonly abortController = new AbortController();
	private controller: ArticleOutlineRailController | null = null;

	public start(): void {
		document.addEventListener(
			"astro:before-swap",
			() => this.destroyCurrent(),
			{
				signal: this.abortController.signal,
			},
		);
		document.addEventListener("astro:page-load", () => this.initialize(), {
			signal: this.abortController.signal,
		});
		document.addEventListener("password:decrypted", () => this.initialize(), {
			signal: this.abortController.signal,
		});
		this.initialize();
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
