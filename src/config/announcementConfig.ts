import type { AnnouncementConfig } from "../types/config";

export const announcementConfig: AnnouncementConfig = {
	// 公告标题
	title: "公告",

	// 公告列表（sort 越大越靠前）
	items: [
		{
			tag: "重构",
			title: "大版本更新",
			content:
				"一口气全面统一博客样式，移除部分冗余导航页面，更专注内容展示。",
			time: "2026-08-29",
			sort: 4,
		},
		{
			tag: "优化",
			title: "稳定性修复一批",
			content:
				"统一Swup生命周期（BUG更少了、牺牲了首屏部分性能）、升级astro 7（构建速度翻倍）、文章封面图片加载（更流畅）、更换音乐播放器 API（更稳定）等多个问题，站点更稳了。",
			time: "2026-08-29",
			sort: 3,
		},
		{
			tag: "友链",
			title: "互换友链",
			content:
				"欢迎各位大佬互换友链，要求内容原创、稳定更新。申请前请先看友链页的说明，期待和你交换链接。",
			time: "2026-08-29",
			link: "/friends/",
			sort: 2,
		},
		{
			tag: "欢迎",
			title: "关于我的介绍",
			content:
				"欢迎来到我的博客，我是深耕java、python和agent技术开发。热爱技术、持续学习，欢迎同好交流探讨。",
			time: "2025-05-07",
			link: "/about/",
			sort: 1,
		},
	],

	// 是否允许用户关闭公告
	closable: true,
};
