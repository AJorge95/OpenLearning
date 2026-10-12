export type CourseAccessAction = 'assign' | 'unassign' | null;

export function courseAccessAction(user: { disabled: boolean; granted: boolean }): CourseAccessAction {
  // Disabled accounts cannot receive new grants, but existing access can still be revoked.
  if (user.disabled && !user.granted) return null;
  return user.granted ? 'unassign' : 'assign';
}
