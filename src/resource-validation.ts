import { validateLessonResourceUrl } from '../shared/resource-url-validation.js';

export function lessonResourceUrlError(value: string): string | null {
  return validateLessonResourceUrl(value).error;
}
