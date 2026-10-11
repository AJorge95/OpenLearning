/**
 * Append an offset page only while it still belongs to the same competency list.
 * A stale page must trigger a refresh instead of duplicating or skipping cards.
 */
export function appendUnchangedCompetencyPage<T extends { id: string }>(
  existing: T[],
  incoming: T[],
  expectedPage: number,
  receivedPage: number,
  expectedTotal: number,
  receivedTotal: number,
): T[] | null {
  if (receivedPage !== expectedPage || receivedTotal !== expectedTotal) return null;

  const knownIds = new Set(existing.map(({ id }) => id));
  const next = [...existing];
  for (const item of incoming) {
    if (knownIds.has(item.id)) return null;
    knownIds.add(item.id);
    next.push(item);
  }
  return next;
}
