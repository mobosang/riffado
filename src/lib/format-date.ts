import {
    differenceInDays,
    format,
    formatDistanceToNow,
    isSameDay,
    isThisYear,
    isToday,
    isYesterday,
} from "date-fns";
import { enUS, zhCN } from "date-fns/locale";
import { createUiText, type UiLocale } from "@/lib/i18n";
import type { DateTimeFormat } from "@/types/common";

export type { DateTimeFormat };

export function formatDateTime(
    date: Date | string,
    formatType: DateTimeFormat = "relative",
    locale: UiLocale = "en",
): string {
    const dateObj = typeof date === "string" ? new Date(date) : date;

    switch (formatType) {
        case "relative":
            return formatDistanceToNow(dateObj, {
                addSuffix: true,
                locale: locale === "zh-CN" ? zhCN : enUS,
            });
        case "absolute":
            return format(
                dateObj,
                locale === "zh-CN"
                    ? "yyyy年M月d日 HH:mm"
                    : "MMM d, yyyy h:mm a",
                { locale: locale === "zh-CN" ? zhCN : enUS },
            );
        case "iso":
            return dateObj.toISOString();
        default:
            return formatDistanceToNow(dateObj, {
                addSuffix: true,
                locale: locale === "zh-CN" ? zhCN : enUS,
            });
    }
}

/** Absolute local date and start–end time for a recording. */
export function formatRecordingDateTimeRange(
    start: Date | string,
    durationMs: number,
    locale: UiLocale = "en",
): string {
    const startDate = typeof start === "string" ? new Date(start) : start;
    const endDate = new Date(startDate.getTime() + durationMs);

    if (locale === "zh-CN") {
        return `${format(startDate, "yyyy年M月d日 · HH:mm")}–${format(endDate, isSameDay(startDate, endDate) ? "HH:mm" : "yyyy年M月d日 · HH:mm")}`;
    }
    if (isSameDay(startDate, endDate)) {
        return `${format(startDate, "MMM d, yyyy · h:mm a")}–${format(endDate, "h:mm a")}`;
    }

    return `${format(startDate, "MMM d, yyyy · h:mm a")}–${format(endDate, "MMM d, yyyy · h:mm a")}`;
}

/** Recording-list group label: Today / Yesterday / This week / month / Month YYYY. */
export function dateGroupLabel(
    date: Date | string,
    locale: UiLocale = "en",
): string {
    const uiText = createUiText(locale);
    const d = typeof date === "string" ? new Date(date) : date;
    if (isToday(d)) return uiText("Today");
    if (isYesterday(d)) return uiText("Yesterday");
    const now = new Date();
    const days = differenceInDays(now, d);
    if (days >= 0 && days < 7) return uiText("This week");
    if (
        d.getMonth() === now.getMonth() &&
        d.getFullYear() === now.getFullYear()
    ) {
        return uiText("Earlier this month");
    }
    return isThisYear(d)
        ? format(d, locale === "zh-CN" ? "M月" : "MMMM", {
              locale: locale === "zh-CN" ? zhCN : enUS,
          })
        : format(d, locale === "zh-CN" ? "yyyy年M月" : "MMMM yyyy", {
              locale: locale === "zh-CN" ? zhCN : enUS,
          });
}
