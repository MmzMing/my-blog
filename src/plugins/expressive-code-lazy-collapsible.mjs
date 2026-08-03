import { definePlugin } from "@expressive-code/core";
import {
	getClassNames,
	h,
	select,
	setProperty,
	toHtml,
} from "@expressive-code/core/hast";

const DEFAULT_LINE_THRESHOLD = 200;
const DEFAULT_PREVIEW_LINES = 8;

function isCodeLine(node) {
	return node.type === "element" && getClassNames(node).includes("ec-line");
}

export function pluginLazyCollapsibleCode(options = {}) {
	const lineThreshold = options.lineThreshold ?? DEFAULT_LINE_THRESHOLD;
	const previewLines = options.previewLines ?? DEFAULT_PREVIEW_LINES;

	return definePlugin({
		name: "Lazy Collapsible Code",
		hooks: {
			postprocessRenderedBlock(context) {
				const lineCount = context.codeBlock.code.split("\n").length;
				if (lineCount < lineThreshold) return;

				const blockAst = context.renderData.blockAst;
				const frame =
					blockAst.type === "element" &&
					getClassNames(blockAst).includes("ec-collapse")
						? blockAst
						: select(".ec-collapse", blockAst);
				const code = frame ? select("code", frame) : null;
				if (!frame || !code || !Array.isArray(code.children)) return;

				let visibleLineCount = 0;
				let splitIndex = -1;
				for (let index = 0; index < code.children.length; index += 1) {
					if (!isCodeLine(code.children[index])) continue;
					visibleLineCount += 1;
					if (visibleLineCount === previewLines) {
						splitIndex = index;
						break;
					}
				}

				if (splitIndex < 0 || splitIndex === code.children.length - 1) return;

				const deferredChildren = code.children.splice(splitIndex + 1);
				const deferredHtml = deferredChildren
					.map((node) => toHtml(node))
					.join("");
				code.children.push(
					h("template", {
						class: "ec-collapse__lazy-template",
						"data-deferred-html": Buffer.from(deferredHtml, "utf8").toString(
							"base64",
						),
						"data-deferred-lines": String(lineCount - previewLines),
					}),
				);

				setProperty(frame, "data-ec-lazy-code", "true");
				setProperty(frame, "data-ec-lazy-total-lines", String(lineCount));
			},
		},
	});
}
