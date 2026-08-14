export const HERO_MOBILE_BREAKPOINT = 768;

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

export function clampHeroProgress(progress: number) {
	if (!Number.isFinite(progress)) return 0;
	return Math.min(1, Math.max(0, progress));
}
