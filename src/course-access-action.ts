export type CourseAccessAction = 'assign' | 'unassign' | null;

export function courseAccessAction(user: { disabled: boolean; granted: boolean }): CourseAccessAction {
  // Disabled accounts cannot receive new grants, but existing access can still be revoked.
  if (user.disabled && !user.granted) return null;
  return user.granted ? 'unassign' : 'assign';
}

export function courseAccessStatusLabel(course: { visibility: 'public' | 'private' }, user: {
  granted: boolean;
  hasAccess: boolean;
  accessViaPath: boolean;
}) {
  // Direct assignment is the most actionable source of access, so keep it ahead of path/public access.
  if (user.granted) return 'Directly assigned';
  if (user.accessViaPath) return 'Access through learning path';
  if (course.visibility === 'public' && user.hasAccess) return 'Public access';
  return 'No access';
}

export function courseAccessActionLabel(action: CourseAccessAction, accessViaPath: boolean) {
  if (action === 'assign' && accessViaPath) return 'Add direct assignment';
  if (action === 'unassign') return 'Unassign';
  return 'Assign course';
}
