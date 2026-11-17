/**
 * 弹窗浮现控制器：让共用 .privacy-modal 外壳的弹窗（公告 / 隐私政策 /
 * 用户协议 / 留言板）从被点击的按钮位置放大、滑到视口中央，而不是原地淡入。
 *
 * 做法参考 my-agent 的 dialog 组件：document 捕获阶段记录最近一次按下
 * 的按钮矩形（800ms 内有效），打开时把按钮中心相对视口中心的偏移与
 * 尺寸比写进面板的 CSS 变量，入场动画从那里起帧。没有近期点击
 * （键盘 / 程序化打开）时清掉变量，回落到 CSS 里「下方轻抬 + 0.96」的兜底。
 */

/** 按下后多久内打开仍算「从这个按钮长出来」 */
const PRESS_TTL_MS = 800;
/** 面板从很小的按钮里展开时，起点缩比的下限 */
const MIN_ORIGIN_SCALE = 0.42;
/** 与 privacy-modal.css 的 max-width: 40rem 对齐 */
const DIALOG_MAX_WIDTH = 640;
/** 会做「从按钮放大滑入」的弹窗；面板选择器与之对应（共用 dialog-morph-in 关键帧） */
const MORPH_DIALOG_SELECTOR = ".privacy-modal, .article-toc-mindmap";
const MORPH_PANEL_SELECTOR = ".privacy-panel, .article-toc-mindmap__panel";

let installed = false;
let lastPress: { rect: DOMRect; at: number } | null = null;

function trackPress(): void {
	document.addEventListener(
		"pointerdown",
		(event) => {
			if (event.button !== 0) return;
			const target = event.target;
			if (!(target instanceof Element)) return;
			// 触发按钮常包着图标/文字，取最近的可点击祖先，拿整个按钮的矩形
			const source =
				target.closest("button, a, [role='button'], [data-dialog-origin]") ??
				target;
			lastPress = {
				rect: source.getBoundingClientRect(),
				at: performance.now(),
			};
		},
		true,
	);
}

function prepareMorph(dialog: HTMLDialogElement): void {
	const panel = dialog.querySelector<HTMLElement>(MORPH_PANEL_SELECTOR);
	if (!panel) return;

	const press = lastPress;
	const fresh =
		press !== null &&
		performance.now() - press.at <= PRESS_TTL_MS &&
		press.rect.width > 0 &&
		press.rect.height > 0;
	// 触发元素必须真的在视口里：程序化 / 被滚出屏幕的元素会让面板从
	// 几万像素外飞来，看起来像没有动画
	const inViewport =
		fresh &&
		press.rect.bottom > 0 &&
		press.rect.top < window.innerHeight &&
		press.rect.right > 0 &&
		press.rect.left < window.innerWidth;
	if (!inViewport) {
		panel.style.removeProperty("--dialog-origin-x");
		panel.style.removeProperty("--dialog-origin-y");
		panel.style.removeProperty("--dialog-origin-scale");
		return;
	}

	// 面板此刻还没显示（display:none），按 CSS 的宽度约束预估实际宽度
	const rootSize =
		Number.parseFloat(getComputedStyle(document.documentElement).fontSize) ||
		16;
	const width = Math.min(window.innerWidth - rootSize * 2, DIALOG_MAX_WIDTH);
	const scale = Math.min(
		1,
		Math.max(MIN_ORIGIN_SCALE, press.rect.width / width),
	);
	const x = press.rect.left + press.rect.width / 2 - window.innerWidth / 2;
	const y = press.rect.top + press.rect.height / 2 - window.innerHeight / 2;
	panel.style.setProperty("--dialog-origin-x", `${x.toFixed(1)}px`);
	panel.style.setProperty("--dialog-origin-y", `${y.toFixed(1)}px`);
	panel.style.setProperty("--dialog-origin-scale", scale.toFixed(3));
}

export function installDialogPresenceController(): void {
	if (installed) return;
	installed = true;
	trackPress();

	// 包一层 showModal：原生 <dialog> 没有打开事件，这是唯一能统一拦截
	// 全部调用点（导航、隐私、协议、留言板）的位置
	const original = HTMLDialogElement.prototype.showModal;
	HTMLDialogElement.prototype.showModal = function patchedShowModal(
		this: HTMLDialogElement,
	): void {
		if (this.matches(MORPH_DIALOG_SELECTOR)) prepareMorph(this);
		original.call(this);
	};
}
