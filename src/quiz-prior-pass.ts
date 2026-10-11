export function quizPriorPassNotice(quizPassed: boolean, currentAttemptPassed: boolean | null): string | null {
  if (!quizPassed || currentAttemptPassed === true) return null;

  // Stable-ID progress can preserve a pass even when this version has no passed attempt.
  return currentAttemptPassed === false
    ? 'A previous passing result still counts toward course completion, even though this attempt did not pass.'
    : 'A previous passing result still counts toward course completion. You can take this quiz again to record another result.';
}
