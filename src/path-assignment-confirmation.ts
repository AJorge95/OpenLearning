export function pathAssignmentRemovalConfirmation(username: string, pathTitle: string) {
  return {
    title: `Remove ${username} from “${pathTitle}”?`,
    description: 'They will leave this learning path and may lose access to private courses in it. Their course progress will be kept.',
  };
}
