export type SubmissionLock = { current: boolean };

export function acquireSubmissionLock(lock: SubmissionLock) {
  if (lock.current) return false;
  lock.current = true;
  return true;
}

export function releaseSubmissionLock(lock: SubmissionLock) {
  lock.current = false;
}
