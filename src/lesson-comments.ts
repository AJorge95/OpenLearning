import type { LessonComment } from './types';

export function getNewLessonComments(existing: LessonComment[], incoming: LessonComment[]) {
  const knownIds = new Set(existing.map((comment) => comment.id));
  const additions: LessonComment[] = [];
  for (const comment of incoming) {
    if (knownIds.has(comment.id)) continue;
    knownIds.add(comment.id);
    additions.push(comment);
  }
  return additions;
}
