import type { Live2DModelConfig, SpineModelConfig } from "../types/config";

// Spine 看板娘配置
export const spineModelConfig: SpineModelConfig = {
	// Spine 看板娘开关
	enable: false,

	// Spine模型配置
	model: {
		// Spine模型文件路径
		path: "/pio/models/spine/firefly/1310.json",
		// 模型缩放比例
		scale: 1.0,
		// X轴偏移
		x: 0,
		// Y轴偏移
		y: 0,
	},

	// 位置配置
	position: {
		// 显示位置 bottom-left，bottom-right，top-left，top-right，注意：在右下角可能会挡住返回顶部按钮
		corner: "bottom-left",
		// 距离边缘0px
		offsetX: 0,
		// 距离下边缘0px
		offsetY: 0,
	},

	// 尺寸配置
	size: {
		// 容器宽度
		width: 135,
		// 容器高度
		height: 165,
	},

	// 交互配置
	interactive: {
		// 交互功能开关
		enabled: true,
		// 点击时随机播放的动画列表
		clickAnimations: [
			"emoji_0",
			"emoji_1",
			"emoji_2",
			"emoji_3",
			"emoji_4",
			"emoji_5",
		],
		// 点击时随机显示的文字消息
		clickMessages: [
			"你好呀！我是哈基墩~",
			"今天也要加油哦！✨",
			"想要一起去看星空吗？🌟",
			"记得要好好休息呢~",
			"站长爸爸不再哦，有什么想对我说的吗？💫",
			"让我们一起探索未知的世界吧！🚀",
			"每一颗星星都有自己的故事~⭐",
			"希望能带给你温暖和快乐！💖",
		],
		// 文字显示时间（毫秒）
		messageDisplayTime: 3000,
		// 待机动画列表
		idleAnimations: ["idle", "emoji_0", "emoji_1", "emoji_3", "emoji_4"],
		// 待机动画切换间隔（毫秒）
		idleInterval: 8000,
	},

	// 响应式配置
	responsive: {
		// 在移动端隐藏
		hideOnMobile: true,
		// 移动端断点
		mobileBreakpoint: 768,
	},

	// 层级
	zIndex: 1000, // 层级

	// 透明度
	opacity: 1.0,
};

// Live2D 看板娘配置
export const live2dModelConfig: Live2DModelConfig = {
	// Live2D 看板娘开关
	enable: false,
	// 首次访问默认不加载模型，点击入口后再加载
	defaultVisible: false,
	// Live2D模型配置
	model: {
		// Live2D模型文件路径（支持 Cubism 2 .model.json 和 Cubism 3+ .model3.json）
		path: "/pio/models/live2d/小爱弥斯_vts/小爱弥斯.model3.json",
	},

	// 位置配置
	position: {
		// 显示位置 bottom-left，bottom-right，top-left，top-right，注意：在右下角可能会挡住返回顶部按钮
		corner: "bottom-left",
		// 距离边缘0px
		offsetX: 0,
		// 距离下边缘0px
		offsetY: 0,
	},

	// 尺寸配置
	size: {
		// 容器宽度
		width: 255,
		// 容器高度
		height: 285,
	},

	// 渲染分辨率倍率，默认自动使用 window.devicePixelRatio（上限2）
	// 在高DPI屏幕上设为2可显著提升清晰度，值越大越耗性能
	resolution: 3,

	// 交互配置
	interactive: {
		// 交互功能开关
		enabled: true,
		// 点击时随机显示的文字消息，motions 和 expressions 将从模型 JSON 文件中自动读取
		//"设计版权归属库洛,来源#B站木果阿木果"
		clickMessages: [
			"你好呀！爱弥斯给你讲个故事吧~",
			"哼，不要随便摸爱弥斯的头啦！",
			"你想听哪个故事？爱弥斯的故事书可多了！",
			"爱弥斯才不是小孩子！……才、才不是呢！",
			"一起冒险吧！爱弥斯会保护你的！……大概？",
			"呜呜，爱弥斯的雪绒豹豹不见了……你有看到吗？",
			"不要走嘛，再陪爱弥斯玩一会儿~",
			"爱弥斯今天也很乖哦，有没有奖励？",
			"雪绒豹豹说它也想跟你打招呼~喵！",
			"看我雷霆大雪绒，嘻嘻，吓到你了吧",
			"雪绒豹豹今天又在打瞌睡了，跟爸爸一样~",
			"爱弥斯和雪绒豹豹要去冒险啦！要不要一起？",
		],
		// 随机显示的文字消息显示时间（毫秒）
		messageDisplayTime: 3000,
	},

	// 作者信息
	author: {
		name: "木果阿木果",
		url: "https://www.bilibili.com/video/BV1Ts9eBkEXX",
	},
};
