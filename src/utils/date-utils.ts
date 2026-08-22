import { siteConfig } from "../config";

const localeMap: Record<string, string> = {
	zh_CN: "zh-CN",
	zh_TW: "zh-TW",
	en: "en-US",
	ja: "ja-JP",
	ko: "ko-KR",
	es: "es-ES",
	th: "th-TH",
	vi: "vi-VN",
	tr: "tr-TR",
	id: "id-ID",
	fr: "fr-FR",
	de: "de-DE",
	ru: "ru-RU",
	ar: "ar-SA",
};

export function formatDateToYYYYMMDD(date: Date): string {
	return date.toISOString().substring(0, 10);
}

// 国际化日期格式化函数
export function formatDateI18n(
	dateInput: Date | string,
	includeTime?: boolean,
	includeWeekday?: boolean,
): string {
	const date = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
	const lang = siteConfig.lang || "en";

	// 根据语言设置不同的日期格式
	const options: Intl.DateTimeFormatOptions = {
		year: "numeric",
		month: "long",
		day: "numeric",
	};

	if (includeWeekday) {
		options.weekday = "long";
	}

	if (includeTime) {
		options.hour = "2-digit";
		options.minute = "2-digit";
		options.second = "2-digit";
	}

	// 如果配置了时区，则将其用于格式化（IANA 时区字符串）
	if (siteConfig.timezone) {
		(options as Intl.DateTimeFormatOptions).timeZone = siteConfig.timezone;
	}

	// 语言代码映射
	const locale = localeMap[lang] || "en-US";
	return includeTime
		? date.toLocaleString(locale, options)
		: date.toLocaleDateString(locale, options);
}

export function formatDateI18nParts(dateInput: Date | string): string[] {
	const date = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
	const lang = siteConfig.lang || "en";
	const locale = localeMap[lang] || "en-US";

	const formatPart = (options: Intl.DateTimeFormatOptions): string => {
		if (siteConfig.timezone) {
			options.timeZone = siteConfig.timezone;
		}
		return date.toLocaleDateString(locale, options);
	};

	return [
		formatPart({ year: "numeric" }),
		formatPart({ month: "long", day: "numeric" }),
		formatPart({ weekday: "long" }),
	];
}

// 国际化日期时间格式化函数（带时分秒）
export function formatDateI18nWithTime(dateInput: Date | string): string {
	return formatDateI18n(dateInput, true);
}
