export const COMPLETION_WINDOW_ERROR = 'Completion time must be between 1 and 3,650 days, or left blank.';
export const MAX_COURSE_TITLE_LENGTH = 160;
export const COURSE_TITLE_REQUIRED_ERROR = 'Course title is required.';
export const COURSE_TITLE_TOO_LONG_ERROR = `Course title must be ${MAX_COURSE_TITLE_LENGTH} characters or fewer.`;

export function validateCourseTitle(rawValue: string): { value: string; error: null } | { value: null; error: string } {
  // Match the server's trim-before-limit rule so toolbar and curriculum saves can preflight the title consistently.
  const value = rawValue.trim();
  if (!value) return { value: null, error: COURSE_TITLE_REQUIRED_ERROR };
  if (value.length > MAX_COURSE_TITLE_LENGTH) return { value: null, error: COURSE_TITLE_TOO_LONG_ERROR };
  return { value, error: null };
}

export function validateCompletionWindowDays(rawValue: string): { value: number | null; error: string | null } {
  const value = rawValue.trim();
  if (!value) return { value: null, error: null };

  const days = Number(value);
  if (!Number.isSafeInteger(days) || days < 1 || days > 3650) {
    return { value: null, error: COMPLETION_WINDOW_ERROR };
  }

  return { value: days, error: null };
}
