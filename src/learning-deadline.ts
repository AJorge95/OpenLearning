const learningDeadlineDateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export type LearningDeadlineStatus = 'completed' | 'overdue' | 'upcoming';

export function formatLearningDeadlineDate(value: string) {
  return learningDeadlineDateFormatter.format(new Date(value));
}

export function getLearningDeadlineStatus(value: string, completed: boolean, now = Date.now()): LearningDeadlineStatus {
  if (completed) return 'completed';
  return new Date(value).getTime() < now ? 'overdue' : 'upcoming';
}
