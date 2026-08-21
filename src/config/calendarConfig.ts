import type { CalendarConfig } from "../types/config";

// 日历小组件配置
// 节日数据来源：timor.tech API（构建时拉取）+ builtinHolidays 内置补充
// 生日 / 纪念日支持公历或农历（农历需 type: "lunar"，会自动换算为当年公历日期）
const calendarBuildYear = new Date().getFullYear();

export const calendarConfig: CalendarConfig = {
	// 节日 API（构建时拉取并缓存，运行时无网络依赖）
	holidayApi: {
		// 是否启用 API 拉取
		enable: true,
		// timor.tech 中国法定节假日 API（含调休、补班）
		url: "https://timor.tech/api/holiday/year/",
		// 拉取失败时是否仅用 builtinHolidays 兜底
		fallbackOnError: true,
		// 覆盖上一年、当年、下一年，供周年进度和下一次事件计算使用
		years: [calendarBuildYear - 1, calendarBuildYear, calendarBuildYear + 1],
	},

	// 内置补充节日 — 用于补 API 不覆盖的项（农历传统节日、节气、私人纪念日等）
	// type:"solar" 公历月日，type:"lunar" 农历月日，每年自动渲染
	builtinHolidays: [
		{
			name: "春节",
			date: { type: "lunar", month: 1, day: 1 },
			icon: "material-symbols:festival",
		},
		{
			name: "元宵节",
			date: { type: "lunar", month: 1, day: 15 },
			icon: "material-symbols:lightbulb",
		},
		{
			name: "端午节",
			date: { type: "lunar", month: 5, day: 5 },
			icon: "material-symbols:rowing",
		},
		{
			name: "七夕",
			date: { type: "lunar", month: 7, day: 7 },
			icon: "material-symbols:favorite",
		},
		{
			name: "中秋节",
			date: { type: "lunar", month: 8, day: 15 },
			icon: "material-symbols:nightlight",
		},
		{
			name: "重阳节",
			date: { type: "lunar", month: 9, day: 9 },
			icon: "material-symbols:hiking",
		},
		{
			name: "腊八节",
			date: { type: "lunar", month: 12, day: 8 },
			icon: "material-symbols:soup-kitchen",
		},
	],

	// 生日 / 纪念日 — 按年重复
	birthdays: [
		{
			name: "我的生日",
			date: { type: "solar", month: 7, day: 10 },
			icon: "material-symbols:cake",
			note: "又长大一岁",
		},
		{
			name: "建站日",
			date: { type: "solar", month: 5, day: 7 },
			icon: "material-symbols:rocket-launch",
			note: "MmzMing的博客上线纪念日",
		},
	],
};
