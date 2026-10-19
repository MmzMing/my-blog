export type HeroTileLayout = {
	index: number;
	row: number;
	column: number;
	order: number;
	offsetX: number;
	offsetY: number;
	rotation: number;
	scale: number;
	blur: number;
	idleDepth: number;
	initiallyVisible: boolean;
};

type HeroTileLayoutOptions = {
	rows: number;
	columns: number;
	idleVisible: number;
	seed: number;
};

function createSeededRandom(seed: number) {
	let value = seed >>> 0;
	return () => {
		value += 0x6d2b79f5;
		let result = value;
		result = Math.imul(result ^ (result >>> 15), result | 1);
		result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
		return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
	};
}

export function createHeroTileLayout({
	rows,
	columns,
	idleVisible,
	seed,
}: HeroTileLayoutOptions): HeroTileLayout[] {
	const tileCount = Math.max(1, rows * columns);
	const random = createSeededRandom(seed);
	const order = Array.from({ length: tileCount }, (_, index) => index);

	for (let index = order.length - 1; index > 0; index--) {
		const swapIndex = Math.floor(random() * (index + 1));
		[order[index], order[swapIndex]] = [order[swapIndex], order[index]];
	}

	const revealOrder = new Map(
		order.map((tileIndex, index) => [tileIndex, index]),
	);
	return Array.from({ length: tileCount }, (_, index) => {
		const rank = revealOrder.get(index) ?? index;
		const initiallyVisible =
			rank < Math.min(tileCount, Math.max(1, idleVisible));
		const idleDepth = initiallyVisible ? rank : idleVisible;
		const idleProgress =
			Math.min(tileCount, Math.max(1, idleVisible)) > 1
				? idleDepth / (Math.min(tileCount, Math.max(1, idleVisible)) - 1)
				: 0;
		return {
			index,
			row: Math.floor(index / columns),
			column: index % columns,
			order: rank,
			offsetX: Number(((random() - 0.5) * 150).toFixed(3)),
			offsetY: Number(((random() - 0.5) * 115).toFixed(3)),
			rotation: Number(((random() - 0.5) * 18).toFixed(3)),
			scale: Number(
				(initiallyVisible
					? 1.18 - idleProgress * 0.38
					: 0.72 + random() * 0.34
				).toFixed(3),
			),
			blur: Number(
				(initiallyVisible ? idleProgress * 7 : random() * 5).toFixed(3),
			),
			idleDepth,
			initiallyVisible,
		};
	});
}

export function getHeroPinEndDistance(
	configuredDistance: number,
	viewportHeight: number,
	minimumViewports: number,
) {
	const configured = Number.isFinite(configuredDistance)
		? configuredDistance
		: 0;
	const viewport = Number.isFinite(viewportHeight) ? viewportHeight : 0;
	return Math.max(0, configured, Math.round(viewport * minimumViewports));
}

/**
 * 照片描边蔓延路径：8 条笔画，各自从某个圆角弧线 45° 中点出发、
 * 沿单边延伸到该边中点。配合 pathLength=1 + dashoffset 1→0，
 * 边框就从四角同时向四边中点蔓延闭合成框。
 * 路径画在描边中心线上：相对图片盒外扩 thickness/2，圆角半径同步放大。
 */
export function createHeroPhotoFramePaths(
	width: number,
	height: number,
	thickness: number,
	radius: number,
): string[] {
	const x0 = -thickness / 2;
	const y0 = -thickness / 2;
	const x1 = width + thickness / 2;
	const y1 = height + thickness / 2;
	const r = radius + thickness / 2;
	const cx = (x0 + x1) / 2;
	const cy = (y0 + y1) / 2;
	// 45° 弧中点相对切点的内缩距离：r·(1 − √2/2)
	const k = r * (1 - Math.SQRT1_2);
	const f = (n: number) => Math.round(n * 100) / 100;
	return [
		`M ${f(x0 + k)} ${f(y0 + k)} A ${f(r)} ${f(r)} 0 0 1 ${f(x0 + r)} ${f(y0)} L ${f(cx)} ${f(y0)}`,
		`M ${f(x0 + k)} ${f(y0 + k)} A ${f(r)} ${f(r)} 0 0 0 ${f(x0)} ${f(y0 + r)} L ${f(x0)} ${f(cy)}`,
		`M ${f(x1 - k)} ${f(y0 + k)} A ${f(r)} ${f(r)} 0 0 0 ${f(x1 - r)} ${f(y0)} L ${f(cx)} ${f(y0)}`,
		`M ${f(x1 - k)} ${f(y0 + k)} A ${f(r)} ${f(r)} 0 0 1 ${f(x1)} ${f(y0 + r)} L ${f(x1)} ${f(cy)}`,
		`M ${f(x1 - k)} ${f(y1 - k)} A ${f(r)} ${f(r)} 0 0 0 ${f(x1)} ${f(y1 - r)} L ${f(x1)} ${f(cy)}`,
		`M ${f(x1 - k)} ${f(y1 - k)} A ${f(r)} ${f(r)} 0 0 1 ${f(x1 - r)} ${f(y1)} L ${f(cx)} ${f(y1)}`,
		`M ${f(x0 + k)} ${f(y1 - k)} A ${f(r)} ${f(r)} 0 0 1 ${f(x0 + r)} ${f(y1)} L ${f(cx)} ${f(y1)}`,
		`M ${f(x0 + k)} ${f(y1 - k)} A ${f(r)} ${f(r)} 0 0 0 ${f(x0)} ${f(y1 - r)} L ${f(x0)} ${f(cy)}`,
	];
}

const PUZZLE_COLUMNS = 18;
const PUZZLE_ROWS = 12;
const PUZZLE_SEED = 20261015;
/** 用户单位：viewBox 网格边长，渲染时由 preserveAspectRatio 统一缩放 */
export const PUZZLE_CELL = 100;
/** 榫头凸起的底宽与凸出深度（用户单位），约 3.5:1 的平缓圆丘而非蘑菇头 */
const PUZZLE_TAB_WIDTH = 46;
const PUZZLE_TAB_DEPTH = 13;
/** 半余弦丘的三次贝塞尔逼近常数：控制点沿锚点切线内缩这个比例，
    起终点切线与接缝线共线，接出去 G1 连续，不会留圆弧那种尖角 */
const PUZZLE_TAB_TANGENT = 0.3642;

export type HeroPuzzleLayout = {
	viewBox: string;
	width: number;
	height: number;
	seams: string[];
};

const round = (value: number): number => Number(value.toFixed(2));

/**
 * 一条接缝线：沿直线走，每格中点起一个半余弦凸起再回到线上。
 * 凸起用两段三次贝塞尔拼成，四个控制点全部落在锚点切线方向上，
 * 所以接缝、丘脚、丘顶之间都是切线连续的，只有横竖两种朝向由 point 折叠。
 */
function createPuzzleSeam(options: {
	line: number;
	length: number;
	count: number;
	horizontal: boolean;
	random: () => number;
}): string {
	const { line, length, count, horizontal, random } = options;
	const half = PUZZLE_TAB_WIDTH / 2;
	const tangent = half * PUZZLE_TAB_TANGENT;
	const point = (along: number, across: number) =>
		horizontal
			? `${round(along)} ${round(across)}`
			: `${round(across)} ${round(along)}`;

	let d = `M ${point(0, line)}`;
	for (let index = 0; index < count; index += 1) {
		const center = (index + 0.5) * PUZZLE_CELL;
		const apex = line + (random() < 0.5 ? -1 : 1) * PUZZLE_TAB_DEPTH;
		const start = center - half;
		const end = center + half;
		d += ` L ${point(start, line)}`;
		d += ` C ${point(start + tangent, line)} ${point(center - tangent, apex)} ${point(center, apex)}`;
		d += ` C ${point(center + tangent, apex)} ${point(end - tangent, line)} ${point(end, line)}`;
	}
	return `${d} L ${point(length, line)}`;
}

/**
 * 首屏拼图底层的构建期几何：只出「缝线」，不出色块。
 * 每条内部网格线合成一条 path，凸向由种子随机决定，构建期算完即固定。
 */
export function createHeroPuzzleLayout(): HeroPuzzleLayout {
	const random = createSeededRandom(PUZZLE_SEED);
	const width = PUZZLE_COLUMNS * PUZZLE_CELL;
	const height = PUZZLE_ROWS * PUZZLE_CELL;
	const seams: string[] = [];

	for (let row = 0; row < PUZZLE_ROWS - 1; row += 1) {
		seams.push(
			createPuzzleSeam({
				line: (row + 1) * PUZZLE_CELL,
				length: width,
				count: PUZZLE_COLUMNS,
				horizontal: true,
				random,
			}),
		);
	}
	for (let column = 0; column < PUZZLE_COLUMNS - 1; column += 1) {
		seams.push(
			createPuzzleSeam({
				line: (column + 1) * PUZZLE_CELL,
				length: height,
				count: PUZZLE_ROWS,
				horizontal: false,
				random,
			}),
		);
	}

	return {
		viewBox: `0 0 ${width} ${height}`,
		width,
		height,
		seams,
	};
}
