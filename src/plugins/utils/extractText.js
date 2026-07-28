export function extractText(node) {
	if (node.type === "text") return node.value || "";
	if (!node.children) return "";
	return node.children.map(extractText).join("");
}
