/**
 * 构建期生成 LQIP（Low Quality Image Placeholder）数据。
 *
 * 把每张图片缩到 2x2 取角点颜色，压成 18 字符 hex 存进 src/constants/lqips.json，
 * 运行时由 src/utils/lqip-utils.ts 解码成 CSS 渐变作为占位背景。
 * 相比内联 base64 缩略图，单张只占 18 字节且不产生额外请求。
 *
 * 增量执行：已有条目直接复用，只处理新增图片，并清理已删除图片的残留条目。
 *
 * LQIP 方案参考: https://blog.cosine.ren/post/astro-lqip-implementation
 */

import fs from "node:fs/promises";
import path from "node:path";
import { glob } from "glob";
import sharp from "sharp";

const SRC_DIR = "src";
const PUBLIC_DIR = "public";
const OUTPUT_FILE = "src/constants/lqips.json";

// 不需要占位色的目录：看板娘贴图集、favicon、字体与音频封面之外的静态件
const IGNORE_DIRS = [
	"public/favicon/**",
	"public/pio/**",
	"public/fonts/**",
];

type LqipMap = Record<string, string>;

interface RgbColor {
	r: number;
	g: number;
	b: number;
}

function rgbToHex(color: RgbColor): string {
	const hex = (value: number) => value.toString(16).padStart(2, "0");
	return `${hex(color.r)}${hex(color.g)}${hex(color.b)}`;
}

/** 缩到 2x2 后取左上、右上、右下三个角，拼成 18 字符紧凑串 */
async function processImage(imagePath: string): Promise<string | null> {
	try {
		const { data, info } = await sharp(imagePath)
			.resize(2, 2, { fit: "fill" })
			.raw()
			.toBuffer({ resolveWithObject: true });

		const channels = info.channels;
		const corners: RgbColor[] = [];
		for (let index = 0; index < 4; index++) {
			const offset = index * channels;
			corners.push({
				r: data[offset],
				g: data[offset + 1],
				b: data[offset + 2],
			});
		}

		return `${rgbToHex(corners[0])}${rgbToHex(corners[1])}${rgbToHex(corners[3])}`;
	} catch (error) {
		console.error(`[lqip] 处理失败 ${imagePath}:`, error);
		return null;
	}
}

/** public 图片用 `public:` 前缀，src 图片用 `src:` 前缀，避免同名冲突 */
function filePathToKey(filePath: string): string {
	const normalized = filePath.replace(/\\/g, "/");
	if (normalized.startsWith(`${PUBLIC_DIR}/`)) {
		return `public:${path.relative(PUBLIC_DIR, normalized).replace(/\\/g, "/")}`;
	}
	return `src:${path.relative(SRC_DIR, normalized).replace(/\\/g, "/")}`;
}

async function readExistingLqips(): Promise<LqipMap> {
	try {
		const content = await fs.readFile(OUTPUT_FILE, "utf-8");
		return JSON.parse(content) as LqipMap;
	} catch {
		return {};
	}
}

async function main(): Promise<void> {
	const existing = await readExistingLqips();
	const files = await glob("{src,public}/**/*.{png,jpg,jpeg,webp,avif}", {
		ignore: IGNORE_DIRS,
	});

	if (files.length === 0) {
		console.log("[lqip] 未找到图片，跳过");
		return;
	}

	const lqips: LqipMap = { ...existing };

	// 清理已删除图片留下的条目，避免 json 无限膨胀
	const currentKeys = new Set(files.map(filePathToKey));
	const staleKeys = Object.keys(lqips).filter((key) => !currentKeys.has(key));
	for (const key of staleKeys) {
		delete lqips[key];
	}

	const pendingFiles = files.filter(
		(file) => !(filePathToKey(file) in existing),
	);
	console.log(
		`[lqip] 共 ${files.length} 张图片，新增 ${pendingFiles.length} 张待处理，清理 ${staleKeys.length} 条失效记录`,
	);

	let processed = 0;
	for (const file of pendingFiles) {
		const compact = await processImage(path.resolve(file));
		if (compact === null) continue;
		lqips[filePathToKey(file)] = compact;
		processed++;
	}

	// 用制表符缩进与 Biome 的格式化结果保持一致，避免 pnpm lint 反复改写
	const sorted = Object.fromEntries(
		Object.entries(lqips).sort(([left], [right]) => left.localeCompare(right)),
	);
	await fs.mkdir(path.dirname(OUTPUT_FILE), { recursive: true });
	await fs.writeFile(
		OUTPUT_FILE,
		`${JSON.stringify(sorted, null, "\t")}\n`,
		"utf-8",
	);

	console.log(
		`[lqip] 完成，新增 ${processed}/${pendingFiles.length}，合计 ${Object.keys(sorted).length} 条 → ${OUTPUT_FILE}`,
	);
}

main();
