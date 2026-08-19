/**
 * 更新日志解析器
 * 数据源：src/content/spec/log.md（spec collection，id = "log"）
 *
 * log.md 格式约定：每条日志一个 `## ` 二级标题区块
 *   ## 更新标题
 *   - 日期：YYYY-MM-DD
 *   - 类型：feat | fix | style | refactor | chore
 *   - 页面：home / archive / list（页面标识，多个用 / 分隔）
 *   - 简述：卡片上显示的一句话
 *   详情正文（弹窗中显示），空行分段。
 */

export type ChangelogType = "feat" | "fix" | "style" | "refactor" | "chore";

export interface ChangelogEntry {
	title: string;
	/** YYYY-MM-DD，缺失时为空字符串 */
	date: string;
	/** 卡片上显示的一句话简述 */
	summary: string;
	/** 弹窗中显示的完整说明（保留原始换行，空行分段） */
	detail: string;
	/** 涉及的页面标识（见 PAGE_META），未收录的标识会原样保留 */
	pages: string[];
	type: ChangelogType;
}

export interface PageMeta {
	label: string;
	url?: string;
}

export const PAGE_META: Record<string, PageMeta> = {
	home: { label: "首页", url: "/" },
	archive: { label: "归档页", url: "/archive/" },
	list: { label: "文章列表", url: "/list/" },
	categories: { label: "标签图谱", url: "/categories/" },
	friends: { label: "友链页", url: "/friends/" },
	gallery: { label: "相册页", url: "/gallery/" },
	guestbook: { label: "留言板", url: "/guestbook/" },
	post: { label: "文章详情页" },
	about: { label: "关于页", url: "/about/" },
	site: { label: "全站" },
};

const VALID_TYPES: readonly ChangelogType[] = [
	"feat",
	"fix",
	"style",
	"refactor",
	"chore",
];

/** 元信息行：`- 键：值`，键限定为 日期/类型/页面/简述，冒号全半角均可 */
const META_LINE_RE = /^-\s*(日期|类型|页面|简述)\s*[:：]\s*(.+?)\s*$/;
/** 页面标识分隔：逗号（全半角）、顿号、斜杠、竖线、空白 */
const PAGE_SPLIT_RE = /[,，、/|\s]+/;

function normalizeType(raw: string | undefined): ChangelogType {
	const value = (raw ?? "").trim().toLowerCase();
	return (VALID_TYPES as readonly string[]).includes(value)
		? (value as ChangelogType)
		: "feat";
}

function parsePages(raw: string | undefined): string[] {
	return (raw ?? "")
		.split(PAGE_SPLIT_RE)
		.map((page) => page.trim())
		.filter(Boolean);
}

/**
 * 解析 log.md 正文为结构化日志列表。
 * 容错策略：缺字段给默认值，非法类型回退 feat，空标题块直接跳过，
 * 保证单条格式错误不会拖垮整个列表。
 */
export function parseChangelogMarkdown(markdown: string): ChangelogEntry[] {
	const entries: ChangelogEntry[] = [];
	// 按 `## ` 切分；slice(1) 丢弃首个 `##` 之前的文件头说明
	const blocks = markdown.split(/^##[ \t]+/m).slice(1);

	for (const block of blocks) {
		const lines = block.split("\n");
		const title = (lines[0] ?? "").trim();
		if (!title) continue;

		const meta: Partial<Record<"日期" | "类型" | "页面" | "简述", string>> = {};
		const bodyLines: string[] = [];

		for (const rawLine of lines.slice(1)) {
			const metaMatch = rawLine.trim().match(META_LINE_RE);
			if (metaMatch) {
				meta[metaMatch[1] as "日期" | "类型" | "页面" | "简述"] = metaMatch[2];
				continue;
			}
			// 正文尚未开始时跳过空行（标题与元信息、元信息与正文之间的空行）
			if (rawLine.trim() === "" && bodyLines.length === 0) continue;
			bodyLines.push(rawLine);
		}

		entries.push({
			title,
			date: meta.日期 ?? "",
			summary: meta.简述 ?? "",
			detail: bodyLines.join("\n").trim(),
			pages: parsePages(meta.页面),
			type: normalizeType(meta.类型),
		});
	}

	return entries;
}

/** 单条关联：目标下标 + 共享页面 */
export interface ChangelogLink {
	target: number;
	sharedPages: string[];
}

/**
 * 构建关联邻接表：两条记录共享至少一个页面即互相关联。
 * 返回 Map<记录下标, 关联列表>，按下标引用（与数组顺序一致）。
 */
export function buildChangelogLinks(
	entries: ChangelogEntry[],
): Map<number, ChangelogLink[]> {
	const links = new Map<number, ChangelogLink[]>();
	for (let i = 0; i < entries.length; i++) {
		for (let j = i + 1; j < entries.length; j++) {
			const sharedPages = entries[i].pages.filter((page) =>
				entries[j].pages.includes(page),
			);
			if (sharedPages.length === 0) continue;
			if (!links.has(i)) links.set(i, []);
			if (!links.has(j)) links.set(j, []);
			links.get(i)?.push({ target: j, sharedPages });
			links.get(j)?.push({ target: i, sharedPages });
		}
	}
	return links;
}
