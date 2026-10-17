export type UserRoleFilter = 'all' | 'admin' | 'moderator' | 'learner';
export type UserApprovalFilter = 'all' | 'pending' | 'approved';

const roleLabels: Record<Exclude<UserRoleFilter, 'all'>, string> = {
  admin: 'administrator',
  moderator: 'moderator',
  learner: 'learner',
};

export function userListEmptyMessage(query: string, role: UserRoleFilter, approval: UserApprovalFilter = 'all') {
  const hasQuery = Boolean(query.trim());
  if (approval === 'pending') {
    const registrations = role === 'all' ? 'registrations' : `${roleLabels[role]} registrations`;
    if (!hasQuery) return role === 'all' ? 'No registrations are waiting for approval.' : `No ${registrations} are waiting for approval.`;
    return `No pending ${registrations} match this search.`;
  }
  const accounts = role === 'all' ? 'user accounts' : `${roleLabels[role]} accounts`;
  if (approval === 'approved') return hasQuery ? `No approved ${accounts} match this search.` : `No approved ${accounts} found.`;
  if (role === 'all') return hasQuery ? 'No users match this search.' : 'No user accounts found.';
  return hasQuery ? `No ${accounts} match this search.` : `No ${accounts} found.`;
}
