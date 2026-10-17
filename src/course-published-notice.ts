import type { Course } from './types';

export function coursePublishedNotice(visibility: Course['visibility']) {
  // Publishing a private course does not itself grant learner access.
  return visibility === 'private'
    ? 'Course published privately. Learners need an active course assignment or access through an unlocked learning path.'
    : 'Course published for learners.';
}
