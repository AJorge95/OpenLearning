import type { Course } from './types';

export function courseEditingNote(status: Course['status'], visibility: Course['visibility']) {
  if (status === 'published') {
    return visibility === 'private'
      ? 'Learners with access continue to see the current published version while you work on a revision. Publish it when it is ready.'
      : 'Learners continue to see the current published version while you work on a revision. Publish it when it is ready.';
  }
  if (status === 'archived') {
    return 'This course is archived and hidden from learners. Save it as a draft or publish it to make it available again.';
  }
  return 'This draft is hidden from learners until you publish it.';
}
