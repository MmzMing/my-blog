import { clamp } from "./geometry";
import type { Scene } from "./scene";
import type { PlaybackState } from "./types";

/** 1× 扫完全程的时长。默认可见的 89 个节点摊到约 66ms 一个，配合
    REVEAL_SLOTS 得到约 200ms 的泡泡、同时最多 3 个在冒。再短泡泡来不及
    看清，再长入场就拖沓 */
const DURATION_MS = 6_000;
/** 单个节点入场动画在时间轴上占据的「槽位」数。取 3 意味着最多 3 个节点
    同时在冒 —— 原来取 10，又叠加下面「按全量节点排槽位」的问题，观感就是
    成片蹦出来而不是一颗一颗冒。要更从容就加大它，但会拉长单个节点的时长 */
const REVEAL_SLOTS = 3;

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

	/**
	 * 关键：reveal 是播放头的纯函数，不是有状态补间。播放头映射到「节点槽位」
	 * 而不是时间戳 —— 文章发布时间分布极不均匀，按时间戳映射会出现长时间空窗
	 * 后节点成片涌出，按槽位映射才能匀速逐个出现。
	 *
	 * 槽位只发给「当前可见」的节点。把被筛掉的也排进去（默认关着小标题层，
	 * 330 个节点里 241 个不可见），播放头就有七成时间在看不见的节点上空转，
	 * 剩下那 89 个可见节点于是挤成几簇冒出来 —— 这才是「一起冒出来」的根因，
	 * 光调重叠槽位数治不了。
	 */
	const applyReveal = (): void => {
		const now = performance.now();
		// position=1 时全部揭示，省掉整轮排槽位
		if (state.position >= 1) {
			for (const node of scene.nodes) {
				node.reveal = 1;
				node.revealed = true;
				if (!node.revealedAt) node.revealedAt = now;
			}
			return;
		}

		let visible = 0;
		for (const node of order) node.revealSlot = node.filtered ? visible++ : -1;
		const totalSlots = Math.max(1, visible - 1 + REVEAL_SLOTS);
		const cursor = state.position * totalSlots;
		const window = reducedMotion ? 1 : REVEAL_SLOTS;

		for (const node of scene.nodes) {
			// 被筛掉的节点槽位是 -1，算出来的 reveal 无意义但也画不到，不管
			const progress = clamp((cursor - node.revealSlot) / window, 0, 1);
			node.reveal = progress;
			node.revealed = progress > 0;
			// 记下这个节点画完的时刻：连线按自己两端的较晚者决定何时起笔。
			// 往回擦（重播）时要清掉，否则旧时间戳会让线提前冒出来
			node.revealedAt = progress >= 1 ? node.revealedAt || now : 0;
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
