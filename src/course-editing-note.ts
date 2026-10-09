import type { Course } from './types';

export function courseEditingNote(status: Course['status'], visibility: Course['visibility']) {
  if (status === 'published') {
    return visibility === 'private'
      ? 'Changes you save to this published course are visible right away to learners with course access.'
      : 'Changes you save to this published course are visible right away to learners.';
  }
  if (status === 'archived') {
    return 'This course is archived and hidden from learners. Save it as a draft or publish it to make it available again.';
  }
  return 'This draft is hidden from learners until you publish it.';
}
