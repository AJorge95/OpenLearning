export const PASSWORD_CONFIRMATION_ERROR = 'Passwords do not match.';

export function getPasswordConfirmationError(password: string, confirmation: string) {
  return password === confirmation ? null : PASSWORD_CONFIRMATION_ERROR;
}

// Link the mismatch alert to the confirmation input without labeling unrelated API errors as field errors.
export function passwordConfirmationFieldProps(error: string, errorId: string, forceInvalid = false) {
  const invalid = forceInvalid || error === PASSWORD_CONFIRMATION_ERROR;
  return {
    'aria-invalid': invalid || undefined,
    'aria-describedby': invalid ? errorId : undefined,
  };
}

export function clearPasswordConfirmationError(error: string) {
  return error === PASSWORD_CONFIRMATION_ERROR ? '' : error;
}
