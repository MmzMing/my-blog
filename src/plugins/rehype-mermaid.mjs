import { readFile } from "node:fs/promises";
import { assertSafeSvgForDom, initMerman, renderSvg } from "@mermanjs/web";
import { h } from "hastscript";
import { visit } from "unist-util-visit";
import {
	DIAGRAM_CONTAINER,
	DIAGRAM_WRAPPER,
	MERMAID_CONTAINER,
	MERMAID_ERROR,
	MERMAID_FALLBACK_CODE,
	MERMAID_SVG_DARK,
	MERMAID_SVG_LIGHT,
	MERMAID_WRAPPER,
} from "./utils/diagramConstants.js";
import { extractText } from "./utils/extractText.js";

const mermanWasmUrl = import.meta.resolve(
	"@mermanjs/web/pkg/merman_wasm_bg.wasm",
);

await initMerman({
	wasm: {
		module_or_path: await readFile(new URL(mermanWasmUrl)),
	},
});

function removeSvgMaxWidth(svg) {
	return svg.replace(/(<svg[^>]*style="[^"]*?)max-width:\s*[^;]+;?/, "$1");
}

// 站点灰阶覆盖：editor-* 预设自带冷蓝/蓝灰色系，且节点描边是硬编码黑色，与站点中性灰阶
// （variables.styl）不统一。roles 只覆盖通用语义，节点描边等仍需显式 themeVariables，
// 两者都由这份色板生成，保证「簇 → 节点 → 页面」三层能分出递进。
const LIGHT_PALETTE = {
	text: "#1a1a1a",
	surface: "#f5f5f5",
	cluster: "#fafafa",
	surfaceAlt: "#ededed",
	border: "#d4d4d4",
	line: "#737373",
	edgeLabel: "#ffffff",
	error: "#737373",
};

const DARK_PALETTE = {
	text: "#dadada",
	surface: "#161616",
	cluster: "#161616",
	surfaceAlt: "#212121",
	border: "#2e2e2e",
	line: "#999999",
	edgeLabel: "#101010",
	error: "#999999",
};

function buildHostTheme(palette) {
	const { text, surface, cluster, surfaceAlt, border, line, edgeLabel, error } =
		palette;
	return {
		roles: {
			text,
			surface,
			surface_alt: cluster,
			border,
			line,
			edge_label_background: edgeLabel,
			cluster_background: cluster,
			cluster_border: border,
			note_background: surface,
			note_border: border,
			note_text: text,
			actor_background: surface,
			actor_border: border,
			activation_background: surfaceAlt,
			activation_border: border,
			// 解析错误占位也走灰阶，不让预设的红色混进黑白灰体系
			error,
			warning: error,
			success: error,
		},
		themeVariables: {
			primaryColor: surface,
			primaryBorderColor: border,
			primaryTextColor: text,
			secondaryColor: cluster,
			secondaryBorderColor: border,
			tertiaryColor: surfaceAlt,
			tertiaryBorderColor: border,
			nodeBorder: border,
			mainBkg: surface,
			nodeTextColor: text,
			textColor: text,
			lineColor: line,
			clusterBkg: cluster,
			clusterBorder: border,
			edgeLabelBackground: edgeLabel,
			noteBkgColor: surface,
			noteBorderColor: border,
			noteTextColor: text,
			actorBkg: surface,
			actorBorder: border,
			actorTextColor: text,
			actorLineColor: border,
			signalColor: line,
			signalTextColor: text,
			labelTextColor: text,
			labelBoxBkgColor: surface,
			labelBoxBorderColor: border,
			activationBkgColor: surfaceAlt,
			activationBorderColor: border,
			stateBkg: surface,
			stateBorder: border,
			stateLabelColor: text,
			transitionColor: line,
			transitionLabelColor: text,
			classText: text,
			labelColor: text,
			titleColor: text,
			errorBkgColor: surface,
			errorTextColor: error,
		},
	};
}

const LIGHT_HOST_THEME = buildHostTheme(LIGHT_PALETTE);
const DARK_HOST_THEME = buildHostTheme(DARK_PALETTE);

// 与 main.css 的正文字体栈一致，让构建期度量与浏览器实际渲染尽量对齐
const DIAGRAM_FONT_FAMILY =
	'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif';

// 无头渲染的字体度量偏窄，节点内文字会贴边甚至压线，加大内边距留出余量
const FLOWCHART_CONFIG = {
	padding: 16,
	nodeSpacing: 60,
	rankSpacing: 70,
	useMaxWidth: false,
};

function siteConfigWithFont() {
	return {
		fontFamily: DIAGRAM_FONT_FAMILY,
		flowchart: FLOWCHART_CONFIG,
	};
}

function buildMermaidSvgs(mermaidCode, themeConfig, diagramIndex) {
	const lightSvg = renderSvg(mermaidCode, {
		host_theme: {
			preset: themeConfig.lightTheme,
			...LIGHT_HOST_THEME,
			font_family: DIAGRAM_FONT_FAMILY,
			output: { root_background: "transparent" },
		},
		site_config: siteConfigWithFont(),
		// vendored 度量给出的节点比 deterministic 更宽更高，CJK 换行文字不易压到下边框
		layout: { text_measurer: "vendored" },
		svg: {
			diagram_id: `mermaid-${diagramIndex}-light`,
			pipeline: "parity",
		},
	});
	const darkSvg = renderSvg(mermaidCode, {
		host_theme: {
			preset: themeConfig.darkTheme,
			...DARK_HOST_THEME,
			font_family: DIAGRAM_FONT_FAMILY,
			output: { root_background: "transparent" },
		},
		site_config: siteConfigWithFont(),
		svg: {
			diagram_id: `mermaid-${diagramIndex}-dark`,
			pipeline: "parity",
		},
	});

	assertSafeSvgForDom(lightSvg);
	assertSafeSvgForDom(darkSvg);

	return {
		lightSvg: removeSvgMaxWidth(lightSvg),
		darkSvg: removeSvgMaxWidth(darkSvg),
	};
}

export function rehypeMermaid(options = {}) {
	const themeConfig = {
		lightTheme: options.lightTheme || "editor-light",
		darkTheme: options.darkTheme || "editor-dark",
	};

	return (tree, file) => {
		let diagramIndex = 0;

		visit(tree, "element", (node) => {
			if (
				node.tagName !== "div" ||
				!node.properties?.className?.includes("mermaid-container")
			) {
				return;
			}

			let mermaidCode = node.properties["data-mermaid-code"] || "";
			if (!mermaidCode) {
				mermaidCode = extractText(node).trim();
			}

			const currentIndex = diagramIndex;
			diagramIndex += 1;

			let lightSvg;
			let darkSvg;
			try {
				({ lightSvg, darkSvg } = buildMermaidSvgs(
					mermaidCode,
					themeConfig,
					currentIndex,
				));
			} catch (error) {
				const source =
					file?.path || file?.history?.[0] || "unknown markdown file";
				const message = `[rehype-mermaid] ${source} diagram ${currentIndex + 1} failed: ${
					error instanceof Error ? error.message : String(error)
				}`;

				if (process.env.NODE_ENV === "production") {
					throw new Error(message, { cause: error });
				}

				console.error(message);
				node.properties = {
					class: `${DIAGRAM_CONTAINER} ${MERMAID_CONTAINER}`,
				};
				node.children = [
					h("div", { class: MERMAID_ERROR }, [
						h("p", {}, `${source} - Mermaid 图表 ${currentIndex + 1} 渲染失败`),
						h("pre", { class: MERMAID_FALLBACK_CODE }, mermaidCode),
					]),
				];
				return;
			}

			node.properties = {
				class: `${DIAGRAM_CONTAINER} ${MERMAID_CONTAINER}`,
			};
			node.children = [
				h(
					"div",
					{
						class: `${DIAGRAM_WRAPPER} ${MERMAID_WRAPPER}`,
						"data-generated-diagram": "mermaid",
					},
					[
						h("div", { class: MERMAID_SVG_LIGHT }, [
							{ type: "raw", value: lightSvg },
						]),
						h("div", { class: MERMAID_SVG_DARK }, [
							{ type: "raw", value: darkSvg },
						]),
					],
				),
			];
		});
	};
}
