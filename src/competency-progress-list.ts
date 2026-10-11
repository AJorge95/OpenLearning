export const COMPETENCY_PROGRESS_BATCH_SIZE = 12;

export function nextVisibleCompetencyCount(currentCount: number, total: number) {
  return Math.min(Math.max(0, total), Math.max(0, currentCount) + COMPETENCY_PROGRESS_BATCH_SIZE);
}
