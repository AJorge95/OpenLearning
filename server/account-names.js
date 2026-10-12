import { fail } from './http.js';
import { accountNameError, normalizeAccountName } from '../src/account-name-validation.ts';

export function accountName(value, label) {
  const error = accountNameError(value, label);
  if (error) fail(400, error, 'invalid_name');
  return normalizeAccountName(value);
}

export function accountNames(body) {
  return {
    firstName: accountName(body?.firstName, 'First name'),
    lastName: accountName(body?.lastName, 'Last name'),
  };
}
