import { parseApiTimestamp } from './api-timestamp.ts';

const learningDeadlineDateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});
const learningDeadlineDayFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
});

export type LearningDeadlineStatus = 'completed' | 'overdue' | 'upcoming' | 'unknown';

const maximumBrowserTimeout = 2_147_483_647;

export function formatLearningDeadlineDate(value: string) {
  const date = parseApiTimestamp(value);
  // Keep one malformed legacy record from crashing the whole My learning page.
  return Number.isFinite(date.getTime()) ? learningDeadlineDateFormatter.format(date) : 'Date unavailable';
}

export function formatLearningDeadlineDay(value: string) {
  const date = parseApiTimestamp(value);
  // Learning-path cards can contain the same legacy deadline data as My learning.
  return Number.isFinite(date.getTime()) ? learningDeadlineDayFormatter.format(date) : 'Date unavailable';
}

export function getLearningDeadlineStatus(value: string, completed: boolean, now = Date.now()): LearningDeadlineStatus {
  if (completed) return 'completed';
  const deadlineAt = parseApiTimestamp(value).getTime();
  if (!Number.isFinite(deadlineAt)) return 'unknown';
  return deadlineAt < now ? 'overdue' : 'upcoming';
}

export function getLearningDeadlineRefreshDelay(value: string, now = Date.now()) {
  const deadlineAt = parseApiTimestamp(value).getTime();
  if (!Number.isFinite(deadlineAt) || deadlineAt < now) return null;

  // Browser timers cap at a signed 32-bit delay; wake again for longer deadlines.
  return Math.min(deadlineAt - now + 1, maximumBrowserTimeout);
}
