/**
 * remark-wiki-link - Obsidian 风格 Wiki Link 插件。
 *
 * 单独成段的 [[文章标识]] 会构建为站内文章卡片；行内写法保持普通链接。
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { slug } from "github-slugger";
import matter from "gray-matter";
import { coverImageConfig } from "../config/coverImageConfig.ts";
import { getApiUrlList, processCoverImageSync } from "../utils/image-utils.ts";
import { getPostUrlBySlug, url } from "../utils/url-utils.ts";

const POSTS_DIR = fileURLToPath(new URL("../content/posts/", import.meta.url));
const MARKDOWN_EXTENSION = /\.(?:md|mdx|markdown)$/i;
const WIKI_LINK = /!?\[\[([^[\]\n]+)\]\]/g;
const STANDALONE_WIKI_LINK = /^\[\[([^[\]\n]+)\]\]$/;
const SKIPPED_NODE_TYPES = new Set([
	"link",
	"linkReference",
	"mdxJsxFlowElement",
	"mdxJsxTextElement",
]);

const frontmatterCache = new Map();

function normalizeContentPath(value) {
	const contentPath = value
		.trim()
		.replaceAll("\\", "/")
		.replace(/^\.?\//, "")
		.replace(/\/+$/, "")
		.replace(MARKDOWN_EXTENSION, "");
	const segments = contentPath.split("/").filter(Boolean);

	if (
		segments.length === 0 ||
		segments.some((segment) => segment === "." || segment === "..")
	) {
		return "";
	}

	const withoutPrefix = segments[0] === "posts" ? segments.slice(1) : segments;
	return withoutPrefix.length > 0 ? withoutPrefix.join("/") : "";
}

function toContentPath(filePath) {
	return path
		.relative(POSTS_DIR, filePath)
		.replaceAll("\\", "/")
		.replace(MARKDOWN_EXTENSION, "");
}

function toPostId(meta) {
	const declaredSlug =
		typeof meta.data.slug === "string" ? meta.data.slug.trim() : "";
	return declaredSlug || toContentPath(meta.filePath);
}

function isPublished(meta) {
	return !(import.meta.env?.PROD && meta.data.draft === true);
}

function readMetaFile(filePath) {
	let stats;
	try {
		stats = statSync(filePath);
	} catch {
		return null;
	}
	if (!stats.isFile()) return null;

	const cached = frontmatterCache.get(filePath);
	if (cached && cached.mtimeMs === stats.mtimeMs) return cached.meta;

	let data;
	try {
		data = matter(readFileSync(filePath, "utf8")).data ?? {};
	} catch {
		return null;
	}

	const meta = { filePath, data };
	frontmatterCache.set(filePath, { mtimeMs: stats.mtimeMs, meta });
	return meta;
}

function collectPostMetas() {
	const metas = [];
	const stack = [POSTS_DIR];

	while (stack.length > 0) {
		const directory = stack.pop();
		let entries;
		try {
			entries = readdirSync(directory, { withFileTypes: true });
		} catch {
			continue;
		}

		for (const entry of entries) {
			const filePath = path.join(directory, entry.name);
			if (entry.isDirectory()) {
				stack.push(filePath);
				continue;
			}
			if (!MARKDOWN_EXTENSION.test(entry.name)) continue;

			const meta = readMetaFile(filePath);
			if (meta && isPublished(meta)) metas.push(meta);
		}
	}

	return metas;
}

function findMetaBySlug(metas, target) {
	return (
		metas.find(
			(meta) =>
				typeof meta.data.slug === "string" && meta.data.slug.trim() === target,
		) ?? null
	);
}

function findMetaByBaseName(metas, target) {
	if (target.includes("/")) return null;

	const matches = metas.filter(
		(meta) =>
			path.basename(meta.filePath).replace(MARKDOWN_EXTENSION, "") === target,
	);

	if (matches.length === 1) return matches[0];
	if (matches.length > 1) {
		console.warn(
			`[remark-wiki-link] "[[${target}]]" 匹配到多个同名文章，已跳过：${matches
				.map((meta) => toContentPath(meta.filePath))
				.join(", ")}。请改用完整路径。`,
		);
	}

	return null;
}

function readPostMeta(contentPath) {
	const metas = collectPostMetas();
	const bySlug = findMetaBySlug(metas, contentPath);
	if (bySlug) return bySlug;

	const candidates = [
		`${contentPath}.md`,
		`${contentPath}.mdx`,
		`${contentPath}.markdown`,
		`${contentPath}/index.md`,
		`${contentPath}/index.mdx`,
	];

	for (const candidate of candidates) {
		const meta = readMetaFile(path.join(POSTS_DIR, candidate));
		if (meta && isPublished(meta)) return meta;
	}

	return findMetaByBaseName(metas, contentPath);
}

function formatPublishedDate(value) {
	if (value instanceof Date && !Number.isNaN(value.getTime())) {
		return value.toISOString().slice(0, 10);
	}
	if (typeof value === "string") {
		const match = value.match(/^\d{4}-\d{2}-\d{2}/);
		if (match) return match[0];
	}
	return "";
}

function parseWikiLinkValue(value) {
	const aliasSeparator = value.indexOf("|");
	const destination = (
		aliasSeparator === -1 ? value : value.slice(0, aliasSeparator)
	).trim();
	const alias =
		aliasSeparator === -1 ? "" : value.slice(aliasSeparator + 1).trim();

	if (!destination) return null;

	const headingSeparator = destination.indexOf("#");
	const pageName =
		headingSeparator === -1
			? destination
			: destination.slice(0, headingSeparator).trim();
	const heading =
		headingSeparator === -1
			? ""
			: destination.slice(headingSeparator + 1).trim();
	const contentPath = pageName ? normalizeContentPath(pageName) : "";

	if ((pageName && !contentPath) || (!contentPath && !heading)) return null;

	return { destination, alias, contentPath, heading };
}

function resolveAlias(parsed, meta) {
	if (!parsed.alias) return "";

	const noise = new Set([
		parsed.destination,
		parsed.contentPath,
		path.basename(parsed.contentPath),
	]);
	if (meta) {
		noise.add(toContentPath(meta.filePath));
		noise.add(path.basename(meta.filePath).replace(MARKDOWN_EXTENSION, ""));
	}

	return noise.has(parsed.alias) ? "" : parsed.alias;
}

function createElement(tagName, properties, children = []) {
	return {
		type: "paragraph",
		data: { hName: tagName, hProperties: properties },
		children,
	};
}

function createText(value) {
	return { type: "text", value };
}

function createRemoteCoverImage(src, properties) {
	return createElement("img", {
		src,
		alt: "",
		loading: "lazy",
		decoding: "async",
		...properties,
	});
}

function getFallbackCoverUrl() {
	const fallback = coverImageConfig.randomCoverImage.fallback;
	if (!fallback) return "";
	return fallback.startsWith("/") ? url(fallback) : fallback;
}

function createCoverNode(meta, resolvedPath, context) {
	const image =
		typeof meta.data.image === "string" ? meta.data.image.trim() : "";
	const processedImage = processCoverImageSync(image, resolvedPath);
	if (!processedImage) return null;

	const apiUrls = getApiUrlList(image, resolvedPath);
	const imageProperties = {
		className: ["wiki-link-card__cover-image", "image-pixel-reveal-source"],
		dataWikiLinkCardCoverImage: "",
		dataApiUrls: apiUrls.length > 0 ? JSON.stringify(apiUrls) : undefined,
		dataFallbackSrc: getFallbackCoverUrl() || undefined,
	};

	let imageNode;
	if (
		/^(?:https?:)?\/\//i.test(processedImage) ||
		processedImage.startsWith("data:")
	) {
		imageNode = createRemoteCoverImage(processedImage, imageProperties);
	} else if (processedImage.startsWith("/")) {
		imageNode = createRemoteCoverImage(url(processedImage), imageProperties);
	} else {
		if (!context.currentDir) return null;

		const absolutePath = path.resolve(
			path.dirname(meta.filePath),
			processedImage,
		);
		try {
			if (!statSync(absolutePath).isFile()) return null;
		} catch {
			return null;
		}

		const relativePath = path
			.relative(context.currentDir, absolutePath)
			.replaceAll("\\", "/");
		const coverUrl = relativePath.startsWith(".")
			? relativePath
			: `./${relativePath}`;

		imageNode = {
			type: "image",
			url: coverUrl,
			alt: "",
			data: { hProperties: imageProperties },
		};
	}

	return createElement(
		"div",
		{
			className: ["wiki-link-card__cover", "image-pixel-reveal-host"],
			dataWikiLinkCardCover: "",
		},
		[
			createElement("span", {
				className: "wiki-link-card__cover-loader",
				ariaHidden: "true",
			}),
			createElement("span", {
				className: "image-pixel-reveal",
				dataImagePixelReveal: "",
				ariaHidden: "true",
			}),
			imageNode,
		],
	);
}

function createWikiLinkCard(parsed, context) {
	const meta = readPostMeta(parsed.contentPath);
	if (!meta) return null;

	const resolvedPath = toPostId(meta);
	const title =
		resolveAlias(parsed, meta) ||
		(typeof meta.data.title === "string" && meta.data.title
			? meta.data.title
			: resolvedPath);
	const encrypted =
		typeof meta.data.password === "string" && meta.data.password.length > 0;
	const description =
		!encrypted && typeof meta.data.description === "string"
			? meta.data.description.trim()
			: "";
	const published = formatPublishedDate(meta.data.published);
	const category =
		typeof meta.data.category === "string" ? meta.data.category.trim() : "";
	const tags = Array.isArray(meta.data.tags)
		? meta.data.tags.filter((tag) => typeof tag === "string" && tag)
		: [];

	const metaItems = [];
	if (published) {
		metaItems.push(
			createElement("span", { className: "wiki-link-card__date" }, [
				createText(published),
			]),
		);
	}
	if (category) {
		metaItems.push(
			createElement("span", { className: "wiki-link-card__category" }, [
				createText(category),
			]),
		);
	}
	if (tags.length > 0) {
		metaItems.push(
			createElement(
				"span",
				{ className: "wiki-link-card__tags" },
				tags.map((tag) =>
					createElement("span", { className: "wiki-link-card__tag" }, [
						createText(`#${tag}`),
					]),
				),
			),
		);
	}

	const info = [
		createElement("div", { className: "wiki-link-card__title" }, [
			createText(title),
		]),
	];
	if (description) {
		info.push(
			createElement("div", { className: "wiki-link-card__description" }, [
				createText(description),
			]),
		);
	}
	if (metaItems.length > 0) {
		info.push(
			createElement("div", { className: "wiki-link-card__meta" }, metaItems),
		);
	}

	const children = [
		createElement("div", { className: "wiki-link-card__content" }, info),
	];
	const cover = createCoverNode(meta, resolvedPath, context);
	if (cover) children.push(cover);

	return createElement(
		"a",
		{
			className: ["wiki-link-card", "no-styling"],
			href: getPostUrlBySlug(resolvedPath),
			dataPagefindIgnore: "true",
		},
		children,
	);
}

function createWikiLink(value) {
	const parsed = parseWikiLinkValue(value);
	if (!parsed) return null;

	if (!parsed.contentPath) {
		return {
			type: "link",
			url: `#${slug(parsed.heading)}`,
			children: [createText(parsed.alias || parsed.heading)],
		};
	}

	const meta = readPostMeta(parsed.contentPath);
	if (!meta) return null;

	const title =
		typeof meta.data.title === "string" && meta.data.title
			? meta.data.title
			: "";
	const text =
		resolveAlias(parsed, meta) ||
		(parsed.heading
			? `${title || parsed.destination}#${parsed.heading}`
			: title);
	const url = `${getPostUrlBySlug(toPostId(meta))}${
		parsed.heading ? `#${slug(parsed.heading)}` : ""
	}`;

	return {
		type: "link",
		url,
		children: [createText(text || parsed.destination)],
	};
}

function replaceWikiLinks(value) {
	const children = [];
	let cursor = 0;
	let changed = false;

	for (const match of value.matchAll(WIKI_LINK)) {
		if (match[0].startsWith("!")) continue;

		const link = createWikiLink(match[1]);
		if (!link) continue;

		const index = match.index;
		if (index > cursor) {
			children.push({ type: "text", value: value.slice(cursor, index) });
		}
		children.push(link);
		cursor = index + match[0].length;
		changed = true;
	}

	if (!changed) return null;
	if (cursor < value.length) {
		children.push({ type: "text", value: value.slice(cursor) });
	}

	return children;
}

function tryCreateCardFromParagraph(node, context) {
	if (node.type !== "paragraph" || node.children?.length !== 1) return null;

	const child = node.children[0];
	if (child.type !== "text") return null;

	const match = child.value.trim().match(STANDALONE_WIKI_LINK);
	if (!match) return null;

	const parsed = parseWikiLinkValue(match[1]);
	if (!parsed || parsed.heading || !parsed.contentPath) return null;

	return createWikiLinkCard(parsed, context);
}

function transformNode(node, context) {
	if (SKIPPED_NODE_TYPES.has(node.type) || !Array.isArray(node.children))
		return;

	for (let index = 0; index < node.children.length; index++) {
		const child = node.children[index];
		const card = tryCreateCardFromParagraph(child, context);
		if (card) {
			node.children[index] = card;
			continue;
		}

		if (child.type === "text") {
			const replacement = replaceWikiLinks(child.value);
			if (replacement) {
				node.children.splice(index, 1, ...replacement);
				index += replacement.length - 1;
			}
			continue;
		}

		transformNode(child, context);
	}
}

/**
 * 将 Obsidian 风格 Wiki Link 转换为站内链接或文章跳转卡片。
 *
 * - [[slug]] 单独成段时输出文章卡片。
 * - [[slug|别名]] 可覆盖显示标题。
 * - 行内 [[slug]] 输出普通站内链接。
 * - [[slug#标题]] 与 [[#标题]] 始终输出锚点链接。
 */
export function remarkWikiLink() {
	return (tree, file) => {
		const context = {
			currentDir: file?.path ? path.dirname(file.path) : null,
		};
		transformNode(tree, context);
	};
}
