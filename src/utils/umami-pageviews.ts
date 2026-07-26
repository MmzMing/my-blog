const SHARE_CACHE_TTL = 24 * 60 * 60 * 1000;
const METRICS_CACHE_TTL = 5 * 60 * 1000;
const SHARE_CACHE_PREFIX = "umami-pageviews:share:";
const METRICS_CACHE_PREFIX = "umami-pageviews:metrics:";

export type UmamiMetricRow = {
	x: string;
	y: number;
};

type UmamiShareResponse = {
	entityId?: string;
	token?: string;
	websiteId?: string;
};

type CacheRecord<T> = {
	createdAt: number;
	value: T;
};

export type UmamiPageviewOptions = {
	apiBase: string;
	shareId: string;
};

const pendingRequests = new Map<string, Promise<Map<string, number>>>();

function getStorage(): Storage | null {
	if (typeof window === "undefined") return null;
	return window.localStorage;
}

function readCache<T>(key: string, ttl: number): T | null {
	try {
		const raw = getStorage()?.getItem(key);
		if (!raw) return null;
		const cache = JSON.parse(raw) as CacheRecord<T>;
		if (Date.now() - cache.createdAt < ttl) return cache.value;
		getStorage()?.removeItem(key);
	} catch {}
	return null;
}

function writeCache<T>(key: string, value: T) {
	try {
		getStorage()?.setItem(
			key,
			JSON.stringify({ createdAt: Date.now(), value }),
		);
	} catch {}
}

export function normalizeUmamiPageviewPath(path: string): string {
	if (!path) return "/";

	let normalizedPath: string;
	try {
		const origin =
			typeof window === "undefined"
				? "https://example.invalid"
				: window.location.origin;
		normalizedPath = new URL(path, origin).pathname;
	} catch {
		normalizedPath = path.split(/[?#]/, 1)[0] || "/";
	}

	const normalized = normalizedPath.replace(/\/+$/, "").toLowerCase();
	return normalized || "/";
}

export function buildUmamiPageviewLookup(
	rows: UmamiMetricRow[],
): Map<string, number> {
	const lookup = new Map<string, number>();
	for (const row of rows) {
		const path = normalizeUmamiPageviewPath(row.x);
		lookup.set(path, (lookup.get(path) || 0) + (Number(row.y) || 0));
	}
	return lookup;
}

async function fetchShare(
	apiBase: string,
	shareId: string,
): Promise<UmamiShareResponse> {
	const cacheKey = `${SHARE_CACHE_PREFIX}${shareId}`;
	const cached = readCache<UmamiShareResponse>(cacheKey, SHARE_CACHE_TTL);
	if (cached) return cached;

	const response = await fetch(`${apiBase}/api/share/${shareId}`);
	if (!response.ok)
		throw new Error(`Umami share request failed: ${response.status}`);
	const share = (await response.json()) as UmamiShareResponse;
	writeCache(cacheKey, share);
	return share;
}

async function loadUmamiPageviewLookup({
	apiBase,
	shareId,
}: UmamiPageviewOptions): Promise<Map<string, number>> {
	const normalizedApiBase = apiBase.replace(/\/$/, "");
	const metricsCacheKey = `${METRICS_CACHE_PREFIX}${shareId}`;
	const cached = readCache<[string, number][]>(
		metricsCacheKey,
		METRICS_CACHE_TTL,
	);
	if (cached) return new Map(cached);

	const share = await fetchShare(normalizedApiBase, shareId);
	const websiteId = share.websiteId || share.entityId;
	if (!websiteId)
		throw new Error("Umami share response did not include a website ID");

	const response = await fetch(
		`${normalizedApiBase}/api/websites/${websiteId}/metrics?startAt=0&endAt=${Date.now()}&type=path&limit=1000`,
		{
			headers: {
				"x-umami-share-context": "1",
				"x-umami-share-token": share.token || shareId,
			},
		},
	);
	if (!response.ok)
		throw new Error(`Umami metrics request failed: ${response.status}`);

	const rows = (await response.json()) as UmamiMetricRow[];
	const lookup = buildUmamiPageviewLookup(rows);
	writeCache(metricsCacheKey, [...lookup.entries()]);
	return lookup;
}

export function getUmamiPageviewLookup(
	options: UmamiPageviewOptions,
): Promise<Map<string, number>> {
	const requestKey = `${options.apiBase.replace(/\/$/, "")}:${options.shareId}`;
	const pending = pendingRequests.get(requestKey);
	if (pending) return pending;

	const request = loadUmamiPageviewLookup(options).finally(() => {
		pendingRequests.delete(requestKey);
	});
	pendingRequests.set(requestKey, request);
	return request;
}
