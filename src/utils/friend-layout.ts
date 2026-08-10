import type { FriendLink } from "@/types/config";

export type FriendTileKind = "square" | "horizontal" | "vertical";

export type FriendTilePlacement = {
	friend: FriendLink;
	kind: FriendTileKind;
	row: number;
	column: number;
	rowSpan: number;
	columnSpan: number;
};

type RandomSource = () => number;

type TileDefinition = {
	kind: FriendTileKind;
	rowSpan: number;
	columnSpan: number;
	weight: number;
};

const TILE_DEFINITIONS: TileDefinition[] = [
	{ kind: "square", rowSpan: 1, columnSpan: 1, weight: 0.6 },
	{ kind: "horizontal", rowSpan: 1, columnSpan: 2, weight: 0.2 },
	{ kind: "vertical", rowSpan: 2, columnSpan: 1, weight: 0.2 },
];

const MAX_SEARCH_NODES = 20_000;

function randomValue(random: RandomSource): number {
	const value = random();
	if (!Number.isFinite(value)) return Math.random();
	return Math.min(Math.max(value, 0), 0.999999999);
}

function shuffle<T>(items: readonly T[], random: RandomSource): T[] {
	const result = [...items];

	for (let index = result.length - 1; index > 0; index -= 1) {
		const swapIndex = Math.floor(randomValue(random) * (index + 1));
		[result[index], result[swapIndex]] = [result[swapIndex], result[index]];
	}

	return result;
}

function weightedOrder(
	definitions: readonly TileDefinition[],
	random: RandomSource,
): TileDefinition[] {
	const remaining = [...definitions];
	const result: TileDefinition[] = [];

	while (remaining.length > 0) {
		const totalWeight = remaining.reduce((sum, item) => sum + item.weight, 0);
		let cursor = randomValue(random) * totalWeight;
		let selectedIndex = remaining.length - 1;

		for (let index = 0; index < remaining.length; index += 1) {
			cursor -= remaining[index].weight;
			if (cursor <= 0) {
				selectedIndex = index;
				break;
			}
		}

		result.push(remaining[selectedIndex]);
		remaining.splice(selectedIndex, 1);
	}

	return result;
}

function firstEmptyCell(
	rows: readonly number[],
	columns: number,
): [number, number] {
	const fullMask = (1 << columns) - 1;

	for (let row = 0; row < rows.length; row += 1) {
		const occupied = rows[row] ?? 0;
		if (occupied === fullMask) continue;

		for (let column = 0; column < columns; column += 1) {
			if ((occupied & (1 << column)) === 0) return [row, column];
		}
	}

	return [rows.length, 0];
}

function canPlace(
	rows: readonly number[],
	row: number,
	column: number,
	definition: TileDefinition,
	columns: number,
): boolean {
	if (column + definition.columnSpan > columns) return false;

	const tileMask = ((1 << definition.columnSpan) - 1) << column;
	for (let rowOffset = 0; rowOffset < definition.rowSpan; rowOffset += 1) {
		const occupied = rows[row + rowOffset] ?? 0;
		if ((occupied & tileMask) !== 0) return false;
	}

	return true;
}

function place(
	rows: readonly number[],
	row: number,
	column: number,
	definition: TileDefinition,
): number[] {
	const result = [...rows];
	const tileMask = ((1 << definition.columnSpan) - 1) << column;

	for (let rowOffset = 0; rowOffset < definition.rowSpan; rowOffset += 1) {
		result[row + rowOffset] = (result[row + rowOffset] ?? 0) | tileMask;
	}

	return result;
}

function isCompact(rows: readonly number[], columns: number): boolean {
	const fullMask = (1 << columns) - 1;
	let lastRow = rows.length - 1;

	while (lastRow >= 0 && (rows[lastRow] ?? 0) === 0) lastRow -= 1;
	if (lastRow < 0) return true;

	for (let row = 0; row < lastRow; row += 1) {
		if ((rows[row] ?? 0) !== fullMask) return false;
	}

	let foundEmpty = false;
	const finalMask = rows[lastRow] ?? 0;
	for (let column = 0; column < columns; column += 1) {
		const occupied = (finalMask & (1 << column)) !== 0;
		if (!occupied) {
			foundEmpty = true;
		} else if (foundEmpty) {
			return false;
		}
	}

	return true;
}

function squareLayout(
	items: readonly FriendLink[],
	columns: number,
): FriendTilePlacement[] {
	return items.map((friend, index) => ({
		friend,
		kind: "square",
		row: Math.floor(index / columns) + 1,
		column: (index % columns) + 1,
		rowSpan: 1,
		columnSpan: 1,
	}));
}

function targetLongTileCount(itemCount: number, columns: number): number {
	if (columns < 2 || itemCount < 4) return 0;
	return Math.min(itemCount, Math.round(itemCount * 0.4));
}

function compactLayout(
	items: readonly FriendLink[],
	columns: number,
	longTileCount: number,
	random: RandomSource,
): FriendTilePlacement[] | null {
	type SearchResult = {
		rows: number[];
		placements: FriendTilePlacement[];
	};

	let visitedNodes = 0;
	const failedStates = new Set<string>();

	function search(
		index: number,
		remainingLongTiles: number,
		rows: number[],
		placements: FriendTilePlacement[],
	): SearchResult | null {
		visitedNodes += 1;
		if (visitedNodes > MAX_SEARCH_NODES) return null;

		if (index === items.length) {
			return remainingLongTiles === 0 && isCompact(rows, columns)
				? { rows, placements }
				: null;
		}

		const stateKey = `${index}|${remainingLongTiles}|${rows.join(",")}`;
		if (failedStates.has(stateKey)) return null;

		const [row, column] = firstEmptyCell(rows, columns);
		const remainingItemsAfterPlacement = items.length - index - 1;
		const candidates = weightedOrder(
			TILE_DEFINITIONS.filter((definition) => {
				if (!canPlace(rows, row, column, definition, columns)) return false;

				const isLong = definition.kind !== "square";
				const nextLongTiles = remainingLongTiles - (isLong ? 1 : 0);
				return (
					nextLongTiles >= 0 && nextLongTiles <= remainingItemsAfterPlacement
				);
			}),
			random,
		);

		for (const definition of candidates) {
			const isLong = definition.kind !== "square";
			const nextRows = place(rows, row, column, definition);
			const nextPlacements = [
				...placements,
				{
					friend: items[index],
					kind: definition.kind,
					row: row + 1,
					column: column + 1,
					rowSpan: definition.rowSpan,
					columnSpan: definition.columnSpan,
				},
			];

			const result = search(
				index + 1,
				remainingLongTiles - (isLong ? 1 : 0),
				nextRows,
				nextPlacements,
			);
			if (result) return result;
		}

		failedStates.add(stateKey);
		return null;
	}

	return search(0, longTileCount, [], [])?.placements ?? null;
}

function comparePlacements(
	a: FriendTilePlacement,
	b: FriendTilePlacement,
): number {
	return a.row - b.row || a.column - b.column;
}

/**
 * Creates a random, compact tile plan for the friend-link grid.
 * `random` is injectable so the packing rules can be tested deterministically.
 */
export function buildFriendLayout(
	items: readonly FriendLink[],
	columns: number,
	random: RandomSource = Math.random,
): FriendTilePlacement[] {
	const requestedColumns = Number.isFinite(columns) ? Math.floor(columns) : 1;
	const safeColumns = Math.max(1, Math.min(3, requestedColumns));
	const shuffledItems = shuffle(items, random);

	if (shuffledItems.length === 0) return [];
	if (safeColumns === 1 || shuffledItems.length < 4) {
		return squareLayout(shuffledItems, safeColumns);
	}

	const targetLongTiles = targetLongTileCount(
		shuffledItems.length,
		safeColumns,
	);
	const planned = compactLayout(
		shuffledItems,
		safeColumns,
		targetLongTiles,
		random,
	);

	return (planned ?? squareLayout(shuffledItems, safeColumns)).sort(
		comparePlacements,
	);
}
