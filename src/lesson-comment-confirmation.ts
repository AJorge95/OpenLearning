export function lessonCommentRemovalConfirmation(username: string) {
  return {
    title: `Remove comment by ${username}?`,
    description: 'This action cannot be undone.',
  };
}
