export const PASSWORD_CONFIRMATION_ERROR = 'Passwords do not match.';

export function getPasswordConfirmationError(password: string, confirmation: string) {
  return password === confirmation ? null : PASSWORD_CONFIRMATION_ERROR;
}

export function clearPasswordConfirmationError(error: string) {
  return error === PASSWORD_CONFIRMATION_ERROR ? '' : error;
}
