import type { HomeConfig } from "../types/config";

export const homeConfig: HomeConfig = {
	// 资料卡横幅图（导航 Logo 资料卡第一层）
	// 留空则回退为「站长头像模糊放大」当背景
	avatarBanner: "/assets/images/avatar-banner.webp",

	// 名字
	name: "MmzMing",

	// 首页展示名字（留空则使用 name）
	displayName: "MmzMing",

	// 职业/身份标签
	occupation: "全干工程师 / 技术博主",

	// 个人签名（移动端首页与页脚展示首条）
	bio: ["且视他人之疑目如盏盏鬼火，大胆地去走你的夜路"],

	hero: {
		mosaic: {
			rows: 4,
			columns: 6,
			seed: 20260814,
			scrub: 0.45,
			// 滑动距离整体砍半，同样的滚动量推进更快
			desktopScrollDistance: 3250,
			desktopDialogueTailDistance: 240,
			desktopMinViewports: 4.05,
			interactionHold: 0.06,
		},
		// 第二屏「订阅与联系」缩略态展示的平台，取 links 中同名链接。
		contact: {
			platform: "B站",
		},
		sticker: {
			image: "/assets/images/home/doll.avif",
			alt: "黑猫角色贴纸",
			sounds: {
				press: "/assets/doll-press.mp3",
				loosen: "/assets/doll-loosen.mp3",
			},
		},
		// 拼合完成后的照片态：主图平面倾斜并左移，右侧三张介绍卡片错峰倒下；
		// overlay 会在落位后从下方滑入叠在照片下缘，image 留空不显示；
		// author 填了就在图片右上角显示作者小标牌，留空不显示
		photo: {
			main: {
				image: "/assets/images/home/home.avif",
				author: "by 冰冰坚老师",
			},
			overlay: {
				image: "/assets/images/home/home2.avif",
				author: "by 冰冰坚老师",
			},
			intro: {
				direction: "站点专研方向Java后端、前端、Agent和Python",
				hobby: "热衷于制作一些没人用的小组件和收集好看的AI绘画",
				bio: "且视他人之疑目如盏盏鬼火，大胆地去走你的夜路",
			},
		},
		// 左下角角色的想法气泡：首次出现自动冒第一句，之后点击角色逐句弹出，末句后从头循环
		dialogue: {
			enabled: true,
			lines: [
				"欸——来客人了喵～随便坐，别客气。",
				"我是喵墩，老爸在摸鱼，这儿归我管了喵～",
				"这站的配色是他调的吧，审美这事喵墩不评价。",
				"老爸自称全栈，其实是半桶水，俗称「全干工程师」喵。",
				"前端后端都只会一点点，剩下全靠嘴硬撑着喵。",
				"整站基本是 AI 搓出来的，他喵爪都没动几下，还搁那儿邀功喵。",
				"别被他的技术术语唬住，八成他自己也半懂喵。～",
				"傻爸爸最近在捣鼓 Agent，不知道又要整啥活喵。",
				"角落里藏着不少彩蛋，站点还热乎着，刚出锅的，小心烫爪喵。",
				"感兴趣可以加 QQ 群喵，放心，傻爸爸不咬人的。",
			],
		},
		// 桌面首屏照片态的玻璃雨珠与水花。
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
			// 背景跑马灯胶带：三条斜线按端点位置摆开——
			// 左侧线从底部 1/4 处连到顶部 1/2 处；右侧线从右下角连到顶部左侧 1/4 处；
			// 下方线从右下角连到右侧下方的 1/4 高度处。
			// 文案用完整诗句（古诗与流行句混排）；angle 为倾角（度，正值顺时针）、
			// top/centerX 为中心点落位（%）、thickness 为厚度（px）、speed 为基础速度（px/s）。
			// 胶带会一直匀速滚动（斜纹按半速跟随），横滑时加速、反向横滑时反向滚动
			marquee: {
				tapes: [
					{
						text: "江城如画里，山晚望晴空，两水夹明镜，双桥落彩虹。人烟寒橘柚，秋色老梧桐。谁念北楼上，临风怀谢公。",
						angle: -66,
						top: 50,
						centerX: 37.5,
						thickness: 92,
						speed: 120,
					},
					{
						text: "雾景澄秋，一晚风吹尽朝来雨。夕阳烟树，万里山光暮",
						angle: 37,
						top: 50,
						centerX: 62.5,
						thickness: 74,
						speed: 88,
					},
					{
						text: "年年岁岁花相似，岁岁年年人不同",
						angle: -8,
						top: 87.5,
						centerX: 50,
						thickness: 88,
						speed: 104,
					},
				],
			},
			// 留言墙气泡：同屏去重，每轮不放回；weight 越大越优先出场，缺省按 1 算。
			// 气泡只出文字不出图；文案是 2025—2026 网络热梗与站内老梗混排，梗过时了直接换掉就行
			bubbleMessages: [
				{ text: "Token来", weight: 5 },
				{ text: "昨日一去不复回 欧耶耶", weight: 4 },
				{ text: "年更型站长", weight: 4 },
				{ text: "我来看看怎么个事", weight: 4 },
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
			standImages: [
				"/assets/images/home-blinds/act2-doll/1.gif",
				"/assets/images/home-blinds/act2-doll/2.gif",
			],
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
