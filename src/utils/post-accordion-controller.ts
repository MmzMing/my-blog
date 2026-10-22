/**
 * 文章元信息手风琴的展开/收起。
 *
 * 多路独立开合（不是单开互斥）：五层里分类、介绍、封面默认都是展开的，
 * 收起其中一层不应该把别层一起关掉。高度与淡入淡出走 CSS（post-accordion.css），
 * 这里只翻 data-open 与 aria-expanded；收起的面板靠 CSS visibility 退出无障碍树。
 */

const ITEM_SELECTOR = "[data-post-accordion-item]";
const HEADER_SELECTOR = ".post-accordion__header";

export function mountPostAccordion(
	root: ParentNode = document,
	itemSelector: string = ITEM_SELECTOR,
): () => void {
	const items = Array.from(root.querySelectorAll<HTMLElement>(itemSelector));
	if (items.length === 0) return () => {};

	const abortController = new AbortController();

	for (const item of items) {
		const header = item.querySelector<HTMLButtonElement>(HEADER_SELECTOR);
		if (!header) continue;
		header.addEventListener(
			"click",
			() => {
				const open = item.toggleAttribute("data-open");
				header.setAttribute("aria-expanded", String(open));
			},
			{ signal: abortController.signal },
		);
	}

	return () => abortController.abort();
}
