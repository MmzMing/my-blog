import type { BirthdayItem } from "@/types/config";
import { resolveYearlyDate } from "@/utils/lunar-utils";

// 日历小组件共用的日期事件工具。
export type CalendarEventType = "birthday";

export type CalendarEvent = {
	date: string;
	type: CalendarEventType;
	title: string;
	note?: string;
	icon?: string;
};

export type PostMeta = {
	id: string;
	title: string;
	published: number;
	category?: string;
	password?: boolean;
};

// 把生日 / 纪念日按年份展开为公历日期事件，农历日期在构建时转换。
export function buildBirthdayEvents(
	birthdays: BirthdayItem[],
	years: number[],
): CalendarEvent[] {
	const events: CalendarEvent[] = [];
	for (const birthday of birthdays) {
		for (const year of years) {
			const date = resolveYearlyDate(birthday.date, year);
			if (!date) continue;
			events.push({
				date,
				type: "birthday",
				title: birthday.name,
				note: birthday.note,
				icon: birthday.icon || "material-symbols:cake",
			});
		}
	}
	return events.sort((a, b) => a.date.localeCompare(b.date));
}

export function formatYmd(date: Date): string {
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
		date.getDate(),
	).padStart(2, "0")}`;
}
