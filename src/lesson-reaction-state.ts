export function updatePendingReactionIds(current: ReadonlySet<string>, lessonId: string, pending: boolean): ReadonlySet<string> {
  if (current.has(lessonId) === pending) return current;
  const next = new Set(current);
  if (pending) next.add(lessonId);
  else next.delete(lessonId);
  return next;
}
