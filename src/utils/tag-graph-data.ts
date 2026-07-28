export type TagGraphInputPost = {
	title: string;
	url: string;
	published: Date | string;
	tags?: string[];
};

export type TagGraphPost = {
	title: string;
	url: string;
	published: string;
};

export type TagGraphNode = {
	id: string;
	name: string;
	value: number;
	url: string;
	posts: TagGraphPost[];
};

export type TagGraphLink = {
	source: string;
	target: string;
	value: number;
};

export type TagGraphData = {
	nodes: TagGraphNode[];
	links: TagGraphLink[];
	threshold: number;
};

type PairCount = {
	source: string;
	target: string;
	value: number;
};

function toPublishedString(value: Date | string): string {
	if (value instanceof Date) return value.toISOString();
	return new Date(value).toISOString();
}

function toTimestamp(value: string): number {
	return new Date(value).getTime();
}

function normalizeTags(tags: string[] | undefined): string[] {
	const normalized = new Set<string>();
	for (const tag of tags ?? []) {
		const name = tag.trim();
		if (name) normalized.add(name);
	}
	return [...normalized].sort();
}

function makePairKey(source: string, target: string): string {
	return `${source}\u0000${target}`;
}

export function buildTagGraphData(
	posts: TagGraphInputPost[],
	threshold = 1,
): TagGraphData {
	const nodeMap = new Map<string, TagGraphNode>();
	const pairMap = new Map<string, PairCount>();

	for (const post of posts) {
		const tags = normalizeTags(post.tags);
		if (tags.length === 0) continue;

		const postMeta: TagGraphPost = {
			title: post.title,
			url: post.url,
			published: toPublishedString(post.published),
		};

		for (const tag of tags) {
			const node = nodeMap.get(tag) ?? {
				id: tag,
				name: tag,
				value: 0,
				url: "",
				posts: [],
			};
			node.posts.push(postMeta);
			node.value = node.posts.length;
			nodeMap.set(tag, node);
		}

		for (let i = 0; i < tags.length; i++) {
			for (let j = i + 1; j < tags.length; j++) {
				const source = tags[i];
				const target = tags[j];
				const key = makePairKey(source, target);
				const pair = pairMap.get(key) ?? { source, target, value: 0 };
				pair.value++;
				pairMap.set(key, pair);
			}
		}
	}

	const nodes = [...nodeMap.values()]
		.map((node) => ({
			...node,
			posts: [...node.posts].sort(
				(a, b) => toTimestamp(b.published) - toTimestamp(a.published),
			),
		}))
		.sort(
			(a, b) =>
				b.value - a.value ||
				a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
		);

	const links = [...pairMap.values()]
		.filter((pair) => pair.value >= threshold)
		.sort(
			(a, b) =>
				b.value - a.value ||
				a.source.localeCompare(b.source) ||
				a.target.localeCompare(b.target),
		);

	return { nodes, links, threshold };
}
