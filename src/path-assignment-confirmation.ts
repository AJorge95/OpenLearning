export function pathAssignmentRemovalConfirmation(username: string, pathTitle: string): string {
  return `Remove ${username} from “${pathTitle}”? They will leave this learning path and may lose access to private courses in it. Their course progress will be kept.`;
}
