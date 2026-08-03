import type { CollectionsApiConfig } from "../types/config";

// 使用 favicon 服务获取网站图标
const favicon = (domain: string) => `https://favicon.im/${domain}`;

export const collectionsApiConfig: CollectionsApiConfig = {
	// 页面标题，留空则使用 i18n 翻译
	title: "",
	// 页面描述，留空则使用 i18n 翻译
	description: "",

	// API 收藏列表（按 category 分组）
	apis: [
		{
			category: "工具箱",
			items: [
				{
					name: "网络工具 | 中科大测速",
					url: "https://test.ustc.edu.cn/",
					description:
						"中科大提供的网络测速工具，用于快速测试本地带宽与网络延迟。",
					icon: favicon("test.ustc.edu.cn"),
					enabled: true,
				},
				{
					name: "网络工具 | ITDOG",
					url: "https://www.itdog.cn/",
					description:
						"在线网络工具箱，支持 Ping、TCPing、网站测速、HTTP 测速、路由追踪与 DNS 查询。",
					icon: favicon("itdog.cn"),
					enabled: true,
				},
				{
					name: "图片处理 | 在线图像工具箱",
					url: "https://phototool.cn/",
					description:
						"在线图片处理工具箱，支持格式转换、压缩、裁剪与批量下载。",
					icon: favicon("phototool.cn"),
					enabled: true,
				},
				{
					name: "图片查找 | SauceNAO",
					url: "https://saucenao.com/",
					description: "以图搜图引擎，支持查找动漫插画、同人图等图片来源。",
					icon: favicon("saucenao.com"),
					enabled: true,
				},
				{
					name: "图床 | StarDots",
					url: "https://dashboard.stardots.io/?lang=zh",
					description:
						"一站式图片托管与 CDN 加速平台，支持图片管理、转换与分发。",
					icon: favicon("stardots.io"),
					enabled: true,
				},
				{
					name: "抠图 | 抠抠图",
					url: "https://www.koukoutu.com/removebgtool/all",
					description:
						"免费 AI 在线抠图工具，支持一键自动去背景、批量处理与透明 PNG 生成。",
					icon: favicon("koukoutu.com"),
					enabled: true,
				},
				{
					name: "GIF 背景移除 | AdWorker",
					url: "https://adworker.ai/zh/tools/gif-background-remover/",
					description:
						"在线 GIF 动图背景去除工具，支持自动识别并移除 GIF 背景。",
					icon: favicon("adworker.ai"),
					enabled: true,
				},
				{
					name: "PatorJK",
					url: "https://patorjk.com/",
					description: "在线 ASCII 艺术字生成器，还提供多种实用小工具集合。",
					icon: favicon("patorjk.com"),
					enabled: true,
				},
				{
					name: "设备展示 | Fireship",
					url: "https://fireship.dev/",
					description:
						"用于生成设备展示效果的在线工具，方便快速制作产品截图与演示。",
					icon: favicon("fireship.dev"),
					enabled: true,
				},
			],
		},
		{
			category: "AI 助手",
			items: [
				{
					name: "豆包",
					url: "https://www.doubao.com/",
					description:
						"字节跳动推出的 AI 助手，支持对话、写作、翻译与编程辅助。",
					icon: favicon("doubao.com"),
					enabled: true,
				},
				{
					name: "ChatGPT",
					url: "https://chatgpt.com/",
					description:
						"OpenAI 开发的对话式 AI，适用于写作、编程、分析与日常问答。",
					icon: favicon("chatgpt.com"),
					enabled: true,
				},
				{
					name: "Claude",
					url: "https://claude.ai/",
					description:
						"Anthropic 开发的 AI 助手，擅长长文本理解、代码分析与深度推理。",
					icon: favicon("claude.ai"),
					enabled: true,
				},
				{
					name: "Gemini",
					url: "https://gemini.google.com/",
					description: "Google 推出的多模态 AI，支持文本、图片理解与代码生成。",
					icon: favicon("gemini.google.com"),
					enabled: true,
				},
				{
					name: "Grok",
					url: "https://grok.com/",
					description: "xAI 开发的 AI 助手，支持实时搜索、图像生成与深度推理。",
					icon: favicon("grok.com"),
					enabled: true,
				},
			],
		},
		{
			category: "AI 工具",
			items: [
				{
					name: "能力排行榜 | Artificial Analysis",
					url: "https://artificialanalysis.ai/?intelligence-category=reasoning-vs-non-reasoning",
					description:
						"AI 模型推理能力对比分析平台，帮助理解不同模型的性能差异。",
					icon: favicon("artificialanalysis.ai"),
					enabled: true,
				},
				{
					name: "能力排行榜 | AI Arena",
					url: "https://arena.ai/leaderboard",
					description: "AI 模型竞技排行榜，综合对比各大语言模型的能力表现。",
					icon: favicon("arena.ai"),
					enabled: true,
				},
				{
					name: "ModelScope 魔搭社区",
					url: "https://www.modelscope.cn/",
					description: "阿里达摩院开源模型社区，提供丰富的 AI 模型与推理服务。",
					icon: favicon("modelscope.cn"),
					enabled: true,
				},
				{
					name: "skill市场 | Skills Marketplace",
					url: "https://skillsmp.com/",
					description: "AI 技能市场，发现和分享各类 AI 工具与自动化工作流。",
					icon: favicon("skillsmp.com"),
					enabled: true,
				},
				{
					name: "提示词优化 | PromptPilot",
					url: "https://promptpilot.volcengine.com/",
					description:
						"火山引擎推出的 Prompt 优化工具，帮助提升大模型输出质量。",
					icon: favicon("volcengine.com"),
					enabled: true,
				},
				{
					name: "资源站 | ACGN AI 资源站",
					url: "https://res.acgnai.top/",
					description:
						"ACGN 方向的 AI 资源聚合平台，提供模型下载、工具推荐与教程。",
					icon: favicon("acgnai.top"),
					enabled: true,
				},
				{
					name: "图像生成 | Oblivion Image Gallery",
					url: "https://image.oblivionis.net/gallery",
					description:
						"免费的GPT AI 生成图像画廊，展示高质量的人工智能艺术作品。",
					icon: favicon("oblivionis.net"),
					enabled: true,
				},
				{
					name: "设计工具 | Figma",
					url: "https://www.figma.com/",
					description: "在线 UI/UX 设计协作工具，支持团队协作与 AI 辅助设计。",
					icon: favicon("figma.com"),
					enabled: true,
				},
				{
					name: "设计工具 | Google AI Studio",
					url: "https://aistudio.google.com/",
					description:
						"Google 官方 AI 开发平台，支持 Chat/Build/Stream 三模式，可快速原型化 Gemini 应用。",
					icon: favicon("aistudio.google.com"),
					enabled: true,
				},
				{
					name: "设计工具 | Google Stitch",
					url: "https://stitch.withgoogle.com/",
					description:
						"Google Labs 推出的 AI 原生 UI 设计工具，用文字或图片生成界面并导出代码。",
					icon: favicon("withgoogle.com"),
					enabled: true,
				},
				{
					name: "模型部署 | Ollama",
					url: "https://ollama.com/",
					description:
						"本地运行大语言模型的轻量框架，支持一键部署 Llama、Qwen 等开源模型。",
					icon: favicon("ollama.com"),
					enabled: true,
				},
			],
		},
		{
			category: "AI BOT",
			items: [
				{
					name: "NapCat",
					url: "https://napneko.github.io/",
					description: "基于 NTQQ 的 QQ 机器人框架，支持插件扩展与多协议接入。",
					icon: favicon("napneko.github.io"),
					enabled: true,
				},
				{
					name: "AstrBot",
					url: "https://astrbot.app/",
					description:
						"多平台聊天机器人框架，支持 QQ、Discord、Telegram 等主流平台。",
					icon: favicon("astrbot.app"),
					enabled: true,
				},
				{
					name: "Mai-bot",
					url: "https://docs.mai-mai.org/",
					description: "音乐游戏 MaiMai 相关机器人，支持查分、排位等功能。",
					icon: favicon("mai-mai.org"),
					enabled: true,
				},
				{
					name: "NoneBot",
					url: "https://nonebot.dev/docs/",
					description:
						"Python 异步机器人框架，支持多平台适配器与丰富的插件生态。",
					icon: favicon("nonebot.dev"),
					enabled: true,
				},
				{
					name: "LLBot",
					url: "https://github.com/LLOneBot/LuckyLilliaBot",
					description: "基于 NTQQ 的轻量 QQ 机器人框架，支持 OneBot 协议。",
					icon: favicon("github.com"),
					enabled: true,
				},
			],
		},
		{
			category: "前端组件库",
			items: [
				{
					name: "One Page Love",
					url: "https://onepagelove.com/",
					description: "单页设计参考，汇集 Landing Page 模板与创意参考。",
					icon: favicon("onepagelove.com"),
					enabled: true,
				},
				{
					name: "Mobbin",
					url: "https://mobbin.com/",
					description: "移动端设计参考，收录大量 App 界面截图与交互模式。",
					icon: favicon("mobbin.com"),
					enabled: true,
				},
				{
					name: "Awwwards",
					url: "https://www.awwwards.com/",
					description: "全球优秀网页设计作品评选平台，汇集创意灵感与设计趋势。",
					icon: favicon("awwwards.com"),
					enabled: true,
				},
				{
					name: "shadcn/ui",
					url: "https://ui.shadcn.com/",
					description: "现代 UI 组件库",
					icon: favicon("shadcn.com"),
					enabled: true,
				},
				{
					name: "HeroUI",
					url: "https://heroui.com/",
					description: "现代 UI 组件库",
					icon: favicon("heroui.com"),
					enabled: true,
				},
				{
					name: "Uiverse",
					url: "https://uiverse.io/",
					description:
						"社区驱动的开源 UI 元素库，提供按钮、输入框、卡片等精美组件。",
					icon: favicon("uiverse.io"),
					enabled: true,
				},
				{
					name: "CodePen",
					url: "https://codepen.io/",
					description:
						"优秀参考代码库，可实时编写和分享 HTML/CSS/JS 代码片段。",
					icon: favicon("codepen.io"),
					enabled: true,
				},
				{
					name: "React Bits",
					url: "https://www.reactbits.dev/",
					description: "动画组件库，实用且易于集成到项目中。",
					icon: favicon("reactbits.dev"),
					enabled: true,
				},
				{
					name: "Magic UI",
					url: "https://magicui.design/",
					description: "动画组件库，提供可直接复制使用的 UI 动效组件。",
					icon: favicon("magicui.design"),
					enabled: true,
				},
				{
					name: "Aceternity UI",
					url: "https://ui.aceternity.com/",
					description: "动画组件库，提供视觉效果出色的开源组件。",
					icon: favicon("aceternity.com"),
					enabled: true,
				},
				{
					name: "Canvas UI",
					url: "https://canvasui.dev/",
					description: "3D交互库，提供可直接参考和使用的 UI 组件。",
					icon: favicon("canvasui.dev"),
					enabled: true,
				},
				{
					name: "Iconify",
					url: "https://iconify.design/",
					description: "图标库，汇集超过 20 万个图标，支持按需加载。",
					icon: favicon("iconify.design"),
					enabled: true,
				},
				{
					name: "Sketchfab",
					url: "https://sketchfab.com/",
					description: "3D模型库，支持在线预览和免费下载。",
					icon: favicon("sketchfab.com"),
					enabled: true,
				},
			],
		},
		{
			category: "学习知识库",
			items: [
				{
					name: "Java 全栈知识体系",
					url: "https://pdai.tech/",
					description:
						"涵盖 Java 核心、并发、JVM、框架、数据库与架构的全栈知识体系。",
					icon: favicon("pdai.tech"),
					enabled: true,
				},
				{
					name: "JavaGuide",
					url: "https://javaguide.cn/",
					description:
						"Java 学习与面试指南，覆盖 Java 基础、集合、并发、JVM 与 Spring 等核心知识。",
					icon: favicon("javaguide.cn"),
					enabled: true,
				},
				{
					name: "异常教程",
					url: "https://www.exception.site/",
					description: "提供 JetBrains 系列 IDE 的安装教程与激活资源分享。",
					icon: favicon("exception.site"),
					enabled: true,
				},
				{
					name: "力扣 LeetCode",
					url: "https://leetcode.cn/",
					description:
						"技术成长与算法练习平台，提供海量题库、面试题与编程竞赛。",
					icon: favicon("leetcode.cn"),
					enabled: true,
				},
				{
					name: "牛客网",
					url: "https://www.nowcoder.com/",
					description:
						"IT 求职备考与技术学习平台，提供笔试、面试题库与在线编程练习。",
					icon: favicon("nowcoder.com"),
					enabled: true,
				},
			],
		},
		{
			category: "动漫&漫画",
			items: [
				{
					name: "AGE 动漫",
					url: "https://www.agedm.io/update",
					description: "免费动漫资源聚合站，提供高清动漫在线观看与更新推送。",
					icon: favicon("agedm.io"),
					enabled: true,
				},
				{
					name: "ManhwaTop",
					url: "https://manhwatop.com/",
					description: "韩漫与漫画阅读平台，收录热门连载与完结漫画资源。",
					icon: favicon("manhwatop.com"),
					enabled: true,
				},
			],
		},
		{
			category: "API 接口",
			items: [
				{
					name: "小小API",
					url: "https://xxapi.cn/",
					description: "免费 API 数据接口调用平台，提供多种聚合数据接口服务。",
					icon: favicon("xxapi.cn"),
					enabled: true,
				},
				{
					name: "高德地图API",
					url: "https://lbs.amap.com/",
					description: "高德地图开放平台，提供地图、定位、导航等地理信息服务。",
					icon: favicon("amap.com"),
					enabled: true,
				},
				{
					name: "聚合数据",
					url: "https://www.juhe.cn/",
					description:
						"国内数据服务平台，提供短信、物流、新闻等多种 API 接口。",
					icon: favicon("juhe.cn"),
					enabled: true,
				},
				{
					name: "有道翻译API",
					url: "https://ai.youdao.com/",
					description: "网易有道提供的翻译 API 服务，支持多语言文本互译。",
					icon: favicon("youdao.com"),
					enabled: true,
				},
				{
					name: "Tavily",
					url: "https://app.tavily.com/home",
					description: "AI 优化的搜索引擎 API，为大模型提供实时网页检索能力。",
					icon: favicon("tavily.com"),
					enabled: true,
				},
			],
		},
	],
};
