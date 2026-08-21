import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import type { GalleryAlbum } from "@/types/config";
import { url } from "@/utils/url-utils";

export interface GalleryPhoto {
	src: string;
	width: number;
	height: number;
}

function withBase(assetPath: string): string {
	if (!assetPath) return "";
	if (/^(https?:)?\/\//i.test(assetPath) || /^(data|blob):/i.test(assetPath)) {
		return assetPath;
	}
	const normalizedPath = assetPath.startsWith("/")
		? assetPath
		: `/${assetPath}`;
	const base = import.meta.env.BASE_URL || "/";
	if (base !== "/" && normalizedPath.startsWith(base)) {
		return normalizedPath;
	}
	return url(normalizedPath);
}

/**
 * 扫描相册目录中的所有图片文件
 */
export async function scanAlbumPhotos(
	albumId: string,
): Promise<GalleryPhoto[]> {
	const dir = path.join(process.cwd(), "public", "gallery", albumId);
	if (!fs.existsSync(dir)) return [];
	const files = fs
		.readdirSync(dir)
		.filter((f) => /\.(jpe?g|png|webp|avif|gif)$/i.test(f))
		.sort();
	// 将 cover.* 排到第一位
	const coverIdx = files.findIndex((f) => /^cover\./i.test(f));
	if (coverIdx > 0) {
		const [coverFile] = files.splice(coverIdx, 1);
		files.unshift(coverFile);
	}
	return Promise.all(
		files.map(async (file) => {
			const filePath = path.join(dir, file);
			const { width, height } = await sharp(filePath).metadata();
			if (!width || !height) {
				throw new Error(`Unable to read image dimensions: ${filePath}`);
			}

			return {
				src: withBase(`/gallery/${albumId}/${file}`),
				width,
				height,
			};
		}),
	);
}

/**
 * 获取相册封面图
 * 优先级：手动指定 > cover.* 文件 > 第一张图片
 */
export function getAlbumCover(
	album: GalleryAlbum,
	photos: GalleryPhoto[],
): string {
	if (album.cover) return withBase(album.cover);
	const coverFile = photos.find((photo) => /\/cover\./i.test(photo.src));
	return coverFile?.src || photos[0]?.src || "";
}
