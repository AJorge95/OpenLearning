export function courseDeletionConfirmation(title: string) {
  return {
    title: `Permanently delete “${title}”?`,
    description: 'Permanently deleting this course also removes its uploaded media, enrollments, learner progress, quiz attempts, and links to course groups and learning paths. Issued certificates stay in learner history but are unlinked from the course. This action cannot be undone.',
  };
}
