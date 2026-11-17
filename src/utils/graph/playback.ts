import { clamp, easeOutCubic } from "./geometry";
import type { Scene } from "./scene";
import type { GraphTier, PlaybackState, SceneNode } from "./types";

/** 绽放收笔的硬上限（ms）：用户规格 1.5s 内完成 */
const BLOOM_MAX_MS = 1_500;

/** 每层起跑延迟（ms）：分类先就位，标签、文章、标题像花瓣一样依次抽出 */
const TIER_DELAY: Record<GraphTier, number> = {
	category: 0,
	tag: 180,
	post: 380,
	heading: 600,
};

/** 单个节点绕父节点飞到落点的时长（ms） */
const TIER_FLIGHT: Record<GraphTier, number> = {
	category: 480,
	tag: 660,
	post: 680,
	heading: 620,
};

/** 起飞偏角（rad）：沿绕父节点的弧线扫向落点，落地时归零 = 旋转展开 */
const TIER_SPIN: Record<GraphTier, number> = {
	category: 0.5,
	tag: 1,
	post: 0.8,
	heading: 0.6,
};

/** 同层起跑抖动上限（ms）：同簇分支错开一点，避免齐射感 */
const JITTER_MS = 90;

/** 连线延迟窗口（ms）：揭示时间戳回拨到它之前，落地后整线即齐备 */
const LINE_SETTLE_MS = 4_000;

type BloomSpec = {
	fromX: number;
	fromY: number;
	toX: number;
	toY: number;
	baseAngle: number;
	spin: number;
	distance: number;
	delay: number;
	flight: number;
};

/** FNV-1a 字符串散列 → 0..1，给每个节点确定性的旋角与起跑抖动 */
function hashOf(value: string): number {
	let hash = 2166136261;
	for (let i = 0; i < value.length; i++) {
		hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
	}
	return (hash >>> 0) / 4294967295;
}

export type Playback = {
	/** 播放中 = 立即落地收尾；未播放 = 从头绽放一遍 */
	toggle(): void;
	restart(): void;
	getState(): PlaybackState;
	/** 推进绽放时间线并更新节点坐标与揭示进度；返回是否需要重绘 */
	tick(dt: number): boolean;
	/** 立即收尾：跳到所有落点并结束播放（拖拽 / 筛选打断入场时用） */
	finish(): void;
	setReducedMotion(value: boolean): void;
};

/**
 * 入场绽放控制器。
 *
 * 每个节点从父节点的落点起飞，沿一条弧线旋转扫向自己的落点：
 * 分类从画布中心向外，标签从分类、文章从主标签、标题从文章逐层抽出，
 * 配合层级延迟形成「花蕊 → 花瓣 → 枝叶」的展开节奏。位置补间与揭示
 * 进度同源，所以节点是边飞边长、连线始终连着正在伸展的端点。
 */
export function createPlayback(scene: Scene, onChange: () => void): Playback {
	const state: PlaybackState = { playing: false, position: 1 };
	const specs = new Map<string, BloomSpec>();
	let reducedMotion = false;
	let elapsed = 0;
	let total = 0;

	// 初始即「已落幕」：位置由预收敛布局给出，揭示完成时间回拨，
	// 保证减少动画偏好下连线直接齐备
	const settledAt = performance.now() - LINE_SETTLE_MS;
	for (const node of scene.nodes) {
		node.reveal = 1;
		node.revealed = true;
		node.revealedAt = settledAt;
	}

	/** 起飞点 = 父节点落点。分类没有父节点，从画布中心起飞 */
	const parentOf = (node: SceneNode): SceneNode | null => {
		if (node.tier === "category") return null;
		if (node.tier === "tag") {
			return scene.nodeMap.get(node.data.categoryId) ?? null;
		}
		if (node.tier === "heading") {
			for (const id of node.parents) {
				const parent = scene.nodeMap.get(id);
				if (parent?.tier === "post") return parent;
			}
			return null;
		}
		// 文章取权重最大的标签父节点；没有标签就回退所属分类
		let best: SceneNode | null = null;
		for (const id of node.parents) {
			const parent = scene.nodeMap.get(id);
			if (parent?.tier !== "tag") continue;
			if (!best || parent.data.value > best.data.value) best = parent;
		}
		return best ?? scene.nodeMap.get(node.data.categoryId) ?? null;
	};

	const apply = (time: number): void => {
		for (const node of scene.nodes) {
			const spec = specs.get(node.data.id);
			if (!spec) continue;
			const progress = clamp((time - spec.delay) / spec.flight, 0, 1);
			const eased = easeOutCubic(progress);
			const angle = spec.baseAngle + spec.spin * (1 - eased);
			const radius = spec.distance * eased;
			node.x = spec.fromX + Math.cos(angle) * radius;
			node.y = spec.fromY + Math.sin(angle) * radius;
			node.reveal = eased;
			node.revealed = progress > 0;
		}
	};

	/** 瞬间落到所有目标点，不触发事件（start 复用，避免中途重启跳变） */
	const settle = (): void => {
		const now = performance.now() - LINE_SETTLE_MS;
		for (const [id, spec] of specs) {
			const node = scene.nodeMap.get(id);
			if (!node) continue;
			node.x = spec.toX;
			node.y = spec.toY;
			node.reveal = 1;
			node.revealed = true;
			node.revealedAt = now;
		}
		specs.clear();
		scene.blooming = false;
	};

	const complete = (): void => {
		settle();
		state.position = 1;
		state.playing = false;
		onChange();
	};

	const start = (): void => {
		// 上一轮还在飞就先把它们落回来，否则快照落点会取到半空坐标
		if (specs.size > 0) settle();

		const pivotX = scene.width / 2;
		const pivotY = scene.height / 2;
		total = 0;
		for (const node of scene.nodes) {
			const parent = parentOf(node);
			const fromX = parent?.x ?? pivotX;
			const fromY = parent?.y ?? pivotY;
			const toX = node.x ?? fromX;
			const toY = node.y ?? fromY;
			const dx = toX - fromX;
			const dy = toY - fromY;
			const spinHash = hashOf(node.data.id);
			const delayHash = hashOf(`delay:${node.data.id}`);
			const delay = TIER_DELAY[node.tier] + delayHash * JITTER_MS;
			const flight = TIER_FLIGHT[node.tier];
			specs.set(node.data.id, {
				fromX,
				fromY,
				toX,
				toY,
				baseAngle: Math.atan2(dy, dx),
				spin: TIER_SPIN[node.tier] * (0.75 + spinHash * 0.5),
				distance: Math.hypot(dx, dy),
				delay,
				flight,
			});
			total = Math.max(total, delay + flight);
		}
		total = Math.min(total, BLOOM_MAX_MS);
		elapsed = 0;
		state.position = 0;
		state.playing = true;
		scene.blooming = true;
		apply(0);
	};

	return {
		toggle() {
			if (state.playing) {
				complete();
				return;
			}
			start();
			onChange();
		},
		restart() {
			start();
			onChange();
		},
		getState() {
			return { ...state };
		},
		tick(dt) {
			if (!state.playing) return false;
			elapsed += dt;
			state.position = clamp(elapsed / Math.max(1, total), 0, 1);
			apply(elapsed);
			if (elapsed >= total) complete();
			return true;
		},
		finish() {
			if (specs.size === 0) return;
			complete();
		},
		setReducedMotion(value) {
			reducedMotion = value;
			if (reducedMotion && specs.size > 0) {
				complete();
			}
		},
	};
}
