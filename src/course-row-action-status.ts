export type CourseRowAction = 'publish' | 'unpublish' | 'archive' | 'delete';

const progressMessages: Record<CourseRowAction, string> = {
  publish: 'Publishing…',
  unpublish: 'Unpublishing…',
  archive: 'Archiving…',
  delete: 'Deleting…',
};

export function courseRowActionStatus(action: CourseRowAction) {
  return progressMessages[action];
}
