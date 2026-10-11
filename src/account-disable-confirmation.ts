export function accountDisableConfirmation(username: string): string {
  return `Disable ${username}'s account? They will be signed out and cannot sign in until an administrator re-enables the account.`;
}
