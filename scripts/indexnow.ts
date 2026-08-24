#!/usr/bin/env node
/**
 * IndexNow 主动推送脚本
 *
 * 用法:
 *   pnpm indexnow <文章id>...        提交指定文章（id 为 src/content/posts 下的相对路径，去掉扩展名）
 *   pnpm indexnow --diff             提交相对 HEAD 变更的文章（含未跟踪的新文件）
 *   pnpm indexnow --all              提交所有已发布文章
 *   pnpm indexnow --url <url>...     提交任意 URL（如首页、归档页）
 *   pnpm indexnow --dry-run ...      仅打印将要提交的 URL，不调用 API
 *   pnpm indexnow -h | --help        显示帮助
 *
 * 示例:
 *   pnpm indexnow my-post
 *   pnpm indexnow 2024/foo 2024/bar
 *   pnpm indexnow --diff
 *   pnpm indexnow --all --dry-run
 *   pnpm indexnow --url https://tblog.mmzhiku.xyz/
 *
 * 说明:
 *   - 密钥从 .env 的 INDEXNOW_KEY 读取，验证文件位于 public/{key}.txt
 *   - 文章 URL 格式: {site_url}/posts/{slug}/  （slug 小写）
 *   - 单次最多提交 10000 个 URL，超出会自动分批
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { siteConfig } from "../src/config/siteConfig";
import { loadPostFiles } from "./post-loader";

const INDEXNOW_API = "https://api.indexnow.org/indexnow";
const MAX_URLS_PER_REQUEST = 10000;

function loadEnvironment(cwd = process.cwd()): void {
	const filePath = path.resolve(cwd, ".env");
	if (fs.existsSync(filePath)) process.loadEnvFile(filePath);
}

/** 收集相对 HEAD 变更的文章 slug（含已暂存、未跟踪的新文件，排除已删除） */
function getChangedPostSlugs(cwd = process.cwd()): string[] {
	const changed = execSync(
		'git diff --name-only HEAD -- "src/content/posts/"',
		{ cwd, encoding: "utf-8" },
	).trim();
	const untracked = execSync(
		'git ls-files --others --exclude-standard -- "src/content/posts/"',
		{ cwd, encoding: "utf-8" },
	).trim();
	const lines = [changed, untracked].filter(Boolean).join("\n").split("\n");
	const slugs = new Set<string>();
	for (const line of lines) {
		const file = line.trim();
		if (!file || !/\.(md|mdx)$/i.test(file)) continue;
		// 仅保留实际存在的文件，跳过已删除
		if (!fs.existsSync(path.resolve(cwd, file))) continue;
		const slug = file
			.replace(/^src\/content\/posts\//, "")
			.replace(/\.(md|mdx)$/i, "");
		slugs.add(slug);
	}
	return [...slugs];
}

function buildPostUrl(siteUrl: string, slug: string): string {
	const base = siteUrl.replace(/\/+$/, "");
	return `${base}/posts/${slug.toLowerCase()}/`;
}

function printHelp(): void {
	console.log(`IndexNow 主动推送

用法:
  pnpm indexnow <文章id>...        提交指定文章
  pnpm indexnow --diff             提交相对 HEAD 变更的文章
  pnpm indexnow --all              提交所有已发布文章
  pnpm indexnow --url <url>...     提交任意 URL
  pnpm indexnow --dry-run          仅打印，不调用 API
  pnpm indexnow -h | --help        显示此帮助

文章 id 为 src/content/posts 下的相对路径（去掉 .md/.mdx 扩展名），
例如 src/content/posts/2024/foo.md 的 id 为 2024/foo。`);
}

interface ParsedArgs {
	help: boolean;
	dryRun: boolean;
	mode: "diff" | "all" | "ids" | "urls" | "none";
	ids: string[];
	urls: string[];
}

function parseArgs(argv: string[]): ParsedArgs {
	const result: ParsedArgs = {
		help: false,
		dryRun: false,
		mode: "none",
		ids: [],
		urls: [],
	};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		switch (arg) {
			case "-h":
			case "--help": {
				result.help = true;
				break;
			}
			case "--dry-run": {
				result.dryRun = true;
				break;
			}
			case "--diff": {
				result.mode = "diff";
				break;
			}
			case "--all": {
				result.mode = "all";
				break;
			}
			case "--url": {
				const value = argv[++i];
				if (value) result.urls.push(value);
				result.mode = result.mode === "none" ? "urls" : result.mode;
				break;
			}
			default: {
				if (arg.startsWith("-")) {
					console.warn(`未知选项: ${arg}（忽略）`);
				} else {
					result.ids.push(arg);
					result.mode = result.mode === "none" ? "ids" : result.mode;
				}
			}
		}
	}
	return result;
}

async function collectUrls(
	args: ParsedArgs,
	siteUrl: string,
	cwd = process.cwd(),
): Promise<string[]> {
	const urlSet = new Set<string>();

	for (const url of args.urls) urlSet.add(url);

	switch (args.mode) {
		case "all": {
			const posts = await loadPostFiles(cwd);
			for (const post of posts) {
				if (post.draft || post.password) continue;
				urlSet.add(buildPostUrl(siteUrl, post.slug));
			}
			break;
		}
		case "diff": {
			const slugs = getChangedPostSlugs(cwd);
			for (const slug of slugs) {
				urlSet.add(buildPostUrl(siteUrl, slug));
			}
			break;
		}
		case "ids": {
			const posts = await loadPostFiles(cwd);
			const knownSlugs = new Set(
				posts
					.filter((post) => !post.draft && !post.password)
					.map((post) => post.slug),
			);
			for (const id of args.ids) {
				if (!knownSlugs.has(id)) {
					console.warn(`警告: 未找到文章 "${id}"，已跳过`);
					continue;
				}
				urlSet.add(buildPostUrl(siteUrl, id));
			}
			break;
		}
		case "urls":
		case "none": {
			break;
		}
	}

	return [...urlSet];
}

async function submit(
	urls: string[],
	key: string,
	siteUrl: string,
): Promise<void> {
	const base = siteUrl.replace(/\/+$/, "");
	const host = new URL(siteUrl).host;
	const keyLocation = `${base}/${key}.txt`;
	const body = JSON.stringify({ host, key, keyLocation, urlList: urls });

	const response = await fetch(INDEXNOW_API, {
		method: "POST",
		headers: { "Content-Type": "application/json; charset=utf-8" },
		body,
	});

	const status = response.status;
	if (status === 200) {
		console.log(`✓ ${status} 已接受，URL 将被搜索引擎抓取`);
	} else if (status === 202) {
		console.log(`✓ ${status} 已接受，URL 将在稍后抓取`);
	} else if (status === 400) {
		console.error(`✗ ${status} 请求格式错误（密钥或 host 不匹配）`);
	} else if (status === 422) {
		console.error(`✗ ${status} 请求体不合法`);
	} else if (status === 429) {
		console.error(`✗ ${status} 请求过于频繁，请稍后再试`);
	} else {
		console.error(`✗ ${status} ${response.statusText}`);
	}
	if (status >= 400) {
		const text = await response.text().catch(() => "");
		if (text) console.error(`  响应: ${text}`);
	}
}

async function main(): Promise<void> {
	const args = parseArgs(process.argv.slice(2));
	if (args.help || args.mode === "none") {
		printHelp();
		return;
	}

	loadEnvironment();
	const siteUrl = siteConfig.site_url;
	if (!siteUrl) {
		throw new Error("siteConfig.site_url 未配置");
	}
	const key = process.env.INDEXNOW_KEY;
	if (!key) {
		throw new Error("缺少 INDEXNOW_KEY，请在 .env 配置");
	}

	const urls = await collectUrls(args, siteUrl);
	if (urls.length === 0) {
		console.log("没有可提交的 URL");
		return;
	}

	console.log(`将提交 ${urls.length} 个 URL:`);
	for (const url of urls) console.log(`  ${url}`);

	if (args.dryRun) {
		console.log("\ndry-run 完成，未调用 API");
		return;
	}

	console.log("\n正在提交到 IndexNow...");
	for (let i = 0; i < urls.length; i += MAX_URLS_PER_REQUEST) {
		const batch = urls.slice(i, i + MAX_URLS_PER_REQUEST);
		await submit(batch, key, siteUrl);
	}
}

main().catch((error: unknown) => {
	console.error("IndexNow 提交失败:", error);
	process.exitCode = 1;
});
