/**
 * 收款码卡片的触屏揭示。
 *
 * 桌面端靠 CSS `:hover` / `:focus-visible` 解除模糊遮罩，纯样式即可；触屏没有
 * hover，模糊的收款码就永远解不开。这里只在 `(hover: none)` 的环境下接管点击，
 * 给卡片挂一个 `--revealed` 类，避免桌面端点一下之后鼠标移开仍停在揭示态。
 */

const CARD_SELECTOR = "[data-sponsor-qr-card]";
const REVEALED_CLASS = "sponsor-qr-card--revealed";

let revealAbort: AbortController | undefined;

export function mountSponsorQrReveal(): void {
	if (revealAbort) return;
	if (!window.matchMedia("(hover: none)").matches) return;
	if (!document.querySelector(CARD_SELECTOR)) return;

	revealAbort = new AbortController();
	document.addEventListener(
		"click",
		(event) => {
			if (!(event.target instanceof Element)) return;
			const card = event.target.closest(CARD_SELECTOR);
			if (!card) return;

			const wasRevealed = card.classList.contains(REVEALED_CLASS);
			for (const sibling of document.querySelectorAll(CARD_SELECTOR)) {
				sibling.classList.remove(REVEALED_CLASS);
			}
			if (!wasRevealed) card.classList.add(REVEALED_CLASS);
		},
		{ signal: revealAbort.signal },
	);
}

export function unmountSponsorQrReveal(): void {
	revealAbort?.abort();
	revealAbort = undefined;
}
