interface ArticleListHighlightOptions {
	grid: HTMLElement;
	signal: AbortSignal;
}

const CARD_SELECTOR = "[data-article-list-card]";

/**
 * 文章列表的悬停高亮：一根浮层胶囊在卡片之间滑动，尺寸跟随当前卡。
 *
 * 与归档树是同一套做法（量目标 rect → 写 transform + 宽高），差别在于这里是多列网格，
 * 胶囊会跨列斜向移动，所以首次落位把过渡时长清零，避免它从上一张卡的位置横穿过来；
 * 卡片高度又不一致（封面可选、描述固定三行截断），宽高必须逐次量，不能只滑 Y 轴。
 */
export function createArticleListHighlight(
	options: ArticleListHighlightOptions,
): void {
	const { grid, signal } = options;
	const highlight = grid.querySelector<HTMLElement>(
		"[data-article-list-highlight]",
	);
	if (highlight) attachHighlight(grid, highlight, signal);
}

// 单独拆一层：闭包里读不到外层 if 对 highlight 的收窄，只能把它当非空参数接进来。
function attachHighlight(
	grid: HTMLElement,
	highlight: HTMLElement,
	signal: AbortSignal,
): void {
	let highlightedCard: HTMLElement | null = null;

	// 这里只负责把胶囊摆成卡片矩形本身，四周的间隙由 CSS 的 padding + 负 margin 撑开。
	function moveTo(card: HTMLElement): void {
		if (card === highlightedCard) return;
		const bounds = grid.getBoundingClientRect();
		const target = card.getBoundingClientRect();
		highlight.style.transitionDuration = highlightedCard ? "" : "0ms";
		highlight.style.transform = `translate(${target.left - bounds.left}px, ${target.top - bounds.top}px)`;
		highlight.style.width = `${target.width}px`;
		highlight.style.height = `${target.height}px`;
		highlightedCard = card;
		grid.setAttribute("data-highlighted", "");
	}

	function clear(): void {
		if (!highlightedCard) return;
		highlightedCard = null;
		grid.removeAttribute("data-highlighted");
	}

	grid.addEventListener(
		"pointerover",
		(event) => {
			if (event.pointerType === "touch" || !(event.target instanceof Element))
				return;
			const card = event.target.closest<HTMLElement>(CARD_SELECTOR);
			if (card) moveTo(card);
		},
		{ signal },
	);
	grid.addEventListener("pointerleave", clear, { signal });
	grid.addEventListener(
		"focusin",
		(event) => {
			if (!(event.target instanceof Element)) return;
			const card = event.target.closest<HTMLElement>(CARD_SELECTOR);
			if (card) moveTo(card);
		},
		{ signal },
	);
	grid.addEventListener(
		"focusout",
		(event) => {
			if (
				event.relatedTarget instanceof Element &&
				event.relatedTarget.closest(CARD_SELECTOR)
			)
				return;
			clear();
		},
		{ signal },
	);
	// 网格随视口换列数，缓存的位置会失效，重排时直接收起等下一次悬停重新落位。
	window.addEventListener("resize", clear, { signal, passive: true });
}
