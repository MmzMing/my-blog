/**
 * 构建期封面图解析与优化。
 *
 * 文章 frontmatter 的 image 字段有三种形态，处理方式不同：
 * - 相对路径（`./assets/x.webp`）：src 下的资源，交给 Astro 图片服务 resize + 转码，产出 srcset；
 * - `/` 开头：public 下的资源，Astro 不做优化，只能原样引用；
 * - http(s) / data:：远程图，同样无法在构建期处理，只补 referrerpolicy。
 *
 * 之前列表页与文章页各自 glob 一遍再取 ImageMetadata.src，拿到的是**未经优化的源资产**，
 * 等于把原图直接塞进卡片。这里统一收口，并把 LQIP 占位色一并算好。
 *
 * 本模块用到 import.meta.glob 与 astro:assets，只能在构建期（.astro frontmatter）使用。
 */

import { getImage } from "astro:assets";
import path from "node:path";
import type { ImageMetadata } from "astro";
import type { ImageFormat } from "@/types/config";
import type { CoverImageSource } from "@/types/cover-image";
import {
	getFallbackFormat,
	getImageFormats,
	getImageQuality,
	shouldAddNoReferrer,
} from "./image-utils";
import { getLqipStyle } from "./lqip-utils";
import { url } from "./url-utils";

const projectImages = import.meta.glob<ImageMetadata>(
	"/src/**/*.{png,jpg,jpeg,webp,avif,gif}",
	{ import: "default" },
);

interface BuildCoverImageOptions {
	/** frontmatter 里的原始 image 值，或已处理过的随机图 URL */
	image: string;
	/** 相对路径的解析基准，取 getFileDirFromPath(entry.filePath) */
	basePath?: string;
	/** 构建期产出的候选宽度，会被源图宽度截断 */
	widths: number[];
	/** 与候选宽度配套的 sizes 描述 */
	sizes: string;
}

function isRemoteImage(image: string): boolean {
	return (
		image.startsWith("http://") ||
		image.startsWith("https://") ||
		image.startsWith("//") ||
		image.startsWith("data:")
	);
}

/** 在构建期资源表里定位 src 下的图片；找不到返回 null */
async function loadLocalImage(
	image: string,
	basePath: string,
): Promise<ImageMetadata | null> {
	const relative = image.replace(/^\.\//, "");
	const fullPath = path
		.normalize(path.join(basePath, relative))
		.replace(/\\/g, "/");
	const loader = projectImages[`/src/${fullPath}`];
	if (!loader) {
		console.error(
			`[cover-image] 封面图未找到: /src/${fullPath}（image="${image}", basePath="${basePath}"）`,
		);
		return null;
	}
	return loader();
}

/**
 * 把封面图解析成可直接渲染的数据。
 * @returns 无封面（image 为空）或本地文件缺失时返回 null，调用方据此决定不渲染封面区域
 */
export async function buildCoverImage(
	options: BuildCoverImageOptions,
): Promise<CoverImageSource | null> {
	const { image, basePath = "", widths, sizes } = options;
	if (!image) return null;

	if (isRemoteImage(image)) {
		return {
			src: image,
			sources: [],
			referrerPolicy: shouldAddNoReferrer(image) ? "no-referrer" : undefined,
		};
	}

	// public 下的资源不经过 Astro 图片服务，只能原样引用
	if (image.startsWith("/")) {
		const publicSrc = url(image);
		return {
			src: publicSrc,
			sources: [],
			lqipStyle: getLqipStyle(image),
			referrerPolicy: shouldAddNoReferrer(publicSrc)
				? "no-referrer"
				: undefined,
		};
	}

	const metadata = await loadLocalImage(image, basePath);
	if (!metadata) return null;

	// 不做放大：候选宽度全部截断到源图宽度以内并去重
	const targetWidths = [
		...new Set(widths.map((width) => Math.min(width, metadata.width))),
	].sort((left, right) => left - right);
	const maxWidth = targetWidths[targetWidths.length - 1];
	const quality = getImageQuality();
	const fallbackFormat = getFallbackFormat();

	// layout: "none" 让 Astro 不自行推导 widths/sizes、也不注入响应式内联样式，
	// 尺寸完全由本仓库既有 CSS 控制
	const optimize = (format: ImageFormat) =>
		getImage({
			src: metadata,
			widths: targetWidths,
			width: maxWidth,
			sizes,
			format,
			quality,
			layout: "none",
		});

	const fallback = await optimize(fallbackFormat);
	const extraFormats = getImageFormats().filter(
		(format) => format !== fallbackFormat,
	);
	const sources = await Promise.all(
		extraFormats.map(async (format) => ({
			type: `image/${format}`,
			srcset: (await optimize(format)).srcSet.attribute,
		})),
	);

	return {
		src: fallback.src,
		srcset: fallback.srcSet.attribute || undefined,
		sizes,
		sources,
		width: maxWidth,
		height: Math.round((maxWidth * metadata.height) / metadata.width),
		lqipStyle: getLqipStyle(image, basePath),
	};
}
