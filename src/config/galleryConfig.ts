import type { GalleryConfig } from "@/types/config";

// 相册配置
export const galleryConfig: GalleryConfig = {
	// 相册列表
	albums: [
		// 支持jpg/png/webp/avif/gif格式
		// id: 相册唯一标识符（用于目录命名和URL路径），比如设置：id: "firefly-2026", 对应 public/gallery/firefly-2026/目录
		// cover: 手动指定封面图（可选，不填会把cover.*文件作为封面图，如果没有cover.*文件，则使用第一张图片作为封面图）
		// name: 相册名称
		// description: 相册描述
		// location: 相册拍摄地点
		// date: 相册日期，格式为 YYYY-MM-DD，用于排序和显示
		// tags: 相册标签，用于分类和过滤
		// 每添加一个数组项就相当于添加了一个相册，记得在 public/gallery/ 目录下创建对应的子目录并放入图片
		{
			id: "gpt-img2-2026",
			name: "GPT生图",
			description: "Image 2 生成的图片",
			location: "gpt",
			date: "2026-05-24",
			tags: ["AI", "GPT生图"],
		},
	],

	// 瀑布流最小列宽(px)，浏览器根据容器宽度自动计算列数，默认 240
	// 值越小列数越多，值越大列数越少
	columnWidth: 240,

	// 网络相册配置
	networkAlbum: {
		// 网络相册 API 地址
		apiUrl: "https://t.alcy.cc",
		// 单次获取图片数量限制，默认 10
		maxQuantity: 10,
		// 默认获取数量，默认 6
		defaultQuantity: 6,
	},
};
