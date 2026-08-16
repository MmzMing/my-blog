<script lang="ts">
import { onMount } from "svelte";
import I18nKey from "@/i18n/i18nKey";
import { i18n } from "@/i18n/translation";
import type { HolidayEntry } from "@/pages/api/holidays.json";
import type { BirthdayItem, ScheduleItem } from "@/types/config";
import {
	bucketize,
	buildBirthdayEvents,
	buildHolidayEvents,
	buildPostEvents,
	buildScheduleEvents,
	type CalendarEvent,
	type EventBucket,
	type EventType,
	formatYmd,
	getNearestByType,
	type PostMeta,
} from "@/utils/calendar-events";
import { navigateToPage } from "@/utils/navigation-utils";
import { eventTypeMeta } from "./eventTypes";

interface Props {
	holidays?: HolidayEntry[];
	posts?: PostMeta[];
	birthdays?: BirthdayItem[];
	schedules?: ScheduleItem[];
	years?: number[];
	futureDays?: number;
	maxItems?: number;
	showPosts?: boolean;
}

let {
	holidays = [],
	posts = [],
	birthdays = [],
	schedules = [],
	years = [],
	futureDays = 30,
	maxItems = 6,
	showPosts = true,
}: Props = $props();

const todayDate = new Date();

const allEvents = $derived.by<CalendarEvent[]>(() => {
	const list: CalendarEvent[] = [];
	list.push(...buildHolidayEvents(holidays));
	list.push(...buildBirthdayEvents(birthdays, years));
	list.push(...buildScheduleEvents(schedules, years));
	if (showPosts) list.push(...buildPostEvents(posts));
	return list;
});

const bucket = $derived<EventBucket>(bucketize(allEvents));

// 按类型取最近事件（不限天数，各取最多2条）
// 节日/生日同标题去重（避免假期跨天重复），安排不去重（同名不同日期算不同安排）
function getNearestByTypeDeduped(
	bucket: EventBucket,
	today: Date,
	type: EventType,
	maxPerType: number,
): CalendarEvent[] {
	const raw = getNearestByType(bucket, today, type, maxPerType * 3);
	const seen = new Set<string>();
	const out: CalendarEvent[] = [];
	for (const ev of raw) {
		// 安排不去重，用标题+日期作为唯一键；其他类型按标题去重
		const key =
			type === "schedule"
				? `${ev.type}-${ev.title}-${ev.date}`
				: `${ev.type}-${ev.title}`;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(ev);
		if (out.length >= maxPerType) break;
	}
	return out;
}

const nearestHolidays = $derived(
	getNearestByTypeDeduped(bucket, todayDate, "holiday", 2),
);
const nearestBirthdays = $derived(
	getNearestByTypeDeduped(bucket, todayDate, "birthday", 2),
);
const nearestSchedules = $derived(
	getNearestByTypeDeduped(bucket, todayDate, "schedule", 2),
);

type SectionConfig = {
	type: EventType;
	labelKey: I18nKey;
	items: CalendarEvent[];
};

const sections = $derived<SectionConfig[]>([
	{
		type: "holiday",
		labelKey: I18nKey.calendarNearestHoliday,
		items: nearestHolidays,
	},
	{
		type: "birthday",
		labelKey: I18nKey.calendarNearestBirthday,
		items: nearestBirthdays,
	},
	{
		type: "schedule",
		labelKey: I18nKey.calendarNearestSchedule,
		items: nearestSchedules,
	},
]);

function getCountdown(targetDate: string): {
	days: number;
	hours: number;
	minutes: number;
	seconds: number;
} {
	const [y, m, d] = targetDate.split("-").map((s) => Number.parseInt(s, 10));
	const target = new Date(y, m - 1, d, 0, 0, 0);
	const now = new Date();
	const diff = target.getTime() - now.getTime();
	if (diff <= 0) return { days: 0, hours: 0, minutes: 0, seconds: 0 };
	const days = Math.floor(diff / 86400000);
	const hours = Math.floor((diff % 86400000) / 3600000);
	const minutes = Math.floor((diff % 3600000) / 60000);
	const seconds = Math.floor((diff % 60000) / 1000);
	return { days, hours, minutes, seconds };
}

// 获取事件结束倒计时（如果事件正在进行中）
// 节日支持 duration 持续天数，生日/安排默认为1天
function getEventEndCountdown(ev: CalendarEvent): {
	days: number;
	hours: number;
	minutes: number;
	seconds: number;
	isOngoing: boolean;
} {
	const duration = ev.duration || 1;
	const [y, m, d] = ev.date.split("-").map((s) => Number.parseInt(s, 10));
	const start = new Date(y, m - 1, d, 0, 0, 0);
	// 结束日期：开始日期 + duration - 1 天的最后一秒
	const end = new Date(y, m - 1, d + duration - 1, 23, 59, 59);
	const now = new Date();

	// 检查是否正在进行中（今天 >= 开始日期 且 今天 <= 结束日期）
	const todayKey = formatYmd(now);
	const startKey = formatYmd(start);
	const endKey = formatYmd(end);

	if (todayKey >= startKey && todayKey <= endKey) {
		const diff = end.getTime() - now.getTime();
		if (diff <= 0)
			return { days: 0, hours: 0, minutes: 0, seconds: 0, isOngoing: true };
		const days = Math.floor(diff / 86400000);
		const hours = Math.floor((diff % 86400000) / 3600000);
		const minutes = Math.floor((diff % 3600000) / 60000);
		const seconds = Math.floor((diff % 60000) / 1000);
		return { days, hours, minutes, seconds, isOngoing: true };
	}

	// 未开始，返回正常倒计时
	const cd = getCountdown(ev.date);
	return { ...cd, isOngoing: false };
}

let countdowns = $state<
	Record<
		string,
		{
			days: number;
			hours: number;
			minutes: number;
			seconds: number;
			isOngoing: boolean;
		}
	>
>({});

let countdownInterval: ReturnType<typeof setInterval>;

function updateCountdowns() {
	const next: Record<
		string,
		{
			days: number;
			hours: number;
			minutes: number;
			seconds: number;
			isOngoing: boolean;
		}
	> = {};
	for (const sec of sections) {
		for (const ev of sec.items) {
			next[`${ev.title}-${ev.date}`] = getEventEndCountdown(ev);
		}
	}
	countdowns = next;
}

onMount(() => {
	updateCountdowns();
	countdownInterval = setInterval(updateCountdowns, 1000);
	return () => {
		clearInterval(countdownInterval);
	};
});

function selectDate(dateKey: string) {
	window.dispatchEvent(
		new CustomEvent("calendar:select-date", { detail: dateKey }),
	);
}

function openPostOrSelect(ev: CalendarEvent) {
	if (ev.url) {
		navigateToPage(ev.url);
		return;
	}
	selectDate(ev.date);
}
</script>

<section class="event-overview">
	{#each sections as sec (sec.type)}
		{@const meta = eventTypeMeta[sec.type]}
		<div class="mb-5 last:mb-0">
			<div
				class="flex items-center gap-2 mb-3 text-xs font-medium uppercase tracking-wider text-neutral-500 dark:text-neutral-400"
			>
				<span class="w-1 h-3 {meta.barClass} rounded-full"></span>
				{i18n(sec.labelKey)}
			</div>

			{#if sec.items.length === 0}
				<p class="text-sm text-neutral-400 dark:text-neutral-500 py-2">
					{i18n(I18nKey.calendarNoEvents)}
				</p>
			{:else}
				<div class="nearest-grid">
					{#each sec.items as ev (ev.title + ev.date + ev.type)}
						{@const cd = countdowns[`${ev.title}-${ev.date}`] ?? { days: 0, hours: 0, minutes: 0, seconds: 0, isOngoing: false }}
						<button
							type="button"
							class="nearest-card group relative text-left px-4 py-3 hover:shadow-md transition-all
								{cd.isOngoing ? 'event-ongoing' : ''}"
							onclick={() => openPostOrSelect(ev)}
						>
							<!-- 第一层：事件类型 -->
							<div class="text-xs font-bold text-neutral-900 dark:text-neutral-100 mb-1">
								{i18n(meta.labelKey)}
							</div>
							<!-- 第二层：事件名称 -->
							<div class="text-sm font-semibold text-neutral-800 dark:text-neutral-200 truncate mb-1.5">
								{ev.title}
							</div>
							<!-- 第三层：倒计时 -->
							<div class="text-xs text-neutral-500 dark:text-neutral-400">
								{#if cd.isOngoing}
									<span>{i18n(I18nKey.countdownTo)}</span>
									<span class="font-medium text-neutral-700 dark:text-neutral-300">{ev.title}</span>
									<span>{i18n(I18nKey.countdownEndIn)}</span>
								{:else}
									<span>{i18n(I18nKey.countdownTo)}</span>
									<span class="font-medium text-neutral-700 dark:text-neutral-300">{ev.title}</span>
									<span>{i18n(I18nKey.countdownIn)}</span>
								{/if}
								<span class="font-bold text-neutral-900 dark:text-neutral-100 tabular-nums">
									{cd.days}<span class="font-normal text-neutral-500 dark:text-neutral-400">{i18n(I18nKey.dayShort)}</span>
									{cd.hours}<span class="font-normal text-neutral-500 dark:text-neutral-400">{i18n(I18nKey.hour)}</span>
									{cd.minutes}<span class="font-normal text-neutral-500 dark:text-neutral-400">{i18n(I18nKey.minute)}</span>
									{cd.seconds}<span class="font-normal text-neutral-500 dark:text-neutral-400">{i18n(I18nKey.second)}</span>
								</span>
							</div>
						</button>
					{/each}
				</div>
			{/if}
		</div>
	{/each}
</section>
