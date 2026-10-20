import type { CourseDeadline } from './types';
import { getLearningDeadlineRefreshDelay } from './learning-deadline.ts';

export function currentCalendarMonth(now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

export function isSameCalendarMonth(first: Date, second: Date) {
  return first.getFullYear() === second.getFullYear() && first.getMonth() === second.getMonth();
}

export function localDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function getCalendarDayRefreshDelay(now = new Date()) {
  const nextLocalMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return Math.max(1, nextLocalMidnight.getTime() - now.getTime());
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

export function getCalendarDeadlineRefreshDelay(items: CourseDeadline[], now = Date.now()) {
  let nextDelay: number | null = null;
  for (const item of items) {
    if (item.status !== 'upcoming' || item.completed) continue;
    const deadlineAt = new Date(item.dueAt).getTime();
    if (!Number.isFinite(deadlineAt)) continue;
    const delay = deadlineAt < now ? 0 : getLearningDeadlineRefreshDelay(item.dueAt, now);
    if (delay !== null && (nextDelay === null || delay < nextDelay)) nextDelay = delay;
  }
  return nextDelay;
}

export function markCalendarDeadlinesOverdue(items: CourseDeadline[], now = Date.now()) {
  let changed = false;
  const nextItems = items.map((item) => {
    const deadlineAt = new Date(item.dueAt).getTime();
    if (item.status !== 'upcoming' || item.completed || !Number.isFinite(deadlineAt) || deadlineAt >= now) return item;
    changed = true;
    return { ...item, status: 'overdue' as const };
  });
  return changed ? nextItems : items;
}

export function shouldShowCalendarEmptyState(loading: boolean, error: string, itemCount: number, hasInvalidDeadlines = false) {
  // A partial-data warning should not be followed by a contradictory "no deadlines" message.
  return !loading && !error && itemCount === 0 && !hasInvalidDeadlines;
}
