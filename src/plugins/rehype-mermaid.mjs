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

// 暗色角色的站点灰阶覆盖：editor-dark 预设内置 Slate 蓝灰色系（边文字继承黑色、
// subgraph 框 #1e293b/#475569），与站点暗色的中性灰阶（见 variables.styl）不统一。
// 色值全部取自 variables.styl 暗色段：正文 #dadada、表面 #161616、描边 #2e2e2e、
// 页面锚点 #101010、弱化文字 #999999。
const DARK_THEME_ROLES = {
	text: "#dadada",
	surface: "#161616",
	border: "#2e2e2e",
	line: "#999999",
	edge_label_background: "#101010",
	cluster_background: "#161616",
	cluster_border: "#2e2e2e",
	actor_background: "#161616",
	actor_border: "#2e2e2e",
	activation_background: "#212121",
	activation_border: "#2e2e2e",
};

function buildMermaidSvgs(mermaidCode, themeConfig, diagramIndex) {
	const lightSvg = renderSvg(mermaidCode, {
		host_theme: {
			preset: themeConfig.lightTheme,
			output: { root_background: "transparent" },
		},
		svg: {
			diagram_id: `mermaid-${diagramIndex}-light`,
			pipeline: "parity",
		},
	});
	const darkSvg = renderSvg(mermaidCode, {
		host_theme: {
			preset: themeConfig.darkTheme,
			roles: DARK_THEME_ROLES,
			output: { root_background: "transparent" },
		},
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
