/**
 * 导航工具函数
 * 提供统一的页面导航功能，支持 Swup 无刷新跳转
 */
import {
	isHomePage as isHomePageByPath,
	isPostPage as isPostPageByPath,
} from "@/utils/layout-utils";
import { getSwup } from "@/utils/swup-lifecycle";

/**
 * 导航到指定页面
 * @param url 目标页面URL
 * @param options 导航选项
 */
export function navigateToPage(
	url: string,
	options?: {
		replace?: boolean;
		force?: boolean;
	},
): void {
	// 检查 URL 是否有效
	if (!url || typeof url !== "string") {
		console.warn("navigateToPage: Invalid URL provided");
		return;
	}

	// 如果是外部链接，直接跳转
	if (
		url.startsWith("http://") ||
		url.startsWith("https://") ||
		url.startsWith("//")
	) {
		const w = window.open(url, "_blank", "noopener,noreferrer");
		if (w) w.opener = null;
		return;
	}

	// 如果是锚点链接，滚动到对应位置
	if (url.startsWith("#")) {
		const element = document.getElementById(url.slice(1));
		if (element) {
			element.scrollIntoView({ behavior: "smooth" });
		}
		return;
	}

	// Swup 尚未就绪（实例是 module 脚本异步挂上来的）时降级为整页跳转
	const swup = getSwup();
	if (!swup) {
		fallbackNavigation(url, options);
		return;
	}

	try {
		// swup 4 的 history 只认 "push" / "replace"，传别的值会被静默忽略掉，
		// 于是 replace 语义会退化成 push —— 这里必须给字符串
		swup.navigate(url, options?.replace ? { history: "replace" } : undefined);
	} catch (error) {
		console.error("Swup navigation failed:", error);
		fallbackNavigation(url, options);
	}
}

/**
 * 降级导航函数
 * 当 Swup 不可用时使用普通的页面跳转
 */
function fallbackNavigation(
	url: string,
	options?: {
		replace?: boolean;
		force?: boolean;
	},
): void {
	if (options?.replace) {
		window.location.replace(url);
	} else {
		window.location.href = url;
	}
}

/**
 * 获取当前页面路径
 */
export function getCurrentPath(): string {
	return typeof window !== "undefined" ? window.location.pathname : "";
}

/**
 * 检查是否为首页
 */
export function isHomePage(): boolean {
	return isHomePageByPath(getCurrentPath());
}

export function isPostPage(): boolean {
	return isPostPageByPath(getCurrentPath());
}

declare global {
	interface Window {
		navigateToPage: typeof navigateToPage;
	}
}
