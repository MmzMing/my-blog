/**
 * 清理 Astro 构建后没有被任何页面引用的 _astro WebP。
 * Astro 会为同一张源图生成并复制多套变体，其中一部分没有进入最终 HTML；
 * 只删图片，不处理可能被动态加载的 JS/CSS。
 */
import fs from "node:fs";
import path from "node:path";

const DIST_DIR = path.resolve("dist");
const ASTRO_DIR = path.join(DIST_DIR, "_astro");
const TEXT_EXTENSIONS = new Set([
	".html",
	".xml",
	".json",
	".css",
	".js",
	".md",
	".txt",
	".svg",
]);

if (!fs.existsSync(ASTRO_DIR)) {
	process.exit(0);
}

const references = new Set();

function collectReferences(dir) {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const fullPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			collectReferences(fullPath);
			continue;
		}
		if (!TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
			continue;
		}
		const content = fs.readFileSync(fullPath, "utf8");
		for (const match of content.matchAll(
			/(?<![A-Za-z0-9_.-])\/_astro\/([^"'\s,)>]+)/g,
		)) {
			const name = match[1].split(/[?#]/, 1)[0];
			try {
				references.add(decodeURIComponent(name));
			} catch {
				references.add(name);
			}
		}
	}
}

collectReferences(DIST_DIR);

let removed = 0;
let removedBytes = 0;

for (const name of fs.readdirSync(ASTRO_DIR)) {
	if (!name.endsWith(".webp") || references.has(name)) {
		continue;
	}
	const file = path.join(ASTRO_DIR, name);
	removedBytes += fs.statSync(file).size;
	fs.unlinkSync(file);
	removed += 1;
}

console.log(
	`[prune-assets] removed ${removed} unreferenced WebP (${(removedBytes / 1048576).toFixed(2)} MiB)`,
);
