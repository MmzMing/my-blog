import { clamp } from "./geometry";
import type { Scene } from "./scene";
import type { PlaybackState, SceneNode } from "./types";

/** 1× 扫完全程的时长：要求 1-4s 内播完，取中段 3s，
    243 个节点约 80 个/秒，仍是逐个涌入的连续流观感 */
const DURATION_MS = 3_000;
/** 单个节点入场动画在时间轴上占据的「槽位」数。
    大于 1 让相邻节点的入场彼此重叠，形成 Obsidian 那种
    一个个出现、但中间不间断的连续流 */
const REVEAL_SLOTS = 10;

export type Playback = {
	/** 播放中 = 暂停；未播放 = 从头播一遍 */
	toggle(): void;
	restart(): void;
	getState(): PlaybackState;
	/** 推进播放头并重算所有 reveal；返回是否需要重绘 */
	tick(dt: number): boolean;
	setReducedMotion(value: boolean): void;
};

export function createPlayback(scene: Scene, onChange: () => void): Playback {
	const state: PlaybackState = { playing: false, position: 1 };
	let reducedMotion = false;

	/** 播放顺序 = 发布时间升序。sort 稳定，同一篇文章的小标题
	    紧跟在文章节点之后，呈现「文章先出、小节随后」的节奏 */
	const order = [...scene.nodes].sort(
		(a, b) => a.data.publishedAt - b.data.publishedAt,
	);
	const slotOf = new Map<SceneNode, number>(
		order.map((node, index) => [node, index]),
	);
	const totalSlots = Math.max(1, order.length - 1 + REVEAL_SLOTS);

	/**
	 * 关键：reveal 是播放头的纯函数，不是有状态补间。
	 * 播放头映射到「节点槽位」而不是时间戳 —— 文章发布时间分布极不均匀，
	 * 按时间戳映射会出现长时间空窗后节点成片涌出，按槽位映射才能匀速逐个出现。
	 */
	const applyReveal = (): void => {
		// position=1 时全部揭示，省掉一整轮计算
		if (state.position >= 1) {
			for (const node of scene.nodes) {
				node.reveal = 1;
				node.revealed = true;
			}
			return;
		}

		const cursor = state.position * totalSlots;
		const window = reducedMotion ? 1 : REVEAL_SLOTS;

		for (const node of scene.nodes) {
			const progress = clamp((cursor - (slotOf.get(node) ?? 0)) / window, 0, 1);
			node.reveal = progress;
			node.revealed = progress > 0;
		}
	};

	applyReveal();

	return {
		toggle() {
			if (state.playing) {
				state.playing = false;
			} else {
				state.position = 0;
				state.playing = true;
			}
			applyReveal();
			onChange();
		},
		restart() {
			state.position = 0;
			state.playing = true;
			applyReveal();
			onChange();
		},
		getState() {
			return { ...state };
		},
		tick(dt) {
			if (!state.playing) return false;
			state.position = clamp(state.position + dt / DURATION_MS, 0, 1);
			applyReveal();
			if (state.position >= 1) {
				state.playing = false;
				onChange();
			}
			return true;
		},
		setReducedMotion(value) {
			reducedMotion = value;
			applyReveal();
		},
	};
}
