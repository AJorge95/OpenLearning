export type UserRoleFilter = 'all' | 'admin' | 'moderator' | 'learner';

const roleLabels: Record<Exclude<UserRoleFilter, 'all'>, string> = {
  admin: 'administrator',
  moderator: 'moderator',
  learner: 'learner',
};

export function userListEmptyMessage(query: string, role: UserRoleFilter) {
  const hasQuery = Boolean(query.trim());
  if (role === 'all') return hasQuery ? 'No users match this search.' : 'No user accounts found.';
  const roleLabel = roleLabels[role];
  return hasQuery
    ? `No ${roleLabel} accounts match this search.`
    : `No ${roleLabel} accounts found.`;
}
