/**
 * 左下角角色的想法气泡：角色入场时自动冒第一句，点角色或气泡换下一句（末句后从头循环）。
 * 角色与问候气泡都由 hero 滚动时间线驱动（setSceneVisible / setGreetingVisible），
 * 所以回滚后再次入场还会重新打招呼，不会只剩一个不说话的角色。
 * 气泡不自动收起：收起只有「滚离这段剧情」和「点开下一句」两种途径。
 */

/** 挤压玩偶的一次性回弹，transform 与悬停的 scale 叠乘，互不覆盖 */
const SQUISH_KEYFRAMES: Keyframe[] = [
	{ offset: 0, transform: "scale(1, 1)" },
	{ offset: 0.18, transform: "scale(1.16, 0.8)" },
	{ offset: 0.42, transform: "scale(0.92, 1.08)" },
	{ offset: 0.62, transform: "scale(1.06, 0.94)" },
	{ offset: 0.82, transform: "scale(0.98, 1.02)" },
	{ offset: 1, transform: "scale(1, 1)" },
];
const SQUISH_DURATION = 560;
const SQUISH_EASING = "cubic-bezier(0.36, 0.9, 0.32, 1)";

export type HomeHeroDialogueController = {
	setSceneVisible: (visible: boolean) => void;
	setGreetingVisible: (visible: boolean) => void;
	destroy: () => void;
};

function parseLines(root: HTMLElement): string[] {
	try {
		const raw: unknown = JSON.parse(root.dataset.lines ?? "");
		if (!Array.isArray(raw)) return [];
		return raw.filter(
			(line): line is string => typeof line === "string" && line.length > 0,
		);
	} catch {
		return [];
	}
}

export function initHomeHeroDialogue(
	root: HTMLElement | null,
): HomeHeroDialogueController {
	const anchor = root?.querySelector<HTMLElement>("[data-dialogue-anchor]");
	const bubble = root?.querySelector<HTMLElement>("[data-dialogue-bubble]");
	const sticker = root?.querySelector<HTMLElement>("[data-hero-sticker]");
	const lines = root ? parseLines(root) : [];
	if (!root || !anchor || !bubble || lines.length === 0) {
		return {
			setSceneVisible: () => undefined,
			setGreetingVisible: () => undefined,
			destroy: () => undefined,
		};
	}

	const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
	const abortController = new AbortController();
	let sceneVisible = false;
	let greetingVisible = false;
	let nextIndex = 0;

	const close = () => {
		bubble.dataset.open = "false";
	};

	const showNext = () => {
		const line = lines[nextIndex];
		nextIndex = (nextIndex + 1) % lines.length;
		bubble.textContent = line;
		bubble.dataset.open = "true";
		// 每句都从角色头顶重新「冒」一次；transition 做不到从已打开的状态重播，交给 WAAPI
		if (!reducedMotion.matches) {
			bubble.animate(
				[
					{ opacity: 0, scale: 0.55 },
					{ opacity: 1, scale: 1 },
				],
				{ duration: 420, easing: "cubic-bezier(0.34, 1.56, 0.64, 1)" },
			);
		}
	};

	const squish = () => {
		if (reducedMotion.matches || !sticker) return;
		sticker.animate(SQUISH_KEYFRAMES, {
			duration: SQUISH_DURATION,
			easing: SQUISH_EASING,
		});
	};

	anchor.addEventListener(
		"click",
		() => {
			if (!sceneVisible) return;
			squish();
			showNext();
		},
		{ signal: abortController.signal },
	);

	return {
		setSceneVisible(visible) {
			if (sceneVisible === visible) return;
			sceneVisible = visible;
			root.dataset.sceneVisible = String(visible);
			if (!visible) close();
		},
		setGreetingVisible(visible) {
			if (greetingVisible === visible) return;
			greetingVisible = visible;
			if (!visible) {
				close();
				return;
			}
			nextIndex = 0;
			// 角色刚离开底边就打招呼，和升起动作叠在一起才不像两段独立动画
			if (sceneVisible) showNext();
		},
		destroy() {
			abortController.abort();
			close();
			bubble.textContent = "";
			root.dataset.sceneVisible = "false";
			greetingVisible = false;
			nextIndex = 0;
		},
	};
}
