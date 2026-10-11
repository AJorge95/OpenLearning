export const COMPLETION_WINDOW_ERROR = 'Completion time must be between 1 and 3,650 days, or left blank.';

export function validateCompletionWindowDays(rawValue: string): { value: number | null; error: string | null } {
  const value = rawValue.trim();
  if (!value) return { value: null, error: null };

  const days = Number(value);
  if (!Number.isSafeInteger(days) || days < 1 || days > 3650) {
    return { value: null, error: COMPLETION_WINDOW_ERROR };
  }

  return { value: days, error: null };
}
