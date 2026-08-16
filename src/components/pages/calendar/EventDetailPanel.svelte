<script lang="ts">
import { onDestroy, onMount } from "svelte";
import Icon from "@/components/common/Icon.svelte";
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
	formatYmd,
	type PostMeta,
} from "@/utils/calendar-events";
import { getLunarMonthDayChinese } from "@/utils/lunar-utils";
import { navigateToPage } from "@/utils/navigation-utils";
import { eventTypeMeta } from "./eventTypes";

interface Props {
	holidays?: HolidayEntry[];
	posts?: PostMeta[];
	birthdays?: BirthdayItem[];
	schedules?: ScheduleItem[];
	years?: number[];
	showPosts?: boolean;
}

let {
	holidays = [],
	posts = [],
	birthdays = [],
	schedules = [],
	years = [],
	showPosts = true,
}: Props = $props();

const today = new Date();
const todayKey = formatYmd(today);

let selectedDateKey = $state(todayKey);

const bucket = $derived.by<EventBucket>(() => {
	const list: CalendarEvent[] = [];
	list.push(...buildHolidayEvents(holidays));
	list.push(...buildBirthdayEvents(birthdays, years));
	list.push(...buildScheduleEvents(schedules, years));
	if (showPosts) list.push(...buildPostEvents(posts));
	return bucketize(list);
});

const dayEvents = $derived<CalendarEvent[]>(bucket[selectedDateKey] || []);

const displayDate = $derived.by(() => {
	const [y, m, d] = selectedDateKey
		.split("-")
		.map((s) => Number.parseInt(s, 10));
	if (Number.isNaN(y)) return { dateStr: "", weekday: "", lunar: "" };
	const date = new Date(y, m - 1, d);
	const weekdayKeys = [
		I18nKey.calendarSunday,
		I18nKey.calendarMonday,
		I18nKey.calendarTuesday,
		I18nKey.calendarWednesday,
		I18nKey.calendarThursday,
		I18nKey.calendarFriday,
		I18nKey.calendarSaturday,
	];
	const monthKeys = [
		I18nKey.calendarJanuary,
		I18nKey.calendarFebruary,
		I18nKey.calendarMarch,
		I18nKey.calendarApril,
		I18nKey.calendarMay,
		I18nKey.calendarJune,
		I18nKey.calendarJuly,
		I18nKey.calendarAugust,
		I18nKey.calendarSeptember,
		I18nKey.calendarOctober,
		I18nKey.calendarNovember,
		I18nKey.calendarDecember,
	];
	const dateStr = `${y}${i18n(I18nKey.year)} ${i18n(monthKeys[m - 1])} ${d}${i18n(
		I18nKey.day,
	)}`;
	const weekday = i18n(weekdayKeys[date.getDay()]);
	const lunar = getLunarMonthDayChinese(y, m, d);
	return { dateStr, weekday, lunar };
});

function handleSelected(e: Event) {
	const ce = e as CustomEvent<string>;
	if (ce.detail) selectedDateKey = ce.detail;
}

function openEvent(ev: CalendarEvent) {
	if (ev.url) navigateToPage(ev.url);
}

onMount(() => {
	window.addEventListener("calendar:selected", handleSelected);
});

onDestroy(() => {
	if (typeof window === "undefined") return;
	window.removeEventListener("calendar:selected", handleSelected);
});
</script>

<section class="detail-panel">
	<!-- 日期标题 -->
	<header class="flex items-center justify-between mb-4 pb-3 border-b-2 border-black dark:border-white">
		<div>
			<div class="text-xl font-bold text-neutral-900 dark:text-neutral-100">
				{displayDate.dateStr}
			</div>
			<div class="flex items-center gap-2 mt-1 text-xs text-neutral-500 dark:text-neutral-400">
				<span>{displayDate.weekday}</span>
				{#if displayDate.lunar}
					<span class="text-neutral-400 dark:text-neutral-500">·</span>
					<span>{displayDate.lunar}</span>
				{/if}
				{#if selectedDateKey === todayKey}
					<span class="text-neutral-400 dark:text-neutral-500">·</span>
					<span
						class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
					>
						{i18n(I18nKey.calendarToday)}
					</span>
				{/if}
			</div>
		</div>
		<div class="text-xs text-neutral-400 dark:text-neutral-500">
			{dayEvents.length}
		</div>
	</header>

	<!-- 事件卡片列表 -->
	{#if dayEvents.length === 0}
		<div class="empty">
			<Icon icon="material-symbols:event-busy" class="text-2xl text-neutral-300 dark:text-neutral-700" />
			<p class="text-sm text-neutral-400 dark:text-neutral-500 mt-2">
				{i18n(I18nKey.calendarNoEvents)}
			</p>
		</div>
	{:else}
		<ul class="flex flex-col gap-2">
			{#each dayEvents as ev (ev.title + ev.type + ev.date)}
				{@const meta = eventTypeMeta[ev.type]}
				{@const clickable = !!ev.url}
				<li>
					<svelte:element
						this={clickable ? "button" : "div"}
						type={clickable ? "button" : undefined}
						class="event-card group {clickable ? 'is-clickable' : ''}"
						onclick={clickable ? () => openEvent(ev) : undefined}
					>
						<!-- 左侧色条 -->
						<span class="card-bar {meta.barClass}"></span>

						<!-- 图标 -->
						<div class="card-icon">
							<Icon icon={ev.icon || meta.icon} class="text-lg text-neutral-700 dark:text-neutral-300" />
						</div>

						<!-- 主内容 -->
						<div class="flex-1 min-w-0">
							<div class="flex items-center gap-2 flex-wrap">
								<span class="text-sm font-semibold text-neutral-900 dark:text-neutral-100 truncate">
									{ev.title}
								</span>
								<span class="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded {meta.chipClass}">
									{i18n(meta.labelKey)}
								</span>
								{#if ev.isOfficial}
									<span class="inline-flex items-center text-[10px] px-1.5 py-0.5 rounded bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400">
										{i18n(I18nKey.officialHolidayBadge)}
									</span>
								{/if}
								{#if ev.isWorkday}
									<span class="inline-flex items-center text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
										{i18n(I18nKey.makeupWorkdayBadge)}
									</span>
								{/if}
							</div>
							{#if ev.note}
								<div class="text-xs text-neutral-500 dark:text-neutral-400 mt-1 line-clamp-2">
									{ev.note}
								</div>
							{/if}
							{#if ev.lunarDateStr}
								<div class="text-[11px] text-neutral-400 dark:text-neutral-500 mt-1">
									{i18n(I18nKey.calendarLunar)} · {ev.lunarDateStr}
								</div>
							{/if}
						</div>

						<!-- 链接箭头 -->
						{#if clickable}
							<div class="card-arrow opacity-0 group-hover:opacity-100 transition-opacity">
								<Icon icon="material-symbols:arrow-forward" class="text-sm text-neutral-500" />
							</div>
						{/if}
					</svelte:element>
				</li>
			{/each}
		</ul>
	{/if}
</section>
