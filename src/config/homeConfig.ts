import type { HomeConfig } from "../types/config";

export const homeConfig: HomeConfig = {
	// 头像
	// 图片路径支持三种格式：
	// 1. public 目录（以 "/" 开头，不优化）："/assets/images/avatar.webp"
	// 2. src 目录（不以 "/" 开头，自动优化但会增加构建时间，推荐）："assets/images/avatar.webp"
	// 3. 远程 URL："https://example.com/avatar.jpg"
	avatar: "assets/images/avatar.webp",

	// 名字
	name: "MmzMing",

	// 首页展示名字（留空则使用 name）
	displayName: "MmzMing",

	// 职业/身份标签
	occupation: "[(伪)全栈工程师[全干工程师] / 技术博主]",

	// 个人签名（支持多条，会循环打字+删除效果）
	bio: ["且视他人之疑目如盏盏鬼火，大胆地去走你的夜路"],

	// 关于页 3D 文字球贴图（public 目录路径）
	aboutCanvasTexture: "/assets/images/about.avif",

	hero: {
		backgroundImage: "/assets/images/home/home.avif",
		backgroundImageMobile: "/assets/images/home/home-mobile.avif",
		mosaic: {
			rows: 4,
			columns: 6,
			idleVisible: 6,
			idleInterval: 900,
			seed: 20260814,
			scrub: 0.45,
			desktopScrollDistance: 6500,
			mobileScrollDistance: 4600,
			desktopMinViewports: 8.1,
			mobileMinViewports: 6.1,
			interactionHold: 0.17,
		},
		quickActions: [
			{
				id: "articles",
				kind: "link",
				label: "我想查看文章",
				icon: "material-symbols:article-outline-rounded",
				href: "/archive/",
			},
			{
				id: "music",
				kind: "music",
				label: "我想听歌",
				icon: "material-symbols:music-note-rounded",
				fallbackHref: "/music/",
			},
			{
				id: "guestbook",
				kind: "link",
				label: "我想留言",
				icon: "mingcute:comment-line",
				href: "/guestbook/",
			},
		],
		contact: {
			platform: "B站",
			handle: "Mmz明崽",
		},
		sticker: {
			image: "/assets/images/home/character.avif",
			alt: "黑猫角色贴纸",
			eye: {
				xPercent: 41.1,
				yPercent: 48.2,
				travelXPercent: 1.4,
				travelYPercent: 1,
			},
			rightEye: {
				xPercent: 64.1,
				yPercent: 44.7,
			},
			mouth: {
				xPercent: 53.4,
				yPercent: 50.7,
				widthPercent: 7.2,
				heightPercent: 1.9,
				rotation: -6,
				travelScale: 0.45,
			},
		},
		// galgame 对话框（写死暗黑主题）。内容全部由此驱动，可自由增删
		dialogue: {
			enabled: true,
			speakers: {
				host: "哈基墩",
				visitor: "访客",
			},
			menuTitle: "想聊点什么？",
			typingSpeed: 45,
			autoDelay: 1600,
			// 默认逐句播放的简介，末句后弹出话题菜单
			intro: [
				{ speaker: "host", text: "欸——来客人了喵～随便坐，别客气。" },
				{ speaker: "host", text: "我是喵墩，老爸在摸鱼，这儿归我管了喵～" },
				{
					speaker: "host",
					text: "对了喵，得搬上简介了~喵找找：且视他人之疑目如盏盏鬼火，大胆地去走你的夜路。",
				},
				{ speaker: "host", text: "想打听啥喵？戳戳下面的话题，喵跟你慢慢唠～" },
			],
			// 话题菜单：点击进入逐句对话，末句后返回菜单
			topics: [
				{
					title: "关于我",
					lines: [
						{ speaker: "visitor", text: "你爸是哪方面选手呀？" },
						{
							speaker: "host",
							text: "嘛……算个半桶水全栈喵，外加一个不务正业的博客写手。",
						},
						{
							speaker: "host",
							text: "前端后端都摸一点，俗称「全干工程师」喵～",
						},
						{ speaker: "visitor", text: "听起来很忙的样子。" },
						{
							speaker: "host",
							text: "忙归忙，但好玩呀——折腾本身就是浪漫喵～如果你感兴趣也可以加QQ群喵，放心，傻爸爸不咬人的",
						},
					],
				},
				{
					title: "博客特色",
					lines: [
						{ speaker: "visitor", text: "有什么好玩的功能吗？" },
						{
							speaker: "host",
							text: "有个音乐3D可视化播放，但博客重点不是文章吗喵~老爸整站基本是AI搓出来的，喵爪都没动几下。",
						},
						{
							speaker: "host",
							text: "傻爸爸最近在捣鼓Agent，不知道又要整啥活喵～",
						},
						{ speaker: "host", text: "慢慢逛，角落里藏着不少彩蛋呢喵！" },
					],
				},
			],
		},
		// 玻璃雨珠 + 撞击水花（移动端自动降低密度，尊重 prefers-reduced-motion）
		rain: {
			enabled: true,
			intensity: 0.6,
			// 留空则随主题自动取色（暗色→白 / 浅色→深灰）；也可填 "#7fb0ff" 或 "127,176,255"
			color: "#ffffff",
		},
	},

	dataLayer: {
		visitImage: "/assets/images/home/home-data-1.avif",
		archiveImage: "/assets/images/home/home-data-2.avif",
		contactImage: "/assets/images/home/home-data-3.avif",
	},

	// 展示层：垂直线 → 长柱 → 字体显隐 → 柱子扩全屏 → 衔接百叶窗
	displayLayer: {
		enabled: true,
		kicker: "作品展示",
		title: "CRYSTALLIZE GALLERY",
		description:
			"Where fleeting visions crystallize into permanence — each frame a frozen breath of time, each work a memory hardened into light.",
		scrollDistance: 4000,
		pillarFinalWidth: "18vw",
		emitterImage: "/assets/images/home-truncated/td.avif",
	},

	portfolioShutter: {
		enabled: true,
		kicker: "The End",
		title: "愿你每一天 都闪闪发光",
		description: "岁岁常欢愉，万事皆胜意",
		scrollDistance: 3000,
		finalImage: {
			midgroundImage: "/assets/images/home-truncated/utl-back1.avif",
			backgroundVideo: "/assets/images/home-truncated/utl-back2.mp4",
			foregroundImage: "/assets/images/home-truncated/utl-1.avif",
			alt: "2026年 加油！",
		},
		interlude: {
			foreground: "/assets/images/home-truncated/b-1.avif",
			stripLeft: "/assets/images/home-truncated/b-2.avif",
			stripRight: "/assets/images/home-truncated/b-3.avif",
			copyLeft: "菲比",
			copyRight: "啾比",
		},
		panels: [
			{
				title: "外部站点",
				english: "PROJECTS",
				description: "菲比主站 · 工具导航",
				image: "/assets/images/home-truncated/1.avif",
				alt: "外部站点",
			},
			{
				title: "术业专攻",
				english: "SPECIALITIES",
				description: "AI学习 · 技术架构 · 踩坑记录",
				image: "/assets/images/home-truncated/2.avif",
				alt: "术业专攻",
			},
			{
				title: "博客特色",
				english: "BLOG FEATURES",
				description: "RAG 知识检索 · 归档热力图 · 结构化知识库",
				image: "/assets/images/home-truncated/3.avif",
				alt: "博客特色",
			},
			{
				title: "站点技术",
				english: "STACK",
				description: "Astro · SSG静态生成 · 纯AI零手工",
				image: "/assets/images/home-truncated/4.avif",
				alt: "站点技术",
			},
			{
				title: "相册收录",
				english: "PHOTO ALBUM",
				description: "AI 生图 · API 接入",
				image: "/assets/images/home-truncated/5.avif",
				alt: "相册收录",
			},
		],
	},

	// 首页技能图标
	skills: [
		{ name: "Astro", icon: "simple-icons:astro", group: "Frontend" },
		{ name: "Svelte", icon: "simple-icons:svelte", group: "Frontend" },
		{ name: "TypeScript", icon: "simple-icons:typescript", group: "Language" },
		{ name: "React", icon: "simple-icons:react", group: "Frontend" },
		{ name: "Tailwind", icon: "simple-icons:tailwindcss", group: "Style" },
		{ name: "Java", icon: "mdi:language-java", group: "Backend" },
		{ name: "Python", icon: "simple-icons:python", group: "Language" },
		{ name: "Spring", icon: "simple-icons:spring", group: "Backend" },
		{ name: "Redis", icon: "simple-icons:redis", group: "Storage" },
		{ name: "MySQL", icon: "simple-icons:mysql", group: "Storage" },
		{ name: "MongoDB", icon: "simple-icons:mongodb", group: "Storage" },
		{ name: "RabbitMQ", icon: "simple-icons:rabbitmq", group: "Backend" },
		{ name: "Docker", icon: "simple-icons:docker", group: "DevOps" },
		{ name: "Linux", icon: "simple-icons:linux", group: "DevOps" },
		{ name: "Nginx", icon: "simple-icons:nginx", group: "DevOps" },
	],

	// 链接配置
	// 已经预装的图标集：fa7-brands，fa7-regular，fa7-solid，material-symbols，simple-icons
	// 访问https://icones.js.org/ 获取图标代码，
	// 如果想使用尚未包含相应的图标集，则需要安装它
	// `pnpm add @iconify-json/<icon-set-name>`
	// showName: true 时显示图标和名称，false 时只显示图标
	links: [
		{
			name: "qq",
			icon: "fa7-brands:qq",
			url: "https://qm.qq.com/q/2R07cjGTZ0",
			showName: false,
		},
		{
			name: "B站",
			icon: "fa7-brands:bilibili",
			url: "https://space.bilibili.com/15446538",
			showName: false,
		},
		{
			name: "GitHub",
			icon: "fa7-brands:github",
			url: "https://github.com/MmzMing",
			showName: false,
		},
		{
			name: "站内留言",
			icon: "material-symbols:chat-rounded",
			url: "/guestbook/",
			showName: false,
		},
		{
			name: "RSS",
			icon: "fa7-solid:rss",
			url: "/rss/",
			showName: false,
		},
	],
};
