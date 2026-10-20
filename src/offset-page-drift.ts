/** Detect when an offset page no longer continues the items already displayed. */
export function offsetPageHasDrift<T extends { id: string }>(
  currentItems: T[],
  incomingItems: T[],
  expectedTotal: number,
  receivedTotal: number | undefined,
  expectedPage: number,
  receivedPage: number | undefined,
): boolean {
  if (receivedTotal !== undefined && receivedTotal !== expectedTotal) return true;
  if (receivedPage !== undefined && receivedPage !== expectedPage) return true;

  const currentIds = new Set(currentItems.map((item) => item.id));
  return incomingItems.some((item) => currentIds.has(item.id));
}
