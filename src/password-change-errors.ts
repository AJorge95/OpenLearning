export type AccountPasswordField = 'current' | 'new' | 'confirmation';

// Use stable API codes so password errors stay attached to the correct field if copy changes.
export function accountPasswordFieldForError(code?: string): AccountPasswordField | null {
  if (code === 'invalid_current_password' || code === 'password_incorrect') return 'current';
  if (code === 'invalid_password') return 'new';
  if (code === 'password_mismatch') return 'confirmation';
  return null;
}

export function shouldClearAccountPasswordFieldErrorOnEdit(
  editedField: AccountPasswordField,
  invalidField: AccountPasswordField | null,
) {
  return invalidField === editedField
    || (invalidField === 'confirmation' && (editedField === 'new' || editedField === 'confirmation'));
}
