/**
 * 灵动岛小形象（PetFace）——移植自 wisland/ui/compact.py。
 *
 * 极简「发光双眼」：默认东张西望、困倦、眨眼；鼠标靠近随机换表情
 * （happy / wink / love / star / shy / pout / squint），新消息惊讶。
 * 这里把 QPainter 的绘制换成对其 SVG DOM 节点的逐帧更新，弹簧参数照搬。
 */
import { Spring, clamp } from "@/utils/island-physics";

export type PetMood =
	| "default"
	| "happy"
	| "wink"
	| "love"
	| "star"
	| "shy"
	| "pout"
	| "squint"
	| "laugh"
	| "surprise";

const MOODS: PetMood[] = ["happy", "wink", "love", "star", "shy", "pout", "squint"];

export class PetFace {
	private readonly ex = new Spring(0, 140, 0.8, 0.01);
	private readonly ey = new Spring(0, 140, 0.8, 0.01);
	private readonly wide = new Spring(0, 220, 0.45, 0.003);
	private readonly morph = new Spring(0, 200, 0.7, 0.003);
	private readonly blush = new Spring(0, 120, 0.9, 0.003);
	private readonly happyL = new Spring(0, 160, 0.75, 0.003);
	private readonly happyR = new Spring(0, 160, 0.75, 0.003);

	private mood: PetMood = "default";
	private lastMood = "";
	private near = false;
	private blinkAt: number;
	private surpriseUntil = 0;
	private lastAttention: number;

	constructor(now: number) {
		this.lastAttention = now;
		this.blinkAt = now + 2.5;
	}

	react(now: number): void {
		this.lastAttention = now;
		this.surpriseUntil = now + 1.4;
		this.wide.v += 9;
	}

	step(dt: number, now: number, look: { x: number; y: number }, near: boolean, scale = 1): PetFrame {
		if (near && !this.near) {
			const choices = MOODS.filter((m) => m !== this.lastMood);
			this.mood = choices[Math.floor(Math.random() * choices.length)] ?? "happy";
			this.lastMood = this.mood;
		} else if (!near && this.near) {
			this.mood = "default";
		}
		this.near = near;
		if (near) this.lastAttention = now;
		let mood = near ? this.mood : "default";
		if (now < this.surpriseUntil) mood = "surprise";

		// 视线：无人时缓慢游走，有人靠近时看向光标
		const tx = !near && Math.abs(look.x) > 420 * scale
			? Math.sin(now * 0.55) * 0.8 + Math.sin(now * 1.7) * 0.15
			: clamp(look.x / (90 * scale), -1, 1);
		const ty = !near && Math.abs(look.x) > 420 * scale
			? Math.sin(now * 0.37) * 0.35
			: clamp(look.y / (60 * scale), -1, 1);
		const gazeX = mood === "shy" ? tx * 0.3 + 0.5 : tx;
		const gazeY = mood === "shy" ? 0.75 : ty;
		this.ex.to(gazeX);
		this.ey.to(gazeY);

		this.happyL.to(mood === "wink" ? 0 : mood === "happy" || mood === "laugh" || mood === "shy" ? 1 : 0);
		this.happyR.to(mood === "happy" || mood === "laugh" || mood === "shy" ? 1 : 0.55 * (mood === "wink" ? 1 : 0));
		this.wide.to(mood === "star" ? 0.3 : mood === "surprise" ? 0.35 : 0);
		this.morph.to(mood === "love" || mood === "squint" || mood === "pout" ? 1 : 0);
		this.blush.to(mood === "shy" ? 1 : mood === "love" ? 0.8 : mood === "happy" || mood === "laugh" ? 0.55 : mood === "wink" ? 0.45 : 0);
		for (const sp of [this.ex, this.ey, this.wide, this.morph, this.blush, this.happyL, this.happyR]) sp.step(dt);

		// 眨眼：特殊表情不眨
		const dur = 0.16;
		if (now >= this.blinkAt + dur) {
			const gap = 2.4 + (Math.sin(now * 12.9898) * 0.5 + 0.5) * 3.2;
			this.blinkAt = now + gap * (this.tired(now, mood) > 0.3 ? 1.6 : 1);
		}
		const blink = this.blinkAt <= now && now < this.blinkAt + dur &&
			["default", "pout", "shy", "star"].includes(mood)
			? Math.sin(((now - this.blinkAt) / dur) * Math.PI)
			: 0;

		const tired = this.tired(now, mood);
		const bounce = mood === "laugh" ? Math.sin(now * 16) * 1.6 * scale : 0;
		return this.render(mood, blink, tired, bounce, scale);
	}

	private tired(now: number, mood: string): number {
		return now - this.lastAttention > 60 && mood === "default" ? 0.55 : 0;
	}

	/** 生成驱动 SVG 的属性集合；返回 null 表示隐藏。 */
	private render(mood: PetMood, blink: number, tired: number, bounce: number, scale: number): PetFrame {
		const wide = clamp(this.wide.x, -0.3, 1);
		const morph = clamp(this.morph.x, 0, 1);
		const lx = this.ex.x;
		const ly = this.ey.x;
		const baseW = 14 * scale;
		const baseH = 20 * scale;
		const gap = 18 * scale;
		const eyeY = ly * 3 * scale + bounce;
		const makeEye = (side: -1 | 1): EyeFrame => {
			const happy = clamp(side < 0 ? this.happyL.x : this.happyR.x, 0, 1);
			const curious = 1 + 0.22 * Math.max(0, lx * side);
			const width = baseW * (1 + 0.12 * wide) * (1 + 0.25 * blink);
			const height = baseH * curious * (1 + 0.18 * wide) * (1 - 0.88 * blink) * (1 - 0.85 * tired) * (1 - 0.55 * happy);
			return {
				cx: side * (gap / 2 + baseW / 2) + lx * 5 * scale,
				cy: eyeY,
				w: width,
				h: Math.max(1.6 * scale, height),
				happy,
			};
		};
		return {
			mood,
			morph,
			wide,
			blink,
			blush: clamp(this.blush.x, 0, 1),
			left: makeEye(-1),
			right: makeEye(1),
			mouthX: lx * 5 * scale,
			mouthY: baseH * 0.66 + ly * 3 * scale + bounce,
		};
	}
}

export interface EyeFrame {
	cx: number;
	cy: number;
	w: number;
	h: number;
	happy: number;
}

export interface PetFrame {
	mood: PetMood;
	morph: number;
	wide: number;
	blink: number;
	blush: number;
	left: EyeFrame;
	right: EyeFrame;
	mouthX: number;
	mouthY: number;
}
