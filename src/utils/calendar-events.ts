import type { HolidayEntry } from "@/pages/api/holidays.json";
import type { BirthdayItem, ScheduleItem } from "@/types/config";
import {
	getLunarMonthDayChinese,
	resolveYearlyDate,
} from "@/utils/lunar-utils";

// 日历事件聚合工具
// 把 holidays（已展开） / posts / birthdays / schedules 四类原始数据
// 在客户端按显示年份展开为公历日期事件，再按 dateKey 分桶

export type EventType = "holiday" | "birthday" | "schedule" | "post";

export type CalendarEvent = {
	date: string; // "YYYY-MM-DD"
	type: EventType;
	title: string;
	note?: string;
	icon?: string;
	url?: string; // 文章链接等
	// 节日附加属性
	isOfficial?: boolean;
	isWorkday?: boolean;
	lunarDateStr?: string; // 农历副标题
	duration?: number; // 节日持续天数（含当天），默认1
};

export type EventBucket = Record<string, CalendarEvent[]>;

export type PostMeta = {
	id: string;
	title: string;
	published: number;
	category?: string;
	password?: boolean;
};

// 文章数据由 /api/allPostMeta.json 提供，结构固定
export function buildPostEvents(posts: PostMeta[]): CalendarEvent[] {
	return posts.map((post) => {
		const d = new Date(post.published);
		const dateKey = formatYmd(d);
		return {
			date: dateKey,
			type: "post" as const,
			title: post.title,
			url: `/posts/${post.id}/`,
			icon: "material-symbols:article",
		};
	});
}

// 把节日数据按年扩展（API 数据已经是公历日期，无需展开；只附加农历副标题）
export function buildHolidayEvents(holidays: HolidayEntry[]): CalendarEvent[] {
	return holidays.map((h) => {
		const [y, m, d] = h.date.split("-").map((s) => Number.parseInt(s, 10));
		const lunarStr = getLunarMonthDayChinese(y, m, d);
		return {
			date: h.date,
			type: "holiday" as const,
			title: h.name,
			icon: h.icon || "material-symbols:celebration",
			isOfficial: h.isOfficial,
			isWorkday: h.isWorkday,
			lunarDateStr: lunarStr,
			duration: h.rest && h.rest > 0 ? h.rest : 1,
		};
	});
}

// 把生日按 years[] 展开为公历日期事件
export function buildBirthdayEvents(
	birthdays: BirthdayItem[],
	years: number[],
): CalendarEvent[] {
	const out: CalendarEvent[] = [];
	for (const b of birthdays) {
		for (const y of years) {
			const date = resolveYearlyDate(b.date, y);
			if (!date) continue;
			const [yr, m, d] = date.split("-").map((s) => Number.parseInt(s, 10));
			const lunarStr =
				b.date.type === "lunar" ? getLunarMonthDayChinese(yr, m, d) : undefined;
			out.push({
				date,
				type: "birthday",
				title: b.name,
				note: b.note,
				icon: b.icon || "material-symbols:cake",
				lunarDateStr: lunarStr,
			});
		}
	}
	return out;
}

// 把安排按 years[] 展开
export function buildScheduleEvents(
	schedules: ScheduleItem[],
	years: number[],
): CalendarEvent[] {
	const out: CalendarEvent[] = [];
	for (const s of schedules) {
		// 一次性
		if (s.date) {
			const valid = /^\d{4}-\d{2}-\d{2}$/.test(s.date);
			if (valid) {
				out.push({
					date: s.date,
					type: "schedule",
					title: s.title,
					note: s.note,
					icon: s.icon || "material-symbols:event",
				});
			}
			continue;
		}

		const rec = s.recurring;
		if (!rec) continue;

		for (const y of years) {
			if (rec.freq === "yearly") {
				if (rec.month == null || rec.day == null) continue;
				const date = resolveYearlyDate(
					{
						type: rec.lunar ? "lunar" : "solar",
						month: rec.month,
						day: rec.day,
					},
					y,
				);
				if (!date) continue;
				out.push({
					date,
					type: "schedule",
					title: s.title,
					note: s.note,
					icon: s.icon || "material-symbols:event",
				});
			} else if (rec.freq === "monthly") {
				if (rec.day == null) continue;
				for (let m = 1; m <= 12; m++) {
					const date = resolveYearlyDate(
						{ type: "solar", month: m, day: rec.day },
						y,
					);
					if (!date) continue;
					out.push({
						date,
						type: "schedule",
						title: s.title,
						note: s.note,
						icon: s.icon || "material-symbols:event",
					});
				}
			} else if (rec.freq === "weekly") {
				if (rec.weekday == null) continue;
				// 找到 y 年内所有指定 weekday 的日期
				const first = new Date(y, 0, 1);
				const offset = (rec.weekday - first.getDay() + 7) % 7;
				const start = new Date(y, 0, 1 + offset);
				for (
					let cur = new Date(start);
					cur.getFullYear() === y;
					cur.setDate(cur.getDate() + 7)
				) {
					out.push({
						date: formatYmd(cur),
						type: "schedule",
						title: s.title,
						note: s.note,
						icon: s.icon || "material-symbols:event",
					});
				}
			}
		}
	}
	return out;
}

// 合并 4 类事件，按 dateKey 分桶，同日同类同名去重
export function bucketize(events: CalendarEvent[]): EventBucket {
	const bucket: EventBucket = {};
	for (const e of events) {
		if (!bucket[e.date]) bucket[e.date] = [];
		const existing = bucket[e.date];
		const dup = existing.some(
			(ex) => ex.type === e.type && ex.title === e.title,
		);
		if (!dup) existing.push(e);
	}
	// 每桶内部按类型优先级排序：holiday > birthday > schedule > post
	const order: Record<EventType, number> = {
		holiday: 0,
		birthday: 1,
		schedule: 2,
		post: 3,
	};
	for (const key of Object.keys(bucket)) {
		bucket[key].sort((a, b) => order[a.type] - order[b.type]);
	}
	return bucket;
}

// 按类型取最近的事件（含今天及未来，不限天数），每种类型最多 maxPerType 条
export function getNearestByType(
	bucket: EventBucket,
	today: Date,
	type: EventType,
	maxPerType: number,
): CalendarEvent[] {
	const todayKey = formatYmd(today);
	const keys = Object.keys(bucket)
		.filter((k) => k >= todayKey)
		.sort();
	const out: CalendarEvent[] = [];
	for (const k of keys) {
		for (const e of bucket[k]) {
			if (e.type === type) {
				out.push(e);
				if (out.length >= maxPerType) return out;
			}
		}
	}
	return out;
}

// 工具：日期 → "YYYY-MM-DD"
export function formatYmd(d: Date): string {
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
		d.getDate(),
	).padStart(2, "0")}`;
}
