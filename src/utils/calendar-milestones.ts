/**
 * 日历里程碑计算：从「按年重复的事件序列」推算下一个事件及其周期进度。
 *
 * 从旧 CalendarManager.astro 的内联脚本提炼而来：旧日历（悬浮坞 / 移动坞）
 * 已由导航 Logo 资料卡替代，但右侧的最近节日、建站日进度条仍依赖同一套
 * 算法——输入按日期升序的事件序列，取 today 之后最近的一次，并以「上一次
 * 同名事件」为起点计算周期进度百分比与剩余天数。纯函数无副作用，构建期
 * 与客户端都可使用。
 */

/** 日期 key（YYYY-MM-DD）转 UTC 时间戳：统一用 UTC 求差，避免时区偏移影响天数 */
function dateStamp(dateKey: string): number {
	const [year, month, day] = dateKey.split("-").map(Number);
	return Date.UTC(year, month - 1, day);
}

function daysBetween(fromKey: string, toKey: string): number {
	return Math.round((dateStamp(toKey) - dateStamp(fromKey)) / 86400000);
}

/** 找不到同名事件的「上一次」时，按月日回退一年兜底（月末溢出自动收敛） */
function shiftYear(dateKey: string, offset: number): string {
	const [year, month, day] = dateKey.split("-").map(Number);
	const shiftedYear = year + offset;
	const shiftedDay = Math.min(day, new Date(shiftedYear, month, 0).getDate());
	return `${shiftedYear}-${String(month).padStart(2, "0")}-${String(shiftedDay).padStart(2, "0")}`;
}

export interface YearlyEventInput {
	/** 日期 key，格式 YYYY-MM-DD */
	date: string;
	name: string;
	/** 调休补班日，不算节日 */
	isWorkday?: boolean;
}

export interface MilestoneOccurrence {
	title: string;
	/** 日期 key，格式 YYYY-MM-DD */
	date: string;
}

export interface Milestone {
	title: string;
	/** 下一次事件的日期 key，格式 YYYY-MM-DD */
	date: string;
	/** 相对上一次同周期事件的进度百分比（0-100） */
	progress: number;
	/** 距下一次事件的剩余天数 */
	remainingDays: number;
}

/** 日期 key 格式化为 YYYY-MM-DD（本地时区） */
export function formatYmd(date: Date): string {
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
		date.getDate(),
	).padStart(2, "0")}`;
}

/**
 * 节日序列 → 事件序列：剔除补班日，多天假期（日期间隔 ≤1 天的同名条目）
 * 合并为单次事件，供里程碑计算使用。
 */
export function getHolidayOccurrences(
	holidays: YearlyEventInput[],
): MilestoneOccurrence[] {
	const sorted = holidays
		.filter((item) => item.date && item.name && !item.isWorkday)
		.slice()
		.sort((a, b) => a.date.localeCompare(b.date));

	const occurrences: (MilestoneOccurrence & { endDate: string })[] = [];
	for (const item of sorted) {
		const previous = occurrences[occurrences.length - 1];
		if (
			previous &&
			previous.title === item.name &&
			daysBetween(previous.endDate, item.date) <= 1
		) {
			if (item.date > previous.endDate) previous.endDate = item.date;
			continue;
		}
		occurrences.push({ title: item.name, date: item.date, endDate: item.date });
	}
	return occurrences;
}

/**
 * 事件序列 → 下一个里程碑。找不到 today 之后的事件时返回 null（调用方据此
 * 展示空态文案）。进度 = 上一次同名事件到下一次之间，today 走过的比例。
 */
export function milestoneFromOccurrences(
	occurrences: MilestoneOccurrence[],
	todayKey: string,
): Milestone | null {
	const sorted = occurrences
		.slice()
		.sort((a, b) => a.date.localeCompare(b.date));
	const next = sorted.find((item) => item.date >= todayKey);
	if (!next) return null;

	const previous = sorted
		.filter((item) => item.title === next.title && item.date < next.date)
		.pop();
	const previousDate = previous ? previous.date : shiftYear(next.date, -1);
	const totalDays = Math.max(1, daysBetween(previousDate, next.date));
	const elapsedDays = Math.min(
		totalDays,
		Math.max(0, daysBetween(previousDate, todayKey)),
	);

	return {
		title: next.title,
		date: next.date,
		progress: Math.round((elapsedDays / totalDays) * 100),
		remainingDays: Math.max(0, daysBetween(todayKey, next.date)),
	};
}
