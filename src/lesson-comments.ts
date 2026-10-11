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

function compareLessonCommentsNewestFirst(left: LessonComment, right: LessonComment) {
  if (left.createdAt !== right.createdAt) return left.createdAt > right.createdAt ? -1 : 1;
  if (left.id === right.id) return 0;
  return left.id > right.id ? -1 : 1;
}

export function addLessonCommentToPage(existing: LessonComment[], comment: LessonComment, pageSize: number) {
  if (existing.some((current) => current.id === comment.id)) return existing;
  const insertionIndex = existing.findIndex((current) => compareLessonCommentsNewestFirst(comment, current) < 0);
  const index = insertionIndex < 0 ? existing.length : insertionIndex;
  return [...existing.slice(0, index), comment, ...existing.slice(index)].slice(0, Math.max(existing.length, pageSize));
}
