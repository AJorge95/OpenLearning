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

export function addLessonCommentToPage(existing: LessonComment[], comment: LessonComment, pageSize: number) {
  if (existing.some((current) => current.id === comment.id)) return existing;
  return [comment, ...existing].slice(0, Math.max(existing.length, pageSize));
}
