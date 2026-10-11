import type { LearningPath } from './types';

export function canAssignLearningPathLearners(status: LearningPath['status']) {
  return status === 'published';
}
