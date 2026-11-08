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
			description: "网络测速、图片处理、抠图等日常实用工具",
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
					name: "图片处理 | OneImage",
					url: "https://oneimage.co/",
					description:
						"隐私优先的免费在线图片工具，支持压缩、裁剪、模糊、格式转换等，浏览器内处理无需上传。",
					icon: favicon("oneimage.co"),
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
			],
		},
		{
			category: "前端组件库",
			description: "设计参考与开源 UI、动效组件库",
			items: [
				{
					name: "ReUI",
					url: "https://reui.io/",
					description:
						"构建在 shadcn/ui 之上的 React + Tailwind 组件库，提供 Data Grid、Kanban、Gantt 等高级原语。",
					icon: favicon("reui.io"),
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
					name: "Canvas UI",
					url: "https://canvasui.dev/",
					description: "3D交互库，提供可直接参考和使用的 UI 组件。",
					icon: favicon("canvasui.dev"),
					enabled: true,
				},
				{
					name: "ReactDrops",
					url: "https://reactdrops.dev/",
					description:
						"开源 React 动效组件库，提供动画与特效组件，可复制源码直接使用。",
					icon: favicon("reactdrops.dev"),
					enabled: true,
				},
				{
					name: "Watermelon UI",
					url: "https://ui.watermelon.sh/",
					description:
						"开源 React 组件平台，提供动画组件、可复制区块与仪表盘模板。",
					icon: favicon("watermelon.sh"),
					enabled: true,
				},
				{
					name: "beUI",
					url: "https://beui.dev/",
					description:
						"开源动画组件库，支持 React 与 React Native，源码可直接复制使用。",
					icon: favicon("beui.dev"),
					enabled: true,
				},
				{
					name: "affectUI",
					url: "https://www.affectui.com/components",
					description:
						"面向 AI 产品与 SaaS 场景的 React 组件库，提供 Agent 界面、聊天等组件。",
					icon: favicon("affectui.com"),
					enabled: true,
				},
				{
					name: "Arc",
					url: "https://uiarc.dev/",
					description:
						"基于 shadcn 生态的 React 动效组件库，提供组件与区块，支持 shadcn CLI 与 MCP 安装。",
					icon: favicon("uiarc.dev"),
					enabled: true,
				},
				{
					name: "EasyUI",
					url: "https://easyui.site/",
					description:
						"开源 React 动效组件库，基于 Tailwind CSS 与 Framer Motion，源码可直接复制使用。",
					icon: favicon("easyui.site"),
					enabled: true,
				},
				{
					name: "Viora UI",
					url: "https://www.vioraui.dedyn.io/",
					description:
						"React + Tailwind + Framer Motion 组件库，提供上百个可复制粘贴的组件。",
					icon: favicon("vioraui.dedyn.io"),
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
					name: "PickUI",
					url: "https://pickui.jarin.me/",
					description:
						"UI 组件库精选导航，收录 React、Vue、Svelte 等多框架优质组件库。",
					icon: favicon("pickui.jarin.me"),
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
					name: "Iconify",
					url: "https://iconify.design/",
					description: "图标库，汇集超过 20 万个图标，支持按需加载。",
					icon: favicon("iconify.design"),
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
					name: "Native Shell",
					url: "https://nsh.dev/",
					description:
						"Longbridge 开发的跨平台 UI 框架，TSX + Rust 引擎将一套代码编译到桌面、移动与 Web 原生控件。",
					icon: favicon("nsh.dev"),
					enabled: true,
				},
			],
		},
		{
			category: "AI聊天网站",
			description: "对话式 AI 助手，覆盖写作、编程与日常问答",
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
			category: "AI工具网站",
			description: "模型排行、图像生成、提示词优化与开发平台",
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
			category: "BOT开源框架网站",
			description: "支持 QQ、Discord 等多平台的聊天机器人框架",
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
			category: "二次元资源站",
			description: "动漫与漫画资源聚合观看平台",
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
			description: "免费与开放的数据 API 服务平台",
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
