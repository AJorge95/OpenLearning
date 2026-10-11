export type LessonResourceUrlValidation =
  | { url: URL; error: null }
  | { url: null; error: string };

export function validateLessonResourceUrl(value: string): LessonResourceUrlValidation;
