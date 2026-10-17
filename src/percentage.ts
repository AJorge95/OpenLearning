/** Keep user-facing percentage text within the same safe range as progress bars. */
export function normalizePercentage(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
}
