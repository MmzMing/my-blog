/**
 * 灵动岛物理与液态几何。
 *
 * 从 wisland（PySide6）的 anim.py / shape.py 逐条移植到纯 TypeScript：
 * - Spring 阻尼弹簧是全部位移 / 形变的驱动源，参数与来源保持一致；
 * - 贴边一侧用内凹圆角（fillet）把本体和屏幕边缘连成一体；
 * - 拖拽时 neck 液桥拉伸、超过 BREAK 断开并留下缩回的小水滴（drip）；
 * - 高速移动 / 播放律动 / 按压时，本体采样成多边形后做泪滴与波形形变。
 *
 * 本模块是纯函数集合，不碰 DOM，也不引入副作用；坐标约定与来源一致：
 * (u, v) 中 u 沿吸附边、v 垂直离开吸附边（v=0 即屏幕边缘）。
 */

export type Edge = "top" | "bottom" | "left" | "right";

export const K = 0.5523; // 四分之一圆弧的三次贝塞尔近似系数
export const FILLET = 13.0;
export const BREAK = 64.0;
export const JOIN = 30.0;

export function clamp(x: number, lo: number, hi: number): number {
	return x < lo ? lo : x > hi ? hi : x;
}

export function lerp(a: number, b: number, t: number): number {
	return a + (b - a) * t;
}

export function smooth(t: number): number {
	const x = clamp(t, 0, 1);
	return x * x * (3 - 2 * x);
}

export function easeOut(t: number): number {
	const x = clamp(t, 0, 1);
	return 1 - (1 - x) ** 3;
}

export function isHorizontal(edge: Edge): boolean {
	return edge === "top" || edge === "bottom";
}

/** 阻尼弹簧，ratio < 1 时带弹性回弹；step 内部按 1/240 子步积分保证稳定。 */
export class Spring {
	x: number;
	v = 0;
	target: number;
	k: number;
	c: number;
	eps: number;

	constructor(value = 0, stiffness = 300, ratio = 0.8, eps = 0.05) {
		this.x = value;
		this.target = value;
		this.k = stiffness;
		this.c = 2 * ratio * Math.sqrt(stiffness);
		this.eps = eps;
	}

	tune(stiffness: number, ratio: number): void {
		this.k = stiffness;
		this.c = 2 * ratio * Math.sqrt(stiffness);
	}

	to(target: number, stiffness?: number, ratio?: number): void {
		this.target = target;
		if (stiffness !== undefined) {
			const currentRatio = this.c / (2 * Math.sqrt(this.k));
			this.tune(stiffness, ratio ?? currentRatio);
		}
	}

	snap(value: number): void {
		this.x = value;
		this.target = value;
		this.v = 0;
	}

	step(dt: number): void {
		if (this.rest) {
			this.x = this.target;
			this.v = 0;
			return;
		}
		const n = Math.max(1, Math.ceil(dt / (1 / 240)));
		const h = dt / n;
		for (let i = 0; i < n; i++) {
			const a = -this.k * (this.x - this.target) - this.c * this.v;
			this.v += a * h;
			this.x += this.v * h;
		}
	}

	get rest(): boolean {
		return Math.abs(this.x - this.target) < this.eps && Math.abs(this.v) < this.eps * 8;
	}
}

export interface Rect {
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface Point {
	x: number;
	y: number;
}

export type Radii = [number, number, number, number]; // tl, tr, br, bl

/** (u, v) -> 屏幕坐标；line 是吸附边所在的屏幕线。 */
export function edgeMap(edge: Edge, line: number): (u: number, v: number) => Point {
	switch (edge) {
		case "top":
			return (u, v) => ({ x: u, y: line + v });
		case "bottom":
			return (u, v) => ({ x: u, y: line - v });
		case "left":
			return (u, v) => ({ x: line + v, y: u });
		case "right":
			return (u, v) => ({ x: line - v, y: u });
	}
}

/** 哪些角贴着吸附边：(tl, tr, br, bl)。 */
export function edgeCorners(edge: Edge | null): [boolean, boolean, boolean, boolean] {
	switch (edge) {
		case "top":
			return [true, true, false, false];
		case "bottom":
			return [false, false, true, true];
		case "left":
			return [true, false, false, true];
		case "right":
			return [false, true, true, false];
		default:
			return [false, false, false, false];
	}
}

export function pointLine(p: Point, edge: Edge): number {
	return isHorizontal(edge) ? p.y : p.x;
}

/** 每个角独立半径的圆角矩形，顺时针。 */
export function bodyPathD(r: Rect, radii: Radii): string {
	const { x, y, w, h } = r;
	const m = Math.min(w, h) / 2;
	const [tl, tr, br, bl] = radii.map((v) => clamp(v, 0, m));
	const out: string[] = [];
	out.push(`M ${x + tl} ${y}`);
	out.push(`L ${x + w - tr} ${y}`);
	if (tr) out.push(`C ${x + w - tr + tr * K} ${y} ${x + w} ${y + tr - tr * K} ${x + w} ${y + tr}`);
	out.push(`L ${x + w} ${y + h - br}`);
	if (br) out.push(`C ${x + w} ${y + h - br + br * K} ${x + w - br + br * K} ${y + h} ${x + w - br} ${y + h}`);
	out.push(`L ${x + bl} ${y + h}`);
	if (bl) out.push(`C ${x + bl - bl * K} ${y + h} ${x} ${y + h - bl + bl * K} ${x} ${y + h - bl}`);
	out.push(`L ${x} ${y + tl}`);
	if (tl) out.push(`C ${x} ${y + tl - tl * K} ${x + tl - tl * K} ${y} ${x + tl} ${y}`);
	out.push("Z");
	return out.join(" ");
}

/** 把圆角矩形均匀采样成多边形顶点（用于形变）。 */
export function bodyPoints(r: Rect, radii: Radii, step = 4): Point[] {
	const { x, y, w, h } = r;
	const m = Math.min(w, h) / 2;
	const [tl, tr, br, bl] = radii.map((v) => clamp(v, 0, m));
	const pts: Point[] = [];
	const line = (x0: number, y0: number, x1: number, y1: number): void => {
		const n = Math.max(1, Math.floor(Math.hypot(x1 - x0, y1 - y0) / step));
		for (let i = 0; i < n; i++) {
			const t = i / n;
			pts.push({ x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t });
		}
	};
	const arc = (cx: number, cy: number, radius: number, a0: number): void => {
		if (radius <= 0.01) {
			pts.push({ x: cx, y: cy });
			return;
		}
		const n = Math.max(2, Math.floor((radius * Math.PI) / 2 / step));
		for (let i = 0; i < n; i++) {
			const a = a0 + ((Math.PI / 2) * i) / n;
			pts.push({ x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) });
		}
	};
	line(x + tl, y, x + w - tr, y);
	arc(x + w - tr, y + tr, tr, -Math.PI / 2);
	line(x + w, y + tr, x + w, y + h - br);
	arc(x + w - br, y + h - br, br, 0);
	line(x + w - br, y + h, x + bl, y + h);
	arc(x + bl, y + h - bl, bl, Math.PI / 2);
	line(x, y + h - bl, x, y + tl);
	arc(x + tl, y + tl, tl, Math.PI);
	return pts;
}

export type WaveFn = (px: number, py: number, nx: number, ny: number) => number;

/** 速度形变：后缘拖尾收窄成泪滴，前缘略鼓；wave 叠加额外法向位移。 */
export function deform(
	pts: Point[],
	cx: number,
	cy: number,
	vx: number,
	vy: number,
	halfExtent: number,
	wave: WaveFn | null,
): Point[] {
	const speed = Math.hypot(vx, vy);
	const amt = clamp(speed / 2600, 0, 1);
	if (amt < 0.004 && wave === null) return pts;
	const dx = speed > 1e-3 ? vx / speed : 0;
	const dy = speed > 1e-3 ? vy / speed : 0;
	const lag = halfExtent * 0.6 * amt;
	return pts.map(({ x: px, y: py }) => {
		let nx = 0;
		let ny = 0;
		if (wave !== null) {
			const rx = px - cx;
			const ry = py - cy;
			const d = Math.hypot(rx, ry) || 1;
			nx = rx / d;
			ny = ry / d;
		}
		if (amt >= 0.004) {
			const rx = px - cx;
			const ry = py - cy;
			const d = Math.hypot(rx, ry) || 1;
			const nnx = rx / d;
			const nny = ry / d;
			const s = nnx * dx + nny * dy; // 1 前缘，-1 后缘
			const tf = (1 - s) * 0.5;
			const along = rx * dx + ry * dy;
			const perpX = rx - along * dx;
			const perpY = ry - along * dy;
			const squeeze = 1 - 0.38 * amt * tf ** 1.2;
			const push = -lag * tf ** 1.6 + lag * 0.12 * (1 - tf) ** 2;
			px = cx + along * dx + perpX * squeeze + dx * push;
			py = cy + along * dy + perpY * squeeze + dy * push;
		}
		if (wave !== null) {
			const w = wave(px, py, nx, ny);
			px += nx * w;
			py += ny * w;
		}
		return { x: px, y: py };
	});
}

/** Catmull-Rom 顶点 -> 平滑闭合贝塞尔路径。 */
export function polyPathD(pts: Point[]): string {
	const n = pts.length;
	if (n < 3) return "";
	const out: string[] = [`M ${pts[0].x} ${pts[0].y}`];
	for (let i = 0; i < n; i++) {
		const p0 = pts[(i - 1 + n) % n];
		const p1 = pts[i];
		const p2 = pts[(i + 1) % n];
		const p3 = pts[(i + 2) % n];
		const c1x = p1.x + (p2.x - p0.x) / 6;
		const c1y = p1.y + (p2.y - p0.y) / 6;
		const c2x = p2.x - (p3.x - p1.x) / 6;
		const c2y = p2.y - (p3.y - p1.y) / 6;
		out.push(`C ${c1x} ${c1y} ${c2x} ${c2y} ${p2.x} ${p2.y}`);
	}
	out.push("Z");
	return out.join(" ");
}

/**
 * 本体 + 液桥的**真正并集外轮廓**采样点（等价于原项目 QPainterPath.united）。
 *
 * 关键点：液桥底边那条「rend→lend」横线完全不进入轮廓——轮廓从液桥侧内凹曲线
 * 直接过渡到本体顶边，再绕本体一圈。这样 fill 与 stroke 用同一条路径时，
 * 衔接处不会再出现一道横杠，液桥看起来和本体连成一体。
 *
 * 采样顺序：液桥顶边(左→右) → 右内凹 → 本体顶边右段 → 右上圆角 → 右边 → 右下圆角
 * → 底边 → 左下圆角 → 左边 → 左上圆角 → 本体顶边左段 → 左内凹 → 回液桥顶边左。
 */
export function unitedNeckPoints(
  edge: Edge,
  line: number,
  body: Rect,
  baseRadius: number,
  fillet: number,
  corner: number,
  gap: number,
  t: number,
  strength: number,
  step = 4,
): Point[] {
  const m = edgeMap(edge, line);
  const horiz = isHorizontal(edge);
  const L = horiz ? body.w : body.h;
  const D = horiz ? body.h : body.w;
  const u0 = horiz ? body.x : body.y;
  const u1 = u0 + L;
  const c = u0 + L / 2;
  const half = L / 2;
  const tc = clamp(t, 0, 1);
  // tc 已经扣掉贴边阈值；前 35% 再加一道 smooth 门控：sqrt 在 0 附近斜率无穷大，
  // 收腰会跟着亚像素级的 gap 抖动，贴边瞬间两侧内凹圆角就会"两边往中间闪"。
  const ts = Math.sqrt(tc) * smooth(tc / 0.35);
  let wz = lerp(half, Math.max(2.5, Math.min(7, L * 0.035)), ts);
  wz = lerp(1, wz, strength);
  const fe = lerp(fillet, fillet * 0.75, tc) * strength;
  const fb = fillet * smooth(tc * 3) * strength;
  const e = wz + fe;
  const b = Math.min(wz + fb, Math.max(wz, half - corner * 0.5));
  const rNear = corner;             // 贴边侧两角半径
  const rFar = Math.min(baseRadius, D / 2); // 远离侧两角半径
  // 收腰深度不能越过远离侧圆角的起点：越过之后本体侧边会反向折回，又是一条竖直假边
  const ym = Math.min(Math.max(gap * 0.5, fe), gap + D - rFar);
  const yb = gap + 0.5;
  const pts: Point[] = [];

  const seg = (a: number, b_: number, cc: number, d: number): void => {
    const n = Math.max(1, Math.ceil(Math.hypot(cc - a, d - b_) / step));
    for (let i = 0; i < n; i++) {
      const q = i / n;
      pts.push(m(a + (cc - a) * q, b_ + (d - b_) * q));
    }
  };
  const cubic = (p0: [number, number], p1: [number, number], p2: [number, number], p3: [number, number]): void => {
    const n = Math.max(3, Math.ceil((Math.abs(p3[0] - p0[0]) + Math.abs(p3[1] - p0[1])) / step));
    for (let i = 0; i < n; i++) {
      const q = i / n;
      const it = 1 - q;
      pts.push(m(
        it ** 3 * p0[0] + 3 * it ** 2 * q * p1[0] + 3 * it * q ** 2 * p2[0] + q ** 3 * p3[0],
        it ** 3 * p0[1] + 3 * it ** 2 * q * p1[1] + 3 * it * q ** 2 * p2[1] + q ** 3 * p3[1],
      ));
    }
  };
  const arc = (cu: number, cv: number, radius: number, a0: number): void => {
    if (radius <= 0.01) { pts.push(m(cu, cv)); return; }
    const n = Math.max(2, Math.ceil((radius * Math.PI) / 2 / step));
    for (let i = 0; i < n; i++) {
      const a = a0 + ((Math.PI / 2) * i) / n;
      pts.push(m(cu + radius * Math.cos(a), cv + radius * Math.sin(a)));
    }
  };

  // 液桥顶边（贴屏幕边缘，v=-1.5 微出屏盖住接缝）
  seg(c - e, -1.5, c + e, -1.5);
  seg(c + e, -1.5, c + e, 0);
  // 右内凹曲线：宽口 -> 收腰 -> 本体侧；终点即与本体顶边的衔接点（无底边横线）
  cubic([c + e, 0], [c + wz + (e - wz) * (1 - K), 0], [c + wz, ym * (1 - K)], [c + wz, ym]);
  let rightU = c + wz;
  let rightV = ym;
  if (yb > ym + 0.5) {
    cubic([c + wz, ym], [c + wz, ym + (yb - ym) * K], [c + b - (b - wz) * K, yb], [c + b, yb]);
    rightU = c + b;
    rightV = yb;
  }
  // 本体轮廓：顶边右段 -> 右上圆角 -> 右 -> 右下 -> 底 -> 左下 -> 左 -> 左上 -> 顶边左段
  // 收腰点已经落到本体顶边以下（gap 只剩零点几像素）时，再折回顶边会沿本体右侧
  // 原路折返：这段折返没有面积、填充看不出来，描边却是实打实一根竖直亮线。
  // 这种情况直接接到本体侧边，与贴合（gap→0）时的轮廓同形。
  const docked = rightV > gap + 0.5;
  const leftU = 2 * c - rightU;
  if (docked) {
    if (Math.abs(u1 - rightU) > 0.05) seg(rightU, rightV, u1, rightV);
  } else {
    seg(rightU, rightV, u1 - rNear, gap);
    arc(u1 - rNear, gap + rNear, rNear, -Math.PI / 2);
  }
  seg(u1, docked ? rightV : gap + rNear, u1, gap + D - rFar);
  arc(u1 - rFar, gap + D - rFar, rFar, 0);
  seg(u1 - rFar, gap + D, u0 + rFar, gap + D);
  arc(u0 + rFar, gap + D - rFar, rFar, Math.PI / 2);
  if (docked) {
    seg(u0, gap + D - rFar, u0, rightV);
    seg(u0, rightV, leftU, rightV);
  } else {
    seg(u0, gap + D - rFar, u0, gap + rNear);
    arc(u0 + rNear, gap + rNear, rNear, Math.PI);
    seg(u0 + rNear, gap, leftU, rightV);
  }
  // 左内凹曲线：镜像返回液桥顶边左
  if (yb > ym + 0.5) {
    cubic([leftU, rightV], [c - (b - (b - wz) * K), yb], [c - wz, ym + (yb - ym) * K], [c - wz, ym]);
  }
  cubic([c - wz, ym], [c - wz, ym * (1 - K)], [c - (wz + (e - wz) * (1 - K)), 0], [c - e, 0]);
  seg(c - e, 0, c - e, -1.5);
  return pts;
}

/** 液桥断开后残留在边缘、正在缩回的半个小水滴。 */
export function dripPathD(edge: Edge, line: number, c: number, r: number): string {
	if (r <= 0.4) return "";
	const m = edgeMap(edge, line);
	const f = r * 0.8;
	const fmt = (p: Point): string => `${p.x} ${p.y}`;
	return [
		`M ${fmt(m(c - r - f, -1.5))}`,
		`L ${fmt(m(c + r + f, -1.5))}`,
		`L ${fmt(m(c + r + f, 0))}`,
		`C ${fmt(m(c + r + f * (1 - K), 0))} ${fmt(m(c + r, f * (1 - K)))} ${fmt(m(c + r, f * 0.9))}`,
		`C ${fmt(m(c + r, f + r * 0.9))} ${fmt(m(c - r, f + r * 0.9))} ${fmt(m(c - r, f * 0.9))}`,
		`C ${fmt(m(c - r, f * (1 - K)))} ${fmt(m(c - r - f * (1 - K), 0))} ${fmt(m(c - r - f, 0))}`,
		"Z",
	].join(" ");
}

export interface Drip {
	edge: Edge;
	line: number;
	c: number;
	r: Spring;
}

/**
 * 贴边形态并集轮廓的**采样点集**。与 wisland 一致：先在点集上做形变，
 * 再由 polyPathD 生成一条闭合路径——这样形变与并集不会错位，也没有内缝。
 * 采样顺序：边缘左 -> 边缘右 -> 右内凹 -> 右侧 -> 底圆角 -> 底边 -> 左圆角 -> 左侧 -> 左内凹。
 */
export function attachedOutlinePoints(
	edge: Edge,
	line: number,
	body: Rect,
	baseRadius: number,
	fillet: number,
	strength: number,
	step = 4,
): Point[] {
	const m = edgeMap(edge, line);
	const horiz = isHorizontal(edge);
	const L = horiz ? body.w : body.h;
	const D = horiz ? body.h : body.w;
	const u0 = horiz ? body.x : body.y;
	const u1 = u0 + L;
	const c = u0 + L / 2;
	const f = fillet * strength;
	const e = L / 2 + f;
	const r = clamp(baseRadius, 0, Math.min(L, D) / 2);
	// 内凹深度不能吃掉远离侧圆角：越过之后侧边会反向折回，描出一条竖直假边
	const ym = Math.min(f, Math.max(0, D - r - 0.5));
	const pts: Point[] = [];

	const seg = (x0: number, y0: number, x1: number, y1: number): void => {
		const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / step));
		for (let i = 0; i < n; i++) {
			const t = i / n;
			pts.push(m(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t));
		}
	};
	const cubic = (
		p0: [number, number], p1: [number, number],
		p2: [number, number], p3: [number, number],
	): void => {
		const n = Math.max(3, Math.ceil((Math.abs(p3[0] - p0[0]) + Math.abs(p3[1] - p0[1])) / step));
		for (let i = 0; i < n; i++) {
			const t = i / n;
			const it = 1 - t;
			pts.push(m(
				it ** 3 * p0[0] + 3 * it ** 2 * t * p1[0] + 3 * it * t ** 2 * p2[0] + t ** 3 * p3[0],
				it ** 3 * p0[1] + 3 * it ** 2 * t * p1[1] + 3 * it * t ** 2 * p2[1] + t ** 3 * p3[1],
			));
		}
	};
	const arc = (cu: number, cv: number, radius: number, a0: number): void => {
		const n = Math.max(2, Math.ceil((radius * Math.PI) / 2 / step));
		for (let i = 0; i < n; i++) {
			const a = a0 + ((Math.PI / 2) * i) / n;
			pts.push(m(cu + radius * Math.cos(a), cv + radius * Math.sin(a)));
		}
	};

	// 屏幕边缘（v=-1.5 微出屏，盖住接缝）
	seg(c - e, -1.5, c + e, -1.5);
	seg(c + e, -1.5, c + e, 0);
	// 右内凹圆角：宽口 -> 本体右上角
	cubic(
		[c + e, 0],
		[c + L / 2 + (e - L / 2) * (1 - K), 0],
		[u1, ym * (1 - K)],
		[u1, ym],
	);
	// 右侧 + 右下圆角 + 底边 + 左下圆角 + 左侧
	seg(u1, ym, u1, D - r);
	arc(u1 - r, D - r, r, 0);
	seg(u1 - r, D, u0 + r, D);
	arc(u0 + r, D - r, r, Math.PI / 2);
	seg(u0, D - r, u0, ym);
	// 左内凹圆角：本体左上角 -> 宽口
	cubic(
		[u0, ym],
		[u0, ym * (1 - K)],
		[c - L / 2 - (e - L / 2) * (1 - K), 0],
		[c - e, 0],
	);
	seg(c - e, 0, c - e, -1.5);
	return pts;
}

/**
 * 贴边形态的**单一连续轮廓**（等价于 wisland 的 `body_p.united(neck)`）。
 *
 * 关键：wisland 用 QPainterPath.united 把本体与液桥并成一条路径，因此不会出现内缝。
 * 这里直接沿着并集的外边界描一遍——屏幕边缘 -> 内凹圆角(fillet) -> 本体两侧 ->
 * 底部圆角 -> 另一侧内凹圆角 -> 回到边缘。这样填充与描边都只有一圈轮廓，
 * 不会再出现"本体顶边横线 + 液桥轮廓"叠在一起的蝴蝶结。
 *
 * 仅用于 gap≈0 的贴边/落位态；拖拽拉开时仍用 body + neck 分体（瞬间态，可接受）。
 */
export function attachedOutlineD(
	edge: Edge,
	line: number,
	body: Rect,
	baseRadius: number,
	fillet: number,
	strength: number,
): string {
	const m = edgeMap(edge, line);
	const horiz = isHorizontal(edge);
	const L = horiz ? body.w : body.h; // 沿边长度
	const D = horiz ? body.h : body.w; // 垂直深入屏幕的距离
	const u0 = horiz ? body.x : body.y;
	const u1 = u0 + L;
	const c = u0 + L / 2;
	const f = fillet * strength; // 液桥强度为 0 时内凹消失，退化为本体
	const e = L / 2 + f; // 屏幕边缘处的半宽（比本体宽出 fillet）
	const ym = f; // 腰部深度
	const r = clamp(baseRadius, 0, Math.min(L, D) / 2);
	const fmt = (p: Point): string => `${p.x} ${p.y}`;
	const out: string[] = [];

	// 屏幕边缘：从左上到右上（v=-1.5 微微出屏，盖住与屏幕的接缝）
	out.push(`M ${fmt(m(c - e, -1.5))}`);
	out.push(`L ${fmt(m(c + e, -1.5))}`);
	out.push(`L ${fmt(m(c + e, 0))}`);

	// 右侧内凹圆角：边缘宽口 -> 收窄到本体右上角
	out.push(
		`C ${fmt(m(c + L / 2 + (e - L / 2) * (1 - K), 0))} ` +
		`${fmt(m(c + L / 2, ym * (1 - K)))} ${fmt(m(u1, ym))}`,
	);

	// 本体右侧 -> 右下圆角 -> 底边 -> 左下圆角 -> 左侧
	out.push(`L ${fmt(m(u1, D - r))}`);
	if (r > 0.01) {
		out.push(
			`C ${fmt(m(u1, D - r + r * K))} ${fmt(m(u1 - r + r * K, D))} ${fmt(m(u1 - r, D))}`,
		);
	}
	out.push(`L ${fmt(m(u0 + r, D))}`);
	if (r > 0.01) {
		out.push(
			`C ${fmt(m(u0 + r - r * K, D))} ${fmt(m(u0, D - r + r * K))} ${fmt(m(u0, D - r))}`,
		);
	}
	out.push(`L ${fmt(m(u0, ym))}`);

	// 左侧内凹圆角：本体左上角 -> 张宽到边缘
	out.push(
		`C ${fmt(m(u0, ym * (1 - K)))} ` +
		`${fmt(m(c - L / 2 - (e - L / 2) * (1 - K), 0))} ${fmt(m(c - e, 0))}`,
	);
	out.push(`L ${fmt(m(c - e, -1.5))}`);
	out.push("Z");
	return out.join(" ");
}
