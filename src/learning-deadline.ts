import { parseApiTimestamp } from './api-timestamp.ts';

const learningDeadlineDateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export type LearningDeadlineStatus = 'completed' | 'overdue' | 'upcoming';

const maximumBrowserTimeout = 2_147_483_647;

export function formatLearningDeadlineDate(value: string) {
  return learningDeadlineDateFormatter.format(parseApiTimestamp(value));
}

export function getLearningDeadlineStatus(value: string, completed: boolean, now = Date.now()): LearningDeadlineStatus {
  if (completed) return 'completed';
  return parseApiTimestamp(value).getTime() < now ? 'overdue' : 'upcoming';
}

export function getLearningDeadlineRefreshDelay(value: string, now = Date.now()) {
  const deadlineAt = parseApiTimestamp(value).getTime();
  if (!Number.isFinite(deadlineAt) || deadlineAt < now) return null;

  // Browser timers cap at a signed 32-bit delay; wake again for longer deadlines.
  return Math.min(deadlineAt - now + 1, maximumBrowserTimeout);
}
