import type { SiteConfig } from "@/types/config";
import { fontConfig } from "./fontConfig";

// 定义站点语言
// 语言代码，例如：'zh_CN', 'zh_TW', 'en', 'ja', 'ru'。
const SITE_LANG = "zh_CN";

export const siteConfig: SiteConfig = {
	// 站点标题
	title: "MmzMing的博客",

	// 站点副标题
	subtitle: "MmzMing",

	// 站点 URL
	site_url: "https://tblog.mmzhiku.xyz",

	// 站点描述
	description:
		"一个记录学习、工作实践、开发经验与生活随笔的个人博客，持续整理值得分享的知识、项目和思考。",

	// 站点关键词
	keywords: [
		"MmzMing",
		"JAVA",
		"AI",
		"Astro",
		"ACGN",
		"博客",
		"技术博客",
		"静态博客",
	],

	// 主题色
	themeColor: {
		// 主题色的默认色相，范围从 0 到 360。例如：红色：0，青色：200，蓝绿色：250，粉色：345
		hue: 165,
		// 是否对访问者隐藏主题色选择器
		fixed: false,
		// 默认模式："light" 亮色，"dark" 暗色
		defaultMode: "dark",
	},

	// 页面整体宽度（单位：rem）
	// 数值越大可以让页面内容区域更宽
	// 在使用单侧栏边栏时，建议调低一些宽度以获得更好的视觉效果。
	pageWidth: 100,

	// Favicon 配置
	favicon: [
		{
			src: "/favicon/favicon.ico",
			sizes: "32x32",
		},
		{
			src: "/favicon/favicon-16x16.png",
			sizes: "16x16",
		},
		{
			src: "/favicon/favicon-32x32.png",
			sizes: "32x32",
		},
		{
			src: "/favicon/favicon-48x48.png",
			sizes: "48x48",
		},
		{
			src: "/favicon/favicon.svg",
			sizes: "any",
		},
		{
			src: "/favicon/apple-touch-icon.png",
			sizes: "180x180",
		},
		{
			src: "/favicon/apple-touch-icon-152x152.png",
			sizes: "152x152",
		},
		{
			src: "/favicon/apple-touch-icon-167x167.png",
			sizes: "167x167",
		},
		{
			src: "/favicon/apple-touch-icon-180x180.png",
			sizes: "180x180",
		},
		{
			src: "/favicon/android-chrome-192x192.png",
			sizes: "192x192",
		},
		{
			src: "/favicon/android-chrome-512x512.png",
			sizes: "512x512",
		},
		{
			src: "/favicon/safari-pinned-tab.svg",
			sizes: "any",
		},
	],

	// 导航栏配置
	navbar: {
		// 导航栏Logo
		// 支持三种类型：
		// 1. Astro图标库: { type: "icon", value: "material-symbols:home-pin-outline" }
		// 2. 本地图片（public目录，不优化）: { type: "image", value: "/assets/images/logo.webp", alt: "Logo" }
		// 3. 本地图片（src目录，自动优化但会增加构建时间，推荐）: { type: "image", value: "assets/images/logo.webp", alt: "Logo" }
		// 4. 网络图片: { type: "url", value: "https://example.com/logo.png", alt: "Logo" }
		logo: {
			type: "image",
			value: "assets/images/logo.png",
			alt: "logo",
		},
		// 导航栏标题
		title: "MmzMing的博客",
		// 全宽导航栏，导航栏是否占满屏幕宽度
		widthFull: false,
	},

	// 站点开始日期，用于统计运行天数
	siteStartDate: "2026-05-07",

	// 站点时区（IANA 时区字符串），用于格式化bangumi、rss里的构建日期时间等等..
	// 示例："Asia/Shanghai", "UTC", 如果为空，则按照构建服务器的时区进行时区转换
	timezone: "Asia/Shanghai",

	// 提醒框（Admonitions）配置，修改后需要重启开发服务器才能生效
	// 主题：'github' | 'obsidian' | 'vitepress'，每个主题风格和语法不同，可根据喜好选择
	rehypeCallouts: {
		theme: "github",
	},

	// 文章页底部的"上次编辑时间"卡片开关
	showLastModified: true,

	// 文章过期阈值（天数），超过此天数才显示"上次编辑"卡片
	outdatedThreshold: 30,

	// 是否显示文章顶部的分享按钮行（QQ / 邮件 / 飞书 / X / WhatsApp / 复制链接）
	postShare: true,

	// OpenGraph图片功能,注意开启后要渲染很长时间，不建议本地调试的时候开启
	generateOgImages: false,

	// 站点默认 OG 图：供 JSON-LD 结构化数据（SiteStructuredData）与无封面文章的结构化图片兜底使用。
	// 与 coverImageConfig.randomCoverImage.fallback（随机封面图 API 失败的回退）互不相干，两者指向同一张图并非重复配置
	defaultOgImage: "/assets/images/aut.webp",

	// 页面加载动画配置
	pageLoader: {
		// 是否启用（进入首页时的全屏加载动效）
		enabled: false,
		// 加载动画图路径（public 目录）
		image: "/assets/images/loading/feibi-loading.webp",
		// 图片宽高（避免布局偏移）
		width: 960,
		height: 540,
	},

	// 页面开关配置 - 控制特定页面的访问权限，设为false会返回404
	pages: {
		// 友链页面开关
		friends: true,
		// 打赏页面开关
		sponsor: true,
		// 留言板页面开关，需要配置评论系统
		guestbook: true,
		// 相册页面开关
		gallery: false,
		// 收藏API页面开关
		collections: true,
		// 音乐可视化页面开关
		music: true,
		// 文档页面开关（/list/ 文章列表，导航栏「文章」下拉里显示为「文档」）
		postList: true,
		// 归档页面开关
		archive: true,
		// 关于页面开关
		about: true,
		// 图谱页面开关（/categories/，导航栏显示为「图谱」）
		categories: true,
	},

	// 分页配置
	pagination: {
		// 每页显示的文章数量
		postsPerPage: 6,
	},

	// 统计分析
	analytics: {
		// Google Analytics ID
		googleAnalyticsId: "",
		// Microsoft Clarity ID
		microsoftClarityId: "",
		// Umami 统计配置
		umamiAnalytics: {
			websiteId: "d47eea8b-7ad5-472b-a838-c873ba859c4f",
			shareId: "HZrqqAfVdx1UEVNm",
			scriptUrl: "https://stats.mmzhiku.xyz/script.js",
			// 使用 Umami 的 PV 展示文章详情、列表与网格浏览量；启用时优先于评论系统统计
			pageviews: {
				enabled: true,
			},
			// 是否追踪出站链接
			trackOutboundLinks: true,
			// 是否收集浏览器性能指标
			collectWebVitals: true,
			// 会话回放配置
			relpays: {
				// 是否启用会话回放
				enabled: false,
				// 录制会话采样率，范围 0-1，例如 0.15 表示记录 15% 的会话
				sampleRate: 0.15,
				// 隐私遮罩级别："moderate" 会遮罩所有输入框；"strict" 额外遮罩页面全部文本
				maskLevel: "moderate",
				// 单次录制最大时长（毫秒）
				maxDuration: 300000,
				// 需要排除录制的元素 CSS 选择器，例如 ".sensitive-widget"
				blockSelector: "",
			},
		},
		// 51la 统计配置
		la51Analytics: {
			// 51la 统计 ID
			Id: "",
			// 自定义 SDK JS 地址，防止 DNS 污染，留空使用默认地址
			sdkUrl: "",
			// 多个统计 ID 的数据分离标识，留空则使用 Id
			ck: "",
			// 是否开启事件分析功能
			autoTrack: false,
			//  Hash路由模式, 项目使用History API路由, 所以不必开启默认false
			hashMode: false,
			// 是否开启网站录屏功能
			screenRecord: true,
		},
	},

	// 归档统计配置
	archiveStats: {
		// 年度文章目标，用于计算归档页的完成率
		annualPostGoal: 50,
	},

	// 图像优化及响应式配置
	// 图像优化压缩只保留avif或webp
	// 响应式图像是为在不同设备上提高性能而调整的图像。这些图像可以调整大小以适应其容器，并且可以根据访问者的屏幕尺寸和分辨率以不同的大小提供。
	// Astro 仅能对 src 目录下的图像进行优化，src 目录下的图像越多，构建时间会越长
	// Astro 图像文档 https://docs.astro.build/zh-cn/guides/images/
	imageOptimization: {
		// 输出图片格式
		// - "avif": 仅输出 AVIF 格式（最新技术，最小体积，目前兼容性较低）
		// - "webp": 仅输出 WebP 格式（体积适中，兼容性好）
		// - "both": 同时输出 AVIF 和 WebP（推荐，浏览器自动选择最佳格式）
		formats: "webp",
		// 图片压缩质量 (1-100)，值越低体积越小但质量越差，推荐 70-85
		quality: 85,
		// 为特定域名的图片添加 referrerpolicy="no-referrer" 属性
		// 支持通配符 *，例如：["i0.hdslb.com", "*.bilibili.com"]
		// 可解决指定域名图片加载时的 403 问题（如防盗链图片）
		noReferrerDomains: ["*.alcy.cc"],
	},

	// 字体配置
	// 在src/config/fontConfig.ts中配置具体字体
	font: fontConfig,

	// 站点语言，在本配置文件顶部SITE_LANG定义
	lang: SITE_LANG,
};
