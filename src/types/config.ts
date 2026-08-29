import type {
	DARK_MODE,
	LIGHT_MODE,
	SYSTEM_MODE,
} from "../constants/constants";

export type SiteConfig = {
	title: string;
	subtitle: string;
	site_url: string;
	description?: string; // 网站描述，用于生成 <meta name="description">
	keywords?: string[]; // 站点关键词，用于生成 <meta name="keywords">

	lang: "en" | "zh_CN" | "zh_TW" | "ja" | "ru";

	themeColor: {
		hue: number;
		fixed: boolean;
		defaultMode?: LIGHT_DARK_MODE; // 默认模式：浅色、深色或跟随系统
	};

	// 页面整体宽度（单位：rem）
	pageWidth?: number;

	// 字体配置
	font: FontConfig;

	// 站点开始日期，用于计算运行天数
	siteStartDate?: string; // 格式: "YYYY-MM-DD"

	// 可选：站点时区，使用 IANA 时区标识，例如 "Asia/Shanghai"、"UTC"
	timezone?: string;

	// 提醒框配置
	rehypeCallouts: {
		theme: "github" | "obsidian" | "vitepress";
	};

	// bangumi配置
	bangumi?: {
		userId?: string; // Bangumi用户ID
		categoryOrder?: ("anime" | "game" | "book" | "music" | "real")[]; // 条目类型排序顺序
	};

	generateOgImages: boolean;
	defaultOgImage: string;

	// 页面加载动画配置
	pageLoader: {
		enabled: boolean; // 是否启用首页全屏加载动效
		image: string; // 加载动画图路径（public 目录）
		width?: number; // 图片宽度（避免布局偏移）
		height?: number; // 图片高度（避免布局偏移）
	};

	favicon: Array<{
		src: string;
		theme?: "light" | "dark";
		sizes?: string;
	}>;

	navbar: {
		/** 导航栏Logo图标，可选类型：icon库、本地图片、网络图片链接 */
		logo?: {
			type: "icon" | "image" | "url";
			value: string; // icon名、本地图片路径或网络图片url
			alt?: string; // 图片alt文本
		};
		title?: string; // 导航栏标题，如果不设置则使用 title
		widthFull?: boolean; // 导航栏是否占满屏幕宽度
	};

	showLastModified: boolean; // 控制"上次编辑"卡片显示的开关
	outdatedThreshold?: number; // 文章过期阈值（天数），超过此天数才显示"上次编辑"卡片
	postShare?: boolean; // 是否显示文章顶部的分享按钮行

	// 页面开关配置
	pages: {
		friends: boolean; // 友链页面开关
		sponsor: boolean; // 赞助页面开关
		guestbook: boolean; // 留言板页面开关
		gallery: boolean; // 相册页面开关
		collections: boolean; // 收藏API页面开关
	};

	// 分类导航栏开关
	categoryBar?: boolean;

	// 分页配置
	pagination: {
		postsPerPage: number; // 每页显示的文章数量
	};

	// 统计分析
	analytics?: {
		googleAnalyticsId?: string; // Google Analytics ID
		microsoftClarityId?: string; // Microsoft Clarity ID
		umamiAnalytics?: {
			websiteId?: string; // Umami Website ID
			shareId?: string; // Umami 分享页 ID，用于客户端直接获取统计
			scriptUrl?: string; // Umami JS地址，支持使用自建
			pageviews?: {
				enabled?: boolean; // 是否使用 Umami 在文章详情和列表中展示页面浏览量
			};
			trackOutboundLinks?: boolean; // 是否追踪出站链接点击事件，默认 true
			collectWebVitals?: boolean; // 是否自动收集访客浏览器核心网页指标，默认 false
			relpays?: {
				enabled?: boolean; // 是否启用会话回放，默认 false
				sampleRate?: number; // 录制会话采样率，范围 0-1，默认 0.15
				maskLevel?: "moderate" | "strict"; // 隐私遮罩级别，默认 moderate
				maxDuration?: number; // 单次录制最大时长（毫秒），默认 300000
				blockSelector?: string; // 需要完全排除录制的元素 CSS 选择器
			};
		};
		la51Analytics?: {
			Id?: string; // 51la 统计 ID
			sdkUrl?: string; // 自定义 SDK 地址，防止 DNS 污染，默认为 "//sdk.51.la/js-sdk-pro.min.js"
			ck?: string; // 多个统计 ID 的数据分离标识，默认与 id 相同
			autoTrack?: boolean; // 开启事件分析功能，默认 true
			hashMode?: boolean; // 单页面应用统计（Vue/React 等），默认 false
			screenRecord?: boolean; // 开启网站录屏功能，默认 true
		};
	};

	// 归档统计配置
	archiveStats?: {
		annualPostGoal: number; // 年度文章目标
	};

	// 图片优化配置
	imageOptimization?: {
		/**
		 * 输出图片格式
		 * - "avif": 仅输出 AVIF 格式（最小体积，兼容性较低）
		 * - "webp": 仅输出 WebP 格式（体积适中，兼容性好）
		 * - "both": 同时输出 AVIF 和 WebP（推荐，浏览器自动选择最佳格式）
		 */
		formats?: "avif" | "webp" | "both";
		/**
		 * 图片压缩质量 (1-100)
		 * 值越低体积越小但质量越差，推荐 70-85
		 */
		quality?: number;
		/**
		 * 为特定域名的图片添加 referrerpolicy="no-referrer" 属性
		 * 开启后可解决指定域名图片加载时的 403 问题（如防盗链图片）
		 * 示例：["i0.hdslb.com", "*.bilibili.com"] 支持通配符 *
		 * 仅影响匹配域名的图片标签，不影响其他链接的 referrer 行为
		 */
		noReferrerDomains?: string[];
	};
};

export type LlmsConfig = {
	author: {
		heading: string;
		description: string;
	};
	machineEntrypoints: {
		heading: string;
		items: Array<{
			label: string;
			path: string;
		}>;
	};
	featuredPosts: {
		heading: string;
		limit: number;
	};
	usage: {
		heading: string;
		description: string;
	};
};

export type Favicon = {
	src: string;
	theme?: "light" | "dark";
	sizes?: string;
};

export enum LinkPreset {
	Home = 0,
	Archive = 1,
	About = 2,
	Friends = 3,
	Sponsor = 4,
	Guestbook = 5,
	Bangumi = 6,
	Gallery = 7,
	Collections = 8,
	Stats = 9,
	Categories = 10,
	Tags = 11,
	PostList = 12,
	Feibichi = 13,
	ContactMe = 14,
	QQGroup = 15,
	NavPosts = 16,
	NavMy = 17,
	Music = 18,
}

export type NavBarLink = {
	name: string;
	url: string;
	external?: boolean;
	icon?: string; // 菜单项图标
	action?: string; // 可选：点击时触发的自定义事件名（不跳转页面）
	activePathPrefixes?: string[]; // 额外激活路径前缀，用于聚合不直接对应菜单链接的页面
	children?: (NavBarLink | LinkPreset)[]; // 支持子菜单，可以是NavBarLink或LinkPreset
};

export type NavBarConfig = {
	links: (NavBarLink | LinkPreset)[];
};

export type HomeBlindsSceneItem = {
	/** 左侧竖排与顶栏左侧共用的英文标识 */
	eyebrow: string;
	title: string;
	/** 图片内的介绍文案，五幕各有一套版式与动效 */
	description: string;
	image: string;
	alt: string;
};

/**
 * 揭示层（blinds 第一层）的入场标题。
 * 节奏：整条长条横移 → 内缘往两侧退开露出「背面」的标题 →
 * 侧边竖线与中缝横线跟随滑动后固定 → 长条往两侧缩放消失、中央虚线圆转 90° →
 * 标题上移，第二层祝福语逐字翻入并循环。
 */
export type HomeBlindsHeadlineConfig = {
	/** 标题文案，单行显示（参考版式为 4 字） */
	title: string;
	/** 标题上移后循环播放的祝福语，每条单行显示（参考版式为 5 字） */
	messages: string[];
	/** 长条揭示到虚线圆就位的入场总时长（秒），默认 0.5 */
	enterDuration?: number;
	/** 单条祝福语的停留时长（秒），默认 2.6 */
	messageHold?: number;
	/** 祝福语换一条的总时长（秒，含逐字延迟的尾巴），默认 0.75 */
	messageFlipDuration?: number;
};

export type HomeBlindsConfig = {
	/** 是否启用桌面端首页双层影像交互 */
	enabled: boolean;
	reveal: {
		/** 固定背景图（首屏揭示层与首幕画面共用） */
		backgroundImage: string;
		/** 透明前景图 */
		foregroundImage: string;
		foregroundAlt: string;
		/** 前景图完全进入后的透明度，取值 0-1 */
		foregroundOpacity: number;
		/** 前景图跟随鼠标移动的最大像素距离 */
		pointerTravel: number;
		/** 长条横移揭示的入场标题与循环祝福语 */
		headline: HomeBlindsHeadlineConfig;
	};
	scenes: {
		/** 横向影像层固定滚动距离，越小则横移越快 */
		scrollDistance: number;
		/** 背景跑马灯图片，按顺序从左往右无缝循环；只放一张也能跑 */
		cycleImages: string[];
		/** 跑马灯走完一轮列表的时长（秒），越大越慢 */
		cycleDuration: number;
		/** 由上一层背景与透明前景图合成的首幕文案（序幕） */
		composite: Omit<HomeBlindsSceneItem, "image" | "alt"> & { alt: string };
		/** 后续画面，运行时最多读取前 4 张 */
		items: HomeBlindsSceneItem[];
		/** 立牌图 */
		standImages: string[];
	};
};

/** galgame 对话框：单句台词 */
export type HeroDialogueLine = {
	/** 说话者：host=站长 / visitor=访客(你)，默认 host。左上角名牌随之切换 */
	speaker?: "host" | "visitor";
	/** 台词文本（逐字打字机播放） */
	text: string;
};

/** galgame 对话框：话题（点击进入其逐句台词） */
export type HeroDialogueTopic = {
	/** 话题菜单标题，如「关于我」 */
	title: string;
	/** 该话题的逐句台词 */
	lines: HeroDialogueLine[];
};

/** 首页 Hero galgame 对话框配置（写死暗黑主题，config 驱动内容） */
export type HeroDialogueConfig = {
	/** 是否启用对话框；关闭则 Hero 不渲染对话框 */
	enabled?: boolean;
	/** 说话者名称 */
	speakers?: {
		host?: string; // 站长名，如「哈基墩」
		visitor?: string; // 访客名，如「访客」
	};
	/** 默认展示的简介台词，逐句播放；末句后可打开话题菜单 */
	intro: HeroDialogueLine[];
	/** 话题列表；点击某话题进入其逐句台词，末句后返回菜单 */
	topics: HeroDialogueTopic[];
	/** 话题菜单提示语，默认「想聊点什么？」 */
	menuTitle?: string;
	/** 打字机速度（毫秒/字），默认 45 */
	typingSpeed?: number;
	/** 自动播放时每句停留时间（毫秒），默认 1600 */
	autoDelay?: number;
};

export type HeroMosaicInitialTile = {
	/** 碎片中心点在马赛克画布中的横向比例（0–1）。 */
	x: number;
	/** 碎片中心点在马赛克画布中的纵向比例（0–1）。 */
	y: number;
	/** 碎片宽度占马赛克画布的比例（0–1）。 */
	width: number;
	/** 碎片高度占马赛克画布的比例（0–1）。 */
	height: number;
	/** 初始旋转角度。 */
	rotation?: number;
	/** 初始模糊半径。 */
	blur?: number;
};

export type HeroMosaicConfig = {
	rows: number;
	columns: number;
	idleVisible: number;
	idleInterval: number;
	seed: number;
	scrub: number;
	desktopScrollDistance: number;
	mobileScrollDistance: number;
	/** 对话框完成后保留的固定滚动距离。 */
	desktopDialogueTailDistance: number;
	mobileDialogueTailDistance: number;
	desktopMinViewports: number;
	mobileMinViewports: number;
	/** 仅用于首屏静止状态的碎片布局，后续轮换仍使用随机参数。 */
	initialLayout?: HeroMosaicInitialTile[];
	/** 第二层全部出现后继续固定 Hero 的时间线长度，用于交互驻留。 */
	interactionHold: number;
};

export type HeroContactConfig = {
	platform: string;
	handle: string;
	href?: string;
};

export type HeroStickerConfig = {
	image: string;
	alt: string;
	eye: {
		xPercent: number;
		yPercent: number;
		travelXPercent: number;
		travelYPercent: number;
	};
	rightEye: {
		xPercent: number;
		yPercent: number;
	};
	mouth: {
		xPercent: number;
		yPercent: number;
		widthPercent: number;
		heightPercent: number;
		rotation: number;
		travelScale: number;
	};
};

export type HomeConfig = {
	avatar?: string;
	name: string;
	displayName?: string; // 首页展示名字（如 MmMing）
	occupation?: string; // 职业/身份标签（如 后端开发 / 技术博主）
	bio?: string | string[];
	hero: {
		backgroundImage: string;
		mosaic: HeroMosaicConfig;
		contact?: HeroContactConfig;
		sticker: HeroStickerConfig;
		/** galgame 对话框（写死暗黑主题）。配置后替代底部简介气泡 */
		dialogue?: HeroDialogueConfig;
		/** 玻璃雨珠 + 撞击水花动效，移动端自动降低密度。 */
		rain?: {
			enabled?: boolean;
			/** 雨量强度，0–1，默认 0.6（克制） */
			intensity?: number;
			/** 雨珠颜色（十六进制如 "#ffffff" 或 "r,g,b"）。留空则随主题自动取色（暗→白/亮→深灰） */
			color?: string;
		};
	};
	dataLayer: {
		visitImage: string;
		archiveImage: string;
		contactImage: string;
	};
	/** 桌面端首页揭示层与横向明信片层 */
	homeBlinds: HomeBlindsConfig;
	links: {
		name: string;
		url: string;
		icon: string;
		showName?: boolean;
	}[];
};

export type LicenseConfig = {
	enable: boolean;
	name: string;
	url: string;
};
// 评论配置

export type CommentConfig = {
	/**
	 * 当前启用的评论系统类型
	 * "none" | "twikoo" | "waline" | "giscus" | "disqus" | 'artalk'
	 */
	type: "none" | "twikoo" | "waline" | "giscus" | "disqus" | "artalk";
	twikoo?: {
		envId: string;
		region?: string;
		lang?: string;
		visitorCount?: boolean;
	};
	waline?: {
		serverURL: string;
		lang?: string;
		emoji: string[];
		imageUploadURL?: string;
		login?: "enable" | "force" | "disable";
		visitorCount?: boolean; // 是否统计访问量，true 启用访问量，false 关闭
	};
	artalk?: {
		// 后端程序 API 地址
		server: string;
		/**
		 * 语言，支持语言如下：
		 * - "en" (English)
		 * - "zh-CN" (简体中文)
		 * - "zh-TW" (繁体中文)
		 * - "ja" (日本語)
		 * - "ko" (한국어)
		 * - "fr" (Français)
		 * - "ru" (Русский)
		 * */
		locale: string | "auto";
		// 是否统计访问量，true 启用访问量，false 关闭
		visitorCount?: boolean;
	};
	giscus?: {
		repo: string;
		repoId: string;
		category: string;
		categoryId: string;
		mapping: string;
		strict: string;
		reactionsEnabled: string;
		emitMetadata: string;
		inputPosition: string;
		lang: string;
		loading: string;
	};
	disqus?: {
		shortname: string;
	};
};

export type LIGHT_DARK_MODE =
	| typeof LIGHT_MODE
	| typeof DARK_MODE
	| typeof SYSTEM_MODE;

export type BlogPostData = {
	body: string;
	title: string;
	published: Date;
	description: string;
	tags: string[];
	draft?: boolean;
	image?: string;
	category?: string;
	pinned?: boolean;
	prevTitle?: string;
	prevSlug?: string;
	nextTitle?: string;
	nextSlug?: string;
};

export type ExpressiveCodeConfig = {
	/** @deprecated 使用 darkTheme 和 lightTheme 代替 */
	theme?: string;
	/** 暗色主题名称（用于暗色模式） */
	darkTheme: string;
	/** 亮色主题名称（用于亮色模式） */
	lightTheme: string;
	/** 代码块折叠插件配置 */
	pluginCollapsible?: PluginCollapsibleConfig;
	/** 语言徽章插件配置 */
	pluginLanguageBadge?: PluginLanguageBadgeConfig;
};

export type PluginLanguageBadgeConfig = {
	enable: boolean; // 是否启用语言徽章
};

export type PluginCollapsibleConfig = {
	enable: boolean; // 是否启用代码块折叠功能
	lineThreshold: number; // 触发折叠的行数阈值
	previewLines: number; // 折叠时显示的预览行数
	defaultCollapsed: boolean; // 默认是否折叠
};

/**
 * PlantUML 图表渲染配置
 *
 * 控制 markdown 文章中 ` ```plantuml ` 代码块到 PlantUML 服务器 SVG 图片的
 * 构建时编码与客户端渲染行为。
 */
export type PlantUMLConfig = {
	/** 是否启用 PlantUML 渲染能力；关闭时 plantuml 代码块退化为普通代码高亮 */
	enable: boolean;
	/** PlantUML 服务器地址，尾部斜杠会自动归一化；默认使用官方公共服务器 */
	server: string;
	/** 亮色模式下注入的 PlantUML 主题名；空字符串表示不注入 */
	lightTheme: string;
	/** 暗色模式下注入的 PlantUML 主题名；空字符串表示不注入 */
	darkTheme: string;
};

export type AnnouncementItem = {
	tag: string; // 类型标签，如「维护」「上新」
	title: string; // 公告标题
	content: string; // 公告正文
	time: string; // 发布时间，如 "2025-06-10"
	link?: string; // 可选跳转链接
	sort: number; // 排序权重，越大越靠前
};

export type AnnouncementConfig = {
	// enable属性已移除，现在通过sidebarLayoutConfig统一控制
	title?: string; // 公告栏标题
	items: AnnouncementItem[]; // 公告列表
	icon?: string; // 公告栏图标
	closable?: boolean; // 是否可关闭
};

export type GuestbookAnnouncementItem = {
	id: string;
	title: string;
	summary: string;
	lead?: string;
	rules: string[];
};

export type GuestbookConfig = {
	announcements: GuestbookAnnouncementItem[];
};

// 单个字体配置
export type FontItem = {
	id: string; // 字体唯一标识符
	name: string; // 字体显示名称
	src: string; // 字体文件路径或URL链接
	family: string; // CSS font-family 名称
	weight?: string | number; // 字体粗细，如 "normal", "bold", 400, 700 等
	style?: "normal" | "italic" | "oblique"; // 字体样式
	display?: "auto" | "block" | "swap" | "fallback" | "optional"; // font-display 属性
	unicodeRange?: string; // Unicode 范围，用于字体子集化
	format?:
		| "woff"
		| "woff2"
		| "truetype"
		| "opentype"
		| "embedded-opentype"
		| "svg"; // 字体格式，仅当 src 为本地文件时需要
};

// 字体配置
export type FontConfig = {
	enable: boolean; // 是否启用自定义字体功能
	selected: string | string[]; // 当前选择的字体ID，支持单个或多个字体组合
	fonts: Record<string, FontItem>; // 字体库，以ID为键的对象
	fallback?: string[]; // 全局字体回退列表
	preload?: boolean; // 是否预加载字体文件以提高性能
};

export type FooterSocialLink = {
	label: string; // 显示文字
	href: string; // 链接（mailto:/tel: 等也支持）
	icon: string; // 图标名
};

export type FooterBeianConfig = {
	icp: string; // ICP 备案号，留空则不显示
	police: string; // 公安网备号，留空则不显示
	policeIcon: string; // 公安备案图标路径
	icpUrl: string; // ICP 备案查询链接
	policeUrl: string; // 公安备案查询链接
};

export type FooterPoweredByItem = {
	label: string; // 前缀文字，如"框架""主题"
	name: string; // 名称，如"Astro""Firefly"
	href: string; // 链接
};

export type FooterConfig = {
	socialLinks: FooterSocialLink[]; // 社交链接
	beian: FooterBeianConfig; // 备案信息
	poweredBy: FooterPoweredByItem[]; // Powered by 信息
};

export type CoverImageConfig = {
	enableInPost: boolean; // 是否在文章详情页显示封面图
	randomCoverImage: {
		enable: boolean; // 是否启用随机图功能
		apis: string[]; // 随机图API列表
		fallback?: string; // API失败时的回退图片路径（相对于src目录或以/开头的public目录路径）
		showLoading?: boolean; // 是否显示加载动画
	};
};

export type SakuraConfig = {
	enable: boolean; // 是否启用樱花特效
	sakuraNum: number; // 樱花数量，默认21
	limitTimes: number; // 樱花越界限制次数，-1为无限循环
	size: {
		min: number; // 樱花最小尺寸倍数
		max: number; // 樱花最大尺寸倍数
	};
	opacity: {
		min: number; // 樱花最小不透明度
		max: number; // 樱花最大不透明度
	};
	speed: {
		horizontal: {
			min: number; // 水平移动速度最小值
			max: number; // 水平移动速度最大值
		};
		vertical: {
			min: number; // 垂直移动速度最小值
			max: number; // 垂直移动速度最大值
		};
		rotation: number; // 旋转速度
		fadeSpeed: number; // 消失速度，不应大于最小不透明度
	};
	zIndex: number; // 层级，确保樱花在合适的层级显示
};

// Spine 看板娘配置
export type SpineModelConfig = {
	enable: boolean; // 是否启用 Spine 看板娘
	model: {
		path: string; // 模型文件路径 (.json)
		scale?: number; // 模型缩放比例，默认1.0
		x?: number; // X轴偏移，默认0
		y?: number; // Y轴偏移，默认0
	};
	position: {
		corner: "bottom-left" | "bottom-right" | "top-left" | "top-right"; // 显示位置
		offsetX?: number; // 水平偏移量，默认20px
		offsetY?: number; // 垂直偏移量，默认20px
	};
	size: {
		width?: number; // 容器宽度，默认280px
		height?: number; // 容器高度，默认400px
	};
	interactive?: {
		enabled?: boolean; // 是否启用交互功能，默认true
		clickAnimations?: string[]; // 点击时随机播放的动画列表
		clickMessages?: string[]; // 点击时随机显示的文字消息
		messageDisplayTime?: number; // 文字显示时间（毫秒），默认3000
		idleAnimations?: string[]; // 待机动画列表
		idleInterval?: number; // 待机动画切换间隔（毫秒），默认10000
	};
	responsive?: {
		hideOnMobile?: boolean; // 是否在移动端隐藏，默认false
		mobileBreakpoint?: number; // 移动端断点，默认768px
	};
	zIndex?: number; // 层级，默认1000
	opacity?: number; // 透明度，0-1，默认1.0
};

// Live2D 看板娘配置
export type Live2DModelConfig = {
	enable: boolean; // 是否启用 Live2D 看板娘
	defaultVisible?: boolean; // 首次访问时是否默认显示并加载模型，默认true
	model: {
		path: string; // 模型文件夹路径或model3.json文件路径
	};
	position?: {
		corner?: "bottom-left" | "bottom-right" | "top-left" | "top-right"; // 显示位置，默认bottom-right
		offsetX?: number; // 水平偏移量，默认20px
		offsetY?: number; // 垂直偏移量，默认20px
	};
	size?: {
		width?: number; // 容器宽度，默认280px
		height?: number; // 容器高度，默认250px
	};
	resolution?: number; // 渲染分辨率倍率，默认使用 window.devicePixelRatio（上限2），值越大越清晰但越耗性能
	interactive?: {
		enabled?: boolean; // 是否启用交互功能，默认true
		// motions 和 expressions 将从模型 JSON 文件中自动读取
		clickMessages?: string[]; // 点击时随机显示的文字消息
		messageDisplayTime?: number; // 文字显示时间（毫秒），默认3000
	};
	author?: {
		name: string; // 作者名字
		url?: string; // 作者主页或视频链接
	};
};

// 友链配置
export type FriendLink = {
	title: string; // 友链标题
	imgurl: string; // 头像图片URL
	desc: string; // 友链描述
	siteurl: string; // 友链地址
	image?: string; // 封面图片URL（可选，不填则卡片显示无图形态）
	tags?: string[]; // 标签数组
	weight: number; // 权重，数字越大排序越靠前
	enabled: boolean; // 是否启用
};

export type FriendSiteInfo = {
	name: string; // 站点名称
	desc: string; // 站点描述
	url: string; // 站点链接
	avatar: string; // 头像链接
	email: string; // 联系邮箱
};

export type FriendNote = {
	title: string; // 注意事项标题
	content: string; // 注意事项内容
};

export type FriendChatMessage = {
	role: "cat" | "owner"; // cat=喵墩（左侧，作者头像），owner=站长（右侧，文字头像）
	name: string; // 气泡署名
	text: string; // 气泡文字，打字机逐字显示
};

export type FriendsPageConfig = {
	title?: string; // 页面标题，留空则使用 i18n 中的翻译
	description?: string; // 页面描述，留空则使用 i18n 中的翻译
	showComment?: boolean; // 是否显示评论区，默认 true
	randomizeSort?: boolean; // 是否打乱排序，如果为 true，将忽略 weight，随机排序
	applyLink?: string; // 友链申请链接，跳转到 GitHub Issue 等
	siteInfo?: FriendSiteInfo; // 本站信息，用于复制展示
	notes?: FriendNote[]; // 注意事项，用于申请区展示
	chat?: FriendChatMessage[]; // 对话气泡文案，滚动到该区域时逐个弹出并打字机显示
};

// 音乐播放器配置
export type MusicPlayerConfig = {
	// 使用方式：'meting' 或 'local'
	mode?: "meting" | "local"; // "meting" 使用 Meting API，"local" 使用本地音乐列表

	// 默认音量 (0-1)
	volume?: number;

	// 播放模式：'list'=列表循环, 'one'=单曲循环, 'random'=随机播放
	playMode?: "list" | "one" | "random";

	// 是否显示歌词
	showLyrics?: boolean;

	// 是否在导航栏显示音乐播放器
	showInNavbar?: boolean;

	// Meting API 配置
	meting?: {
		// Meting API 地址
		api?: string;

		// 音乐平台：netease=网易云音乐, tencent=QQ音乐, kugou=酷狗音乐, xiami=虾米音乐, baidu=百度音乐
		server?: "netease" | "tencent" | "kugou" | "xiami" | "baidu";

		// 类型：song=单曲, playlist=歌单, album=专辑, search=搜索, artist=艺术家
		type?: "song" | "playlist" | "album" | "search" | "artist";

		// 歌单/专辑/单曲 ID 或搜索关键词
		id?: string;

		// 认证 token（可选）
		auth?: string;

		// 备用 API 配置（当主 API 失败时使用）
		fallbackApis?: string[];
	};

	// 本地音乐配置（当 mode 为 'local' 时使用）
	local?: {
		playlist?: Array<{
			name: string; // 歌曲名称
			artist: string; // 艺术家
			url: string; // 音乐文件路径（相对于 public 目录）
			cover?: string; // 封面图片路径（相对于 public 目录）
			lrc?: string; // 歌词内容，支持 LRC 格式
		}>;
	};

	visualizer?: MusicVisualizerConfig;
};

export type MusicVisualizerThemeConfig = {
	base1: string;
	base2: string;
	coolCore: string;
	coolEdge: string;
	warmCore: string;
	warmEdge: string;
	rippleColor: string;
	/** 冷色波纹锚点（安静/低频时）。缺省回退到 rippleColor */
	rippleCool?: string;
	/** 暖色波纹锚点（明亮/高频时）。缺省回退到 warmEdge */
	rippleWarm?: string;
	fogColor: string;
	glowIntensity: number;
};

export type MusicVisualizerHeightConfig = {
	idle: number;
	subBass: number;
	bass: number;
	lowMid: number;
	mid: number;
	highMid: number;
	energy: number;
	ripple: number;
	rippleAccent: number;
};

export type MusicVisualizerConfig = {
	background?: {
		dark: string;
		light: string;
	};
	camera?: {
		position?: {
			x: number;
			y: number;
			z: number;
		};
	};
	autoRotate?: boolean;
	autoRotateSpeed?: number;
	height?: MusicVisualizerHeightConfig;
	theme?: MusicVisualizerThemeConfig;
};

// 赞助方式类型
export type SponsorMethod = {
	name: string; // 赞助方式名称，如 "支付宝"、"微信"、"PayPal"
	icon?: string; // 图标名称（Iconify 格式），如 "fa7-brands:alipay"
	qrCode?: string; // 收款码图片路径（相对于 public 目录），可选
	link?: string; // 赞助链接 URL，可选。如果提供，会显示跳转按钮
	description?: string; // 描述文本
	enabled: boolean; // 是否启用
};

// 赞助者列表项
export type SponsorItem = {
	name: string; // 赞助者名称，如果想显示匿名，可以直接设置为"匿名"或使用 i18n
	amount?: string; // 赞助金额（可选）
	date?: string; // 赞助日期（可选，ISO 格式）
	avatar?: string; // 头像图片URL或路径（可选）
};

// 赞助配置
export type SponsorConfig = {
	title?: string; // 页面标题，默认使用 i18n
	description?: string; // 页面描述文本
	usage?: string; // 赞助用途说明
	methods: SponsorMethod[]; // 赞助方式列表
	sponsors?: SponsorItem[]; // 赞助者列表（可选）
	showSponsorsList?: boolean; // 是否显示赞助者列表，默认 true
};

// 响应式图像布局类型
export type ResponsiveImageLayout = "constrained" | "full-width" | "none";

// 图像格式类型
export type ImageFormat = "avif" | "webp" | "png" | "jpg" | "jpeg" | "gif";

// 相册元信息（用户在配置文件中填写）
export type GalleryAlbum = {
	id: string; // URL slug + 目录名，如 "japan-2025"
	name: string; // 相册名称
	description?: string; // 相册描述
	date?: string; // 日期
	location?: string; // 拍摄地点
	tags?: string[]; // 标签（用于首页筛选）
	cover?: string; // 手动指定封面（可选，省略则自动取 cover.* 或第一张）
};

// 相册配置
export type GalleryConfig = {
	albums: GalleryAlbum[];
	columnWidth?: number; // 瀑布流最小列宽(px)，默认 240，浏览器根据容器宽度自动计算列数
};

// 收藏API单项
export type CollectionApiItem = {
	name: string; // API 名称
	url: string; // API 链接地址
	description: string; // API 描述
	icon?: string; // 图标（Iconify 格式 或 外部图片 URL）
	enabled: boolean; // 是否启用
};

// 收藏API分类分组
export type CollectionApiGroup = {
	category: string; // 分类名称
	description?: string; // 分类简短说明，显示在标题下方，留空则不显示
	items: CollectionApiItem[]; // 该分类下的 API 列表
};

// 收藏API配置
export type CollectionsApiConfig = {
	title?: string; // 页面标题，留空则使用 i18n 翻译
	description?: string; // 页面描述，留空则使用 i18n 翻译
	apis: CollectionApiGroup[]; // API 收藏列表，按 category 分组
	categories?: string[]; // 自定义分类排序，留空则使用 apis 中的分组顺序
};

// ============= 日历配置 =============

// 公历或农历的"月日"对（按年重复）
export type SolarOrLunarDate = {
	type: "solar" | "lunar";
	month: number; // 1-12
	day: number; // 1-31，农历下范围根据月不同
};

// 节日项（按年重复，公历或农历）
export type HolidayItem = {
	name: string; // 节日名称
	date: SolarOrLunarDate; // 公历或农历日期
	icon?: string; // 可选图标（iconify 名）
	note?: string; // 备注
};

// 生日 / 纪念日项（按年重复，公历或农历）
export type BirthdayItem = {
	name: string; // 人物名或事件名
	date: SolarOrLunarDate;
	icon?: string;
	note?: string;
};

// 日历小组件配置
export type CalendarConfig = {
	// 节日 API（构建时拉取，失败回退仅用 builtinHolidays）
	holidayApi: {
		enable: boolean; // 是否启用 API
		url: string; // API 基础 URL，按年拼接
		fallbackOnError: boolean; // 拉取失败是否回退
		years: number[]; // 编译期拉取哪些年份
	};

	// 内置补充节日（如农历节、节气、个性化节日）
	builtinHolidays: HolidayItem[];

	// 生日 / 纪念日
	birthdays: BirthdayItem[];
};
