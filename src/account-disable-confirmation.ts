export function accountDisableConfirmation(username: string) {
  return {
    title: `Disable ${username}'s account?`,
    description: 'They will be signed out and cannot sign in until an administrator re-enables the account.',
  };
}
