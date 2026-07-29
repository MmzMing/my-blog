import type { FriendLink, FriendsPageConfig } from "../types/config";

// 友链页面配置
export const friendsPageConfig: FriendsPageConfig = {
	// 页面标题，如果留空则使用 i18n 中的翻译
	title: "",

	// 页面描述文本，如果留空则使用 i18n 中的翻译
	description: "",

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
		avatar: "https://i.stardots.io/784774835/StarDots-2026052116374135506.jpg",
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
		imgurl: "https://i.stardots.io/784774835/StarDots-2026052116445539713.jpg",
		desc: "目前只展示前端，仿B站，微服务架构，支持视频上传和播放，文档上传和下载，后台还带链路监控、日志监控等功能等等。因为使劲堆后台，内存消耗实在太大部署不起",
		siteurl: "https://dev.mmzmingzsk.dpdns.org/",
		tags: ["Blog"],
		weight: 5,
		enabled: true,
	},
	{
		title: "番茄主理人",
		imgurl: "https://q1.qlogo.cn/g?b=qq&nk=20447289&s=640",
		desc: "坐而言不如起而行.",
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
	{
		title: "UpXuu",
		imgurl: "https://upxuu.com/images/20260214145619.jpg",
		desc: "逐光而上",
		siteurl: "https://upxuu.com/",
		tags: ["Blog"],
		weight: 5,
		enabled: true,
	},
	{
		title: "椰汁の博客",
		imgurl: "https://free.picui.cn/free/2026/03/23/69c12fe83f7a4.jpg",
		desc: " 关关难过关关过,前路漫漫亦灿灿. ",
		siteurl: "https://home.132614.xyz/",
		tags: ["Blog"],
		weight: 5,
		enabled: true,
	},
	{
		title: "Sigrika-善良耙耙柑🍊",
		imgurl:
			"https://weavatar.com/avatar/bc0dba25ea5949e8290d012e081ceec669aa7784c7ad765173473c80cbaee404",
		desc: "记录我的二次元之旅",
		siteurl: "https://qwq.sigrika.cc/",
		tags: ["Blog"],
		weight: 5,
		enabled: true,
	},
	{
		title: "团子和蛋糕",
		imgurl: "https://re.tsh520.cn/zl/tx.webp",
		desc: "如果你喜欢那么欢迎来到我的世界！",
		siteurl: "https://blog.tsh520.cn/",
		tags: ["Blog"],
		weight: 5,
		enabled: true,
	},
	{
		title: "mccsjs",
		imgurl: "https://blog.seln.cn/img/ico.jpg",
		desc: "点一盏灯，等待一个迷路的夜🍁",
		siteurl: "https://blog.seln.cn/",
		tags: ["Blog"],
		weight: 5,
		enabled: true,
	},
	{
		title: "抚七kilroy",
		imgurl: "https://bu.dusays.com/2025/09/03/68b82f0be7fb7.webp",
		desc: "记录与分享技术的每一刻,同时享受生活的点滴",
		siteurl: "https://fuqikilroy.github.io/HEXO/",
		tags: ["Blog"],
		weight: 5,
		enabled: true,
	},
	{
		title: "ysdy~Blog",
		imgurl:
			"https://i.stardots.io/366046882645/StarDots-2026061016244768517.webp",
		desc: "人生苦短，摆烂优先",
		siteurl: "https://ysdyblog.ccwu.cc/",
		tags: ["Blog"],
		weight: 5,
		enabled: true,
	},
	{
		title: "YFBLOG - 幻新至简",
		imgurl: "https://cdn.yfblog.asia/image/favicon.ico",
		desc: "随手笔记，技术心得分享",
		siteurl: "https://yfblog.asia/",
		tags: ["Blog"],
		weight: 5,
		enabled: true,
	},
	{
		title: "阿叶Ayeez的小站",
		imgurl: "https://qiniu.ayeez.cn/avatar.jpg",
		desc: "记录学习历程，记录美好生活",
		siteurl: "https://blog.Ayeez.cn",
		tags: ["Blog"],
		weight: 5,
		enabled: true,
	},
	{
		title: "云灿の随笔小站",
		imgurl: "https://yuncan.xyz/images/icon/favicon.ico",
		desc: "浮云一别后，流水十年间",
		siteurl: "https://blog.yuncan.xyz/",
		tags: ["Blog"],
		weight: 5,
		enabled: true,
	},
	{
		title: "阿的宝藏之地",
		imgurl: "https://bu.dusays.com/2026/06/20/6a361fc5c68ff.jpg",
		desc: "记录项目、数学思考与杂谈。",
		siteurl: "https://nothing-new.icu/",
		tags: ["Blog"],
		weight: 5,
		enabled: true,
	},
	{
		title: "Olinl Blog",
		imgurl: "https://q2.qlogo.cn/headimg_dl?dst_uin=9892214&spec=0",
		desc: "分享、实践、学习",
		siteurl: "https://blog.olinl.com/",
		tags: ["Blog"],
		weight: 5,
		enabled: true,
	},
	{
		title: "星遐蝶梦",
		imgurl: "https://blog.casto.top/assets/images/avatar.png",
		desc: "星穹漫遐，蝶携清梦。",
		siteurl: "https://blog.casto.top/",
		tags: ["Blog"],
		weight: 5,
		enabled: true,
	},
	{
		title: "雾语",
		imgurl: "https://db.picspot.cn/foglog/favicon.ico",
		desc: "迷雾轻语，雅意深藏",
		siteurl: "https://foglog.cn/",
		tags: ["Blog"],
		weight: 5,
		enabled: true,
	},
	{
		title: "Kanako的小窝",
		imgurl: "https://blog.kanako.top/icon.png",
		desc: "宁静致远，厚积薄发",
		siteurl: "https://blog.kanako.top/",
		tags: ["Blog"],
		weight: 5,
		enabled: true,
	},
	{
		title: "RAGNote",
		imgurl: "https://ragnote.top/avatar.png",
		desc: "一堆水文的小站，记录学习过程、项目实践，以及那些让我感兴趣的事物。Life is code. I will debug it.",
		siteurl: "https://ragnote.top/",
		tags: ["Blog"],
		weight: 5,
		enabled: true,
	},
	{
		title: "拾玖的博客",
		imgurl: "https://shijiucode.cn/avatar.jpg",
		desc: "人间风情千万般，值得觊觎一眼。",
		siteurl: "https://shijiucode.cn/",
		tags: ["Blog"],
		weight: 5,
		enabled: true,
	},
	{
		title: "Meet Blog 博客星图",
		imgurl: "https://meet-blog.buyixiao.xyz/favicon.svg",
		desc: "Meet Blog 博客星图",
		siteurl:
			"https://meet-blog.buyixiao.xyz/?ref=https%3A%2F%2Ftblog.mmzhiku.xyz/",
		tags: ["星图"],
		weight: 5,
		enabled: true,
	},
	{
		title: "Aimerting",
		imgurl: "https://blog.xuioo.com/avatar.jpg",
		desc: "「纯粹祈愿皆成真」",
		siteurl: "https://blog.xuioo.com/",
		tags: ["Blog"],
		weight: 5,
		enabled: true,
	},
	{
		title: "静かな森",
		imgurl: "https://avatars.githubusercontent.com/u/41265413?v=4",
		desc: "致虚极，守静笃。",
		siteurl: "https://innei.in/",
		tags: ["FavoriteBlog"],
		weight: 5,
		enabled: true,
	},
	{
		title: "月读空间",
		imgurl: "https://yachiyo.hk/assets/icons/icon-512.png",
		desc: "超时空辉夜姬同人小站",
		siteurl: "https://yachiyo.hk/",
		tags: ["Blog"],
		weight: 5,
		enabled: true,
	},
	{
		title: "Eliauk's Blog",
		imgurl: "https://img.eliauk312.top/avatar/default-avatar.jpg",
		desc: "一方天地，记录代码、生活和偶尔的奇思妙想。",
		siteurl: "https://eliauk312.top/",
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

	// 权重降序；同权重时保留配置列表中的原始顺序
	return friends
		.map((friend, index) => ({ friend, index }))
		.sort((a, b) => b.friend.weight - a.friend.weight || a.index - b.index)
		.map(({ friend }) => friend);
};
