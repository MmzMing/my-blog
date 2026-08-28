/**
 * LQIP 占位色解码。
 *
 * 数据由 scripts/generate-lqips.ts 在构建前生成到 src/constants/lqips.json，
 * 每张图 18 字符 hex（三个角点颜色），这里解码成 CSS 斜向渐变当占位背景，
 * 不产生额外请求。
 *
 * 本模块 import 了整份 lqips.json，只允许被 .astro frontmatter 或构建期工具引用；
 * 一旦被 .svelte 客户端组件导入，整份 json 会被打进客户端 bundle。
 *
 * LQIP 方案参考: https://blog.cosine.ren/post/astro-lqip-implementation
 */

import lqipData from "@constants/lqips.json";

const lqips: Record<string, string> = lqipData;

const COMPACT_LENGTH = 18;

function isRemoteImage(src: string): boolean {
	return (
		src.startsWith("http://") ||
		src.startsWith("https://") ||
		src.startsWith("//") ||
		src.startsWith("data:")
	);
}

function normalizePath(value: string): string {
	return value.replace(/\/\.\//g, "/").replace(/\/+/g, "/");
}

function toGradient(compact: string | undefined): string | undefined {
	if (compact?.length !== COMPACT_LENGTH) return undefined;
	const start = `#${compact.slice(0, 6)}`;
	const middle = `#${compact.slice(6, 12)}`;
	const end = `#${compact.slice(12, 18)}`;
	return `linear-gradient(135deg, ${start} 0%, ${middle} 50%, ${end} 100%)`;
}

/**
 * 取图片对应的 LQIP 渐变。
 * @param src - 图片路径（远程 URL / `/` 开头的 public 路径 / 相对 src 的路径）
 * @param basePath - 相对路径的解析基准（如文章所在目录），仅本地相对路径需要
 */
export function getLqipGradient(
	src: string,
	basePath?: string,
): string | undefined {
	if (!src || isRemoteImage(src)) return undefined;

	if (src.startsWith("/")) {
		return toGradient(lqips[`public:${src.replace(/^\//, "")}`]);
	}

	const fullPath = normalizePath(basePath ? `${basePath}/${src}` : src);
	return toGradient(lqips[`src:${fullPath}`] ?? lqips[`src:${src}`]);
}

/**
 * 取可直接写进 style 属性的 LQIP 背景声明；无数据（远程图、未收录）时返回 undefined，
 * 由调用方自己的容器底色兜底。
 */
export function getLqipStyle(
	src: string,
	basePath?: string,
): string | undefined {
	const gradient = getLqipGradient(src, basePath);
	return gradient ? `background-image: ${gradient}` : undefined;
}
