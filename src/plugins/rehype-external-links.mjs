import { visit } from "unist-util-visit";

// Google favicon 服务的国内节点：大陆可直连、统一返回 32px，查不到图标时回落为地球图标
const FAVICON_ENDPOINT = "https://t3.gstatic.cn/faviconV2";

// 与右侧目录纸飞机同款形状：描边 / 实心两版内联，悬停时用 CSS 切换
const PLANE_PATH = "M12 2 20.5 21 12 17.5 3.5 21z";

// hast 属性名不走 SVG 大小写映射，故直接写序列化后的属性名（stroke-width 等）
function planeSvg(className, filled) {
	return {
		type: "element",
		tagName: "svg",
		properties: {
			className: [className],
			viewBox: "0 0 24 24",
			xmlns: "http://www.w3.org/2000/svg",
		},
		children: [
			{
				type: "element",
				tagName: "path",
				properties: {
					d: PLANE_PATH,
					fill: filled ? "currentColor" : "none",
					stroke: "currentColor",
					"stroke-width": "1.5",
					"stroke-linejoin": "round",
				},
				children: [],
			},
		],
	};
}

function createNavigationIcon() {
	return {
		type: "element",
		tagName: "span",
		properties: {
			className: ["external-navigation-icon"],
			"aria-hidden": "true",
		},
		children: [
			planeSvg("external-navigation-icon__line", false),
			planeSvg("external-navigation-icon__fill", true),
		],
	};
}

function createFavicon(origin) {
	const params = new URLSearchParams({
		client: "SOCIAL",
		type: "FAVICON",
		fallback_opts: "TYPE,SIZE,URL",
		url: origin,
		size: "32",
	});
	return {
		type: "element",
		tagName: "img",
		properties: {
			className: ["external-link__favicon"],
			src: `${FAVICON_ENDPOINT}?${params}`,
			alt: "",
			loading: "lazy",
			decoding: "async",
			referrerPolicy: "no-referrer",
			// 服务不可达时移除图标，避免链接前留出空位；内联写法在 Swup 换页后同样生效
			onError: "this.remove()",
		},
		children: [],
	};
}

/**
 * 为文章中的外部链接添加 target="_blank" 和 rel="noopener noreferrer"，
 * 并在链接前后插入目标站点 favicon 与跳转纸飞机、加上 external-link 类
 * （悬停变青由 CSS 实现，跟随鼠标的跳转提示见 external-link-tooltip-controller.ts）
 * 仅处理以 http:// 或 https:// 开头且不属于本站的链接
 *
 * @param {Object} options
 * @param {string} [options.siteUrl] - 站点URL，用于判断是否为内部链接
 * @returns {Function} rehype transformer
 */
export default function rehypeExternalLinks(options = {}) {
	const siteUrl = options.siteUrl || "";
	let siteHost = "";
	try {
		siteHost = new URL(siteUrl).host;
	} catch (_e) {
		/* ignore */
	}

	return (tree) => {
		visit(tree, "element", (node) => {
			if (node.tagName !== "a") return;

			const href = node.properties?.href;
			if (typeof href !== "string") return;

			// 只处理 http/https 绝对链接
			if (!href.startsWith("http://") && !href.startsWith("https://")) return;

			let url = null;
			try {
				url = new URL(href);
			} catch (_e) {
				/* 解析失败仍按外链处理，只是不加图标 */
			}

			// 跳过本站链接
			if (url && siteHost && url.host === siteHost) return;

			node.properties.target = "_blank";
			node.properties.rel = "noopener noreferrer";

			if (!url) return;
			node.properties.className = [
				...(node.properties.className ?? []),
				"external-link",
			];
			node.properties.dataExternalDomain = url.hostname;
			// 正文单独包一层：下划线只画在文字上，前后两个图标不跟着出现虚线。
			const label = {
				type: "element",
				tagName: "span",
				properties: { className: ["external-link__label"] },
				children: node.children,
			};
			node.children = [
				createFavicon(url.origin),
				label,
				createNavigationIcon(),
			];
		});
	};
}
