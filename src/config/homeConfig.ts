import type { HomeConfig } from "../types/config";

export const homeConfig: HomeConfig = {
	// 头像
	// 图片路径支持三种格式：
	// 1. public 目录（以 "/" 开头，不优化）："/assets/images/avatar.webp"
	// 2. src 目录（不以 "/" 开头，自动优化但会增加构建时间，推荐）："assets/images/avatar.webp"
	// 3. 远程 URL："https://example.com/avatar.jpg"
	avatar: "assets/images/avatar.webp",

	// 资料卡横幅图（导航 Logo 资料卡第一层）
	// 路径约定与头像一致；留空则回退为「头像模糊放大」当背景
	avatarBanner: "/assets/images/avatar-banner.webp",

	// 名字
	name: "MmzMing",

	// 首页展示名字（留空则使用 name）
	displayName: "MmzMing",

	// 职业/身份标签
	occupation: "[全干工程师 / 技术博主]",

	// 个人签名（支持多条，会循环打字+删除效果）
	bio: ["且视他人之疑目如盏盏鬼火，大胆地去走你的夜路"],

	hero: {
		backgroundImage: "/assets/images/home/home.avif",
		mosaic: {
			rows: 4,
			columns: 6,
			idleVisible: 6,
			seed: 20260814,
			// 首屏六块碎片按 reveal rank 放置，入场后停在这套布局上不再轮换。
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

	// 桌面端影像叙事：背景视差揭示（全屏磨砂玻璃衬底）→ 五幕画面横向叙事
	homeBlinds: {
		enabled: true,
		reveal: {
			backgroundImage: "/assets/images/home-blinds/act1/1.webp",
			// 长条横移揭示的入场标题：标题单行显示（版式按 4 字排），
			// 祝福语单行显示（版式按 5 字排），可自由增减条数
			headline: {
				title: "祝愿各位",
				messages: ["夜路有星光", "岁岁皆欢愉", "所念皆星河", "版本无回滚"],
				enterDuration: 0.6,
				messageHold: 2.6,
				messageFlipDuration: 0.75,
			},
		},
		scenes: {
			scrollDistance: 3400,
			// 拼图背景往左挪完一个循环周期（4 块）所需的秒数，越小越快
			cycleDuration: 2.4,
			// 留言墙气泡：同屏去重，每轮不放回；weight 越大越优先出场，缺省按 1 算。
			// text 与 image 至少给一个；给了 image 就在文字下方带一张图。
			// 文案是 2025—2026 网络热梗与站内老梗混排，梗过时了直接换掉就行
			bubbleMessages: [
				{
					text: "Token来",
					weight: 5,
					image: "/assets/images/home-blinds/act2-background/101.webp",
				},
				{
					text: "昨日一去不复回 欧耶耶",
					weight: 4,
					image: "/assets/images/home-blinds/act2-background/3.gif",
				},
				{
					text: "年更型站长",
					weight: 4,
					image: "/assets/images/home-blinds/act2-background/2.gif",
				},
				{
					text: "我来看看怎么个事",
					weight: 4,
					image: "/assets/images/home-blinds/act2-background/1.gif",
				},
				{ text: "主打一个随缘更新", weight: 3 },
				{ text: "低山臭水遇知音", weight: 3 },
				{ text: "站长，博客开源吗", weight: 3 },
				{ text: "活人感拉满", weight: 3 },
				{ text: "爱你，站长", weight: 3 },
				{ text: "版本无回滚", weight: 3 },
				{ text: "别熬夜了", weight: 3 },
				{ text: "刚出锅，趁热看", weight: 2 },
				{ text: "开源的，开源的", weight: 2 },
				{ text: "哈基墩到此一游", weight: 2 },
				{ text: "敬自己一杯", weight: 2 },
				{ text: "感觉很赞", weight: 2 },
				{ text: "班味有点重", weight: 2 },
				{ text: "已收藏，下次一定看", weight: 2 },
				{ text: "归档翻到凌晨三点", weight: 2 },
			],
			// 从评论区捞一条真实留言混进上面这池子：滚到影像层才异步取，且只取一次
			commentBubble: {
				enabled: true,
				weight: 4,
			},
			composite: {
				title: "筑一间小屋",
				description: "以代码为梁、热爱为瓦，荒原上筑起一间自己的小屋。",
				alt: "第一幕插画",
				// 明信片左下角标题下的完整日期；删掉即只显示标题
				date: "2026 / 05 / 07",
			},
			items: [
				{
					title: "小屋落户",
					description: "一纸备案落定，小屋自此有门有牌，堂堂正正晒着太阳。",
					image: "/assets/images/home-blinds/act2/1.webp",
					alt: "第二幕插画",
					date: "2026 / 06 / 10",
				},
				{
					title: "尘满窗台",
					description: "人往学海拾新，倦意悄悄落了窗，小屋静候，蒙上薄尘。",
					image: "/assets/images/home-blinds/act2/2.webp",
					alt: "第三幕插画",
					date: "2026 / 06 / 21",
				},
				{
					title: "重燃灯火",
					description: "拂去薄尘，重燃灯火，一砖一瓦再把小屋细细打磨。",
					image: "/assets/images/home-blinds/act2/3.webp",
					alt: "第四幕插画",
					date: "2026 / 08 / 18",
				},
				{
					title: "抵达之前",
					description: "笔墨暂歇，来日方长；下一程山水，且歌且行。",
					image: "/assets/images/home-blinds/act2/4.webp",
					alt: "第五幕插画",
					date: "2026 / 09 / 01",
				},
			],
			standImages: ["/assets/images/home-blinds/act2-doll/1.gif", "/assets/images/home-blinds/act2-doll/2.gif"],
		},
	},

	// 链接配置
	// 已经预装的图标集：fa7-brands，fa7-regular，fa7-solid，material-symbols，simple-icons
	// 访问https://icones.js.org/ 获取图标代码，
	// 如果想使用尚未包含相应的图标集，则需要安装它
	// `pnpm add @iconify-json/<icon-set-name>`
	links: [
		{
			name: "qq",
			icon: "fa7-brands:qq",
			url: "https://qm.qq.com/q/2R07cjGTZ0",
			color: "#12B7F6",
		},
		{
			name: "B站",
			icon: "fa7-brands:bilibili",
			url: "https://space.bilibili.com/15446538",
			color: "#FB7299",
		},
		{
			name: "GitHub",
			icon: "fa7-brands:github",
			url: "https://github.com/MmzMing",
			color: "#1F6FEB",
		},
		{
			name: "站内留言",
			icon: "material-symbols:chat-rounded",
			url: "/guestbook/",
			color: "#B8FF1F",
		},
		{
			name: "RSS",
			icon: "fa7-solid:rss",
			url: "/rss/",
			color: "#F26522",
		},
	],
};
