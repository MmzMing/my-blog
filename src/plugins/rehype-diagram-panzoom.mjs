import { h } from "hastscript";
import { visit } from "unist-util-visit";
import clientScript from "./diagram-panzoom-script.js?raw";

const injectedTrees = new WeakSet();

function hasClass(node, className) {
	const classes = node.properties?.className ?? node.properties?.class;
	if (Array.isArray(classes)) return classes.includes(className);
	if (typeof classes === "string")
		return classes.split(/\s+/).includes(className);
	return false;
}

export function rehypeDiagramPanZoom() {
	return (tree) => {
		if (injectedTrees.has(tree)) return;

		let hasDiagram = false;
		visit(tree, "element", (node) => {
			if (node.tagName === "div" && hasClass(node, "diagram-container")) {
				hasDiagram = true;
			}
		});

		if (!hasDiagram) return;

		injectedTrees.add(tree);
		tree.children = [
			...(tree.children || []),
			h("script", { type: "text/javascript" }, clientScript),
		];
	};
}
