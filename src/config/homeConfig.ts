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

	hero: {
		backgroundImage: "/assets/images/home/home.avif",
		backgroundImageMobile: "/assets/images/home/home-mobile.avif",
		mosaic: {
			rows: 4,
			columns: 6,
			idleVisible: 6,
			idleInterval: 900,
			seed: 20260814,
			// 首屏六块碎片按 reveal rank 放置；滚动或轮换后的随机布局不受影响。
			initialLayout: [
				{ x: 0.14, y: 0.305, width: 0.104, height: 0.205 },
				{ x: 0.435, y: 0.18, width: 0.068, height: 0.13, blur: 5.5 },
				{ x: 0.642, y: 0.368, width: 0.047, height: 0.092, blur: 5 },
				{ x: 0.863, y: 0.402, width: 0.097, height: 0.19 },
				{ x: 0.337, y: 0.653, width: 0.159, height: 0.313 },
				{ x: 0.639, y: 0.751, width: 0.116, height: 0.228 },
			],
			scrub: 0.45,
			// 滑动距离整体砍半，同样的滚动量推进更快
			desktopScrollDistance: 3250,
			mobileScrollDistance: 2300,
			desktopDialogueTailDistance: 240,
			mobileDialogueTailDistance: 180,
			desktopMinViewports: 4.05,
			mobileMinViewports: 3.05,
			interactionHold: 0.06,
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

	// 桌面端双层影像交互：固定背景揭示 → 五幕画面横向叙事
	homeBlinds: {
		enabled: true,
		reveal: {
			backgroundImage: "/assets/images/home-blinds/act2/1.webp",
			foregroundImage: "/assets/images/home-blinds/act1/1.webp",
			foregroundAlt: "奔跑人物剪影",
			foregroundOpacity: 0.5,
			pointerTravel: 28,
			// 长条横移揭示的入场标题：标题单行显示（版式按 4 字排），
			// 祝福语单行显示（版式按 5 字排），可自由增减条数
			headline: {
				title: "祝愿各位",
				messages: ["夜路有星光", "岁岁皆欢愉", "所念皆星河", "版本无回滚"],
				enterDuration: 0.5,
				messageHold: 2.6,
				messageFlipDuration: 0.75,
			},
		},
		scenes: {
			scrollDistance: 3400,
			// 背景跑马灯：列表从左往右无缝循环，只有一张也会自动复制到铺满
			cycleImages: ["/assets/images/home-blinds/act-cycle/1.webp"],
			cycleDuration: 26,
			composite: {
				eyebrow: "PROLOGUE / RUN",
				title: "奔向下一幕",
				description: "光影从身后掠过，把正在发生的故事收进这一帧。",
				alt: "背景与奔跑人物剪影合成的首幕画面",
			},
			items: [
				{
					eyebrow: "SCENE 02 / LIGHT",
					title: "沿途拾光",
					description: "让短暂的风景停驻，在下一次转场前多看一眼。",
					image: "/assets/images/home-blinds/act3/1.webp",
					alt: "第二幕插画",
				},
				{
					eyebrow: "SCENE 03 / WIND",
					title: "风经过这里",
					description: "留在画里的是此刻，被风吹动的是仍未写完的旅程。",
					image: "/assets/images/home-blinds/act3/2.webp",
					alt: "第三幕插画",
				},
				{
					eyebrow: "SCENE 04 / PAGE",
					title: "收进一页",
					description: "把颜色、温度与偶然相遇的瞬间，一起留在纸面。",
					image: "/assets/images/home-blinds/act3/3.webp",
					alt: "第四幕插画",
				},
				{
					eyebrow: "FINALE / ARRIVE",
					title: "抵达之前",
					description: "最后一幕停在中央，下一段路从这里重新开始。",
					image: "/assets/images/home-blinds/act3/4.webp",
					alt: "第五幕插画",
				},
			],
			standImages: ["/assets/images/home-blinds/act4/1.webp"],
		},
	},

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
