/** 几何与缓动工具（源自旧标签图谱控制器，逻辑未改）。 */

export const TWO_PI = Math.PI * 2;
export const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

export type Point = { x: number; y: number };

export function getCssVariable(
	style: CSSStyleDeclaration,
	name: string,
): string {
	return style.getPropertyValue(name).trim();
}

/** 二次贝塞尔取点。回放时用它画「生长中」的部分曲线。 */
export function curvePoint(
	source: Point,
	control: Point,
	target: Point,
	t: number,
): Point {
	const inverse = 1 - t;
	return {
		x:
			inverse * inverse * source.x +
			2 * inverse * t * control.x +
			t * t * target.x,
		y:
			inverse * inverse * source.y +
			2 * inverse * t * control.y +
			t * t * target.y,
	};
}

/** 交替侧的控制点，让平行边不重叠 */
export function getCurveControl(
	sourceX: number,
	sourceY: number,
	targetX: number,
	targetY: number,
	index: number,
): Point {
	const dx = targetX - sourceX;
	const dy = targetY - sourceY;
	const length = Math.max(1, Math.hypot(dx, dy));
	const direction = index % 2 === 0 ? 1 : -1;
	const curve = Math.min(18, length * 0.08) * direction;
	return {
		x: (sourceX + targetX) / 2 + (-dy / length) * curve,
		y: (sourceY + targetY) / 2 + (dx / length) * curve,
	};
}

/** 按像素宽度截断并加省略号，中文安全 */
export function fitLabel(
	context: CanvasRenderingContext2D,
	label: string,
	maxWidth: number,
): string {
	if (context.measureText(label).width <= maxWidth) return label;
	let shortened = label;
	while (
		shortened.length > 1 &&
		context.measureText(`${shortened}…`).width > maxWidth
	) {
		shortened = shortened.slice(0, -1);
	}
	return `${shortened}…`;
}

export function clamp(value: number, min: number, max: number): number {
	return value < min ? min : value > max ? max : value;
}

export function easeOutCubic(t: number): number {
	return 1 - (1 - t) ** 3;
}

/** 轻微过冲，节点入场的弹性感 */
export function easeOutBack(t: number): number {
	const c1 = 1.70158;
	const c3 = c1 + 1;
	return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}
