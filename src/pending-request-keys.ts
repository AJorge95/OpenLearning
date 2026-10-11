export function updatePendingRequestKeys(current: ReadonlySet<string>, key: string, pending: boolean): ReadonlySet<string> {
  if (current.has(key) === pending) return current;
  const next = new Set(current);
  if (pending) next.add(key);
  else next.delete(key);
  return next;
}
