export function courseDeletionConfirmation(title: string) {
  return {
    title: `Permanently delete “${title}”?`,
    description: 'The course and its uploaded media will be removed. This action cannot be undone.',
  };
}
