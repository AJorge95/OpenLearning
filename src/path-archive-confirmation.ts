export function pathArchiveConfirmation(pathTitle: string) {
  return {
    title: `Archive “${pathTitle}”?`,
    description: 'It will be removed from active learning path lists. Existing learner enrollments and course progress will be kept. You can restore it later as a draft.',
  };
}
