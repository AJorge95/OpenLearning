import type { CourseDeadline } from './types';

export function currentCalendarMonth(now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

export function isSameCalendarMonth(first: Date, second: Date) {
  return first.getFullYear() === second.getFullYear() && first.getMonth() === second.getMonth();
}

export function localDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function calendarMonthRequestRange(year: number, monthIndex: number) {
  return {
    from: localDateKey(new Date(year, monthIndex, 0)),
    to: localDateKey(new Date(year, monthIndex + 1, 1)),
  };
}

export function groupCalendarDeadlines(items: CourseDeadline[], year: number, monthIndex: number) {
  const monthItems: CourseDeadline[] = [];
  const itemsByLocalDay = new Map<string, CourseDeadline[]>();
  for (const item of items) {
    const dueAt = new Date(item.dueAt);
    if (dueAt.getFullYear() !== year || dueAt.getMonth() !== monthIndex) continue;
    const key = localDateKey(dueAt);
    const dayItems = itemsByLocalDay.get(key);
    if (dayItems) dayItems.push(item);
    else itemsByLocalDay.set(key, [item]);
    monthItems.push(item);
  }
  return { monthItems, itemsByLocalDay };
}

export function shouldShowCalendarEmptyState(loading: boolean, error: string, itemCount: number) {
  return !loading && !error && itemCount === 0;
}
