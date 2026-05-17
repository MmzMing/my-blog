import type { FriendLink, FriendsPageConfig } from "../types/config";

// 可以在src/content/spec/friends.md中编写友链页面下方的自定义内容

// 友链页面配置
export const friendsPageConfig: FriendsPageConfig = {
	// 页面标题，如果留空则使用 i18n 中的翻译
	title: "",

	// 页面描述文本，如果留空则使用 i18n 中的翻译
	description: "",

	// 是否显示底部自定义内容（friends.mdx 中的内容）
	showCustomContent: true,

	// 是否显示评论区，需要先在commentConfig.ts启用评论系统
	showComment: true,

	// 是否开启随机排序配置，如果开启，就会忽略权重，构建时进行一次随机排序
	randomizeSort: false,

	// 友链申请链接，填写后会在友链页面显示申请按钮
	// 使用模板参数直接跳转到友链申请模板
	applyLink:
		"https://github.com/MmzMing/my-blog/issues/new?template=friend-link.yml",

	// 本站信息，用于友链申请指南弹窗中的站点信息展示
	siteInfo: {
		name: "MmzMing的知识库",
		desc: "哈基米，南北绿豆",
		url: "https://tblog.mmzhiku.xyz",
		avatar: "https://i.stardots.io/784774835/StarDots-2026051117505284739.webp",
		email: "784774835@qq.com",
	},

	// 注意事项，用于友链申请指南弹窗中的注意事项展示
	notes: [
		{
			title: "互换原则",
			content: "请先将本站添加到您的友链页面，确认后会添加您的友链",
		},
		{
			title: "链接维护",
			content: "友链网站长期无法访问或内容违规，将会被移除",
		},
		{
			title: "内容要求",
			content: "内容积极向上，不含有任何含色情/反动/暴力等违法违规内容",
		},
		{
			title: "站点要求",
			content: "支持 HTTPS，以原创内容为主，能够正常访问且有持续更新",
		},
	],
};

// 友链配置
export const friendsConfig: FriendLink[] = [
	{
		title: "Firefly Docs",
		imgurl: "https://docs-firefly.cuteleaf.cn/logo.png",
		desc: "Firefly主题模板文档",
		siteurl: "https://docs-firefly.cuteleaf.cn",
		tags: ["Docs"],
		weight: 5,
		enabled: true,
	},
	{
		title: "原博客(已迁移)",
		imgurl: "https://i.stardots.io/784774835/StarDots-2026042803043780900.png",
		desc: "目前只展示前端，带企业级的后台视频博客。支持视频上传和播放，文档上传和下载，后台还带链路监控、日志监控等功能等等。因为使劲堆后台，实在太大，中间件一开启就用掉了6G的内存，还是一个微服务架构的博客。",
		siteurl: "https://dev.mmzmingzsk.dpdns.org/",
		tags: ["Blog"],
		weight: 5,
		enabled: true,
	},
	{
		title: "Fqzlr",
		imgurl: "https://q1.qlogo.cn/g?b=qq&nk=379446167&s=640",
		desc: "番茄煮理人大佬的博客，一位主打「人间凑数」「快乐摸鱼」的生活体验家，解锁了各种有趣的「非专业」技能，热衷于在生活里挖掘快乐，在摆烂中寻找平衡。",
		siteurl: "https://fqzlr.com/",
		tags: ["Blog"],
		weight: 5,
		enabled: true,
	},
	{
		title: "琳心",
		imgurl: "https://karina.xin/IMG_0280.jpeg",
		desc: "恣意探索 放弃就到此为止啦….",
		siteurl: "https://karina.xin/",
		tags: ["Blog"],
		weight: 5,
		enabled: true,
	},
	{
		title: "二叉树树",
		imgurl: "https://q2.qlogo.cn/headimg_dl?dst_uin=2726730791&spec=0",
		desc: "Protect What You Love.",
		siteurl: "https://2x.nz/",
		tags: ["Blog"],
		weight: 5,
		enabled: true,
	},
	{
		title: "流欺の博客",
		imgurl: "https://tc.lqay.cn/LightPicture/2026/03/5f64e0f0f361e19c.png",
		desc: "嗯对就是个博客",
		siteurl: "https://blog.lqay.cn/",
		tags: ["Blog"],
		weight: 5,
		enabled: true,
	},
	{
		title: "xf_blog",
		imgurl:
			"https://github.com/xfcnl/xfcnl.github.io/blob/main/image/MEITU_20260128_220225596.jpg?raw=true",
		desc: "立志用 cloudflare workers，GitHub pages 和 vercel 做出整个互联网的up（虽然不会成功",
		siteurl: "https://xfcnl.github.io/",
		tags: ["Blog"],
		weight: 5,
		enabled: true,
	},
	{
		title: "星轨手札",
		imgurl: "https://yuulog.org/_astro/avatar.Djw_wQKk_Z1Q0puo.webp",
		desc: "德国留学、日本旅行与技术折腾记录",
		siteurl: "https://yuulog.org/",
		tags: ["Blog"],
		weight: 5,
		enabled: true,
	},
	{
		title: "楠枝小笺",
		imgurl: "https://www.nannax.top/upload/IMG_20260412_164454.ico",
		desc: "安安静静地存在，就已经很好啦。",
		siteurl: "https://www.nannax.top/",
		tags: ["Blog"],
		weight: 5,
		enabled: true,
	},
];

// 获取启用的友链并进行排序
export const getEnabledFriends = (): FriendLink[] => {
	const friends = friendsConfig.filter((friend) => friend.enabled);

	if (friendsPageConfig.randomizeSort) {
		return friends.sort(() => Math.random() - 0.5);
	}

	return friends.sort((a, b) => b.weight - a.weight);
};
