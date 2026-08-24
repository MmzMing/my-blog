/**
 * `/llms.txt` 的内容配置。
 *
 * `/llms.txt` 是面向 AI、搜索系统和其他机器读取方的站点入口。页面生成
 * 逻辑位于 `src/pages/llms.txt.ts`，只负责读取公开文章、拼接 Markdown 和
 * 生成绝对 URL；本文件集中维护其中需要人工编写的标题、说明和入口列表，
 * 这样修改站点定位或新增机器入口时不需要改动页面生成代码。
 *
 * `machineEntrypoints.items[].path` 使用站点根路径下的相对路径，生成页面时
 * 会根据当前站点 URL 转换为绝对 URL。文章列表不在这里重复维护，而是由
 * 公开文章集合动态生成，避免配置中的文章链接过期。
 */
import type { LlmsConfig } from "@/types/config";

/**
 * 机器入口文档的静态文案和链接配置。
 *
 * 配置字段与 `/llms.txt` 的章节一一对应：作者信息用于说明内容来源，机器
 * 入口用于指向结构化知识库，精选文章由程序追加，使用说明用于提示引用和
 * 内容时效性。
 */
export const llmsConfig: LlmsConfig = {
	/** 站点作者和内容领域，帮助 AI 判断知识来源与专业范围。 */
	author: {
		heading: "作者",
		description: "Mmzming，专注分享JAVA、python、AI Agent和博客相关内容。",
	},
	/**
	 * 提供给机器读取的稳定入口。
	 * `path` 应指向公开、无需登录即可访问的资源；如果修改路由，需要同步
	 * 更新这里，确保 `/llms.txt` 不会向 AI 暴露失效链接。
	 */
	machineEntrypoints: {
		heading: "机器入口",
		items: [
			// Wiki 索引：列出所有公开文章及其 Markdown / JSON 资源。
			{ label: "LLM Wiki", path: "/wiki/index.json" },
			// RSS：提供按发布时间组织的增量内容入口。
			{ label: "RSS", path: "/rss.xml" },
			// Sitemap：帮助搜索引擎或抓取程序发现站点页面。
			{ label: "Sitemap", path: "/sitemap-index.xml" },
		],
	},
	/**
	 * 精选文章章节：从公开文章集合按排序动态生成 Markdown 链接列表，
	 * 链接数量由 `limit` 控制，避免文件过长。
	 */
	featuredPosts: {
		heading: "精选文章",
		limit: 10,
	},
	/**
	 * 面向 AI 和引用者的使用边界说明，例如内容归属、时效性和引用方式。
	 */
	usage: {
		heading: "使用说明",
		description:
			"文章内容为作者个人实践记录，技术版本和第三方服务行为可能变化；引用时请保留原文链接与作者信息。",
	},
};
