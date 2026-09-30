import { normalizeDisplayLocale, type DisplayLocale } from "./runtime";

export function formatDisplayNumber(value: number, locale: DisplayLocale, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(normalizeDisplayLocale(locale), options).format(value);
}

export function formatDisplayDate(value: Date | number | string, locale: DisplayLocale, options?: Intl.DateTimeFormatOptions): string {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat(normalizeDisplayLocale(locale), options).format(date);
}
