import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { accountPasswordFieldForError, shouldClearAccountPasswordFieldErrorOnEdit } from '../../src/password-change-errors.ts';

const authSource = fs.readFileSync(new URL('../../src/pages-auth.tsx', import.meta.url), 'utf8');
const accountSecuritySource = authSource.slice(authSource.indexOf('export function AccountSecurityPage()'));
const styles = fs.readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');

test('maps password API validation codes to their corresponding fields', () => {
  assert.equal(accountPasswordFieldForError('invalid_current_password'), 'current');
  assert.equal(accountPasswordFieldForError('password_incorrect'), 'current');
  assert.equal(accountPasswordFieldForError('invalid_password'), 'new');
  assert.equal(accountPasswordFieldForError('password_mismatch'), 'confirmation');
  assert.equal(accountPasswordFieldForError('rate_limited'), null);
});

test('clears only the field error resolved by an edit', () => {
  assert.equal(shouldClearAccountPasswordFieldErrorOnEdit('current', 'current'), true);
  assert.equal(shouldClearAccountPasswordFieldErrorOnEdit('new', 'current'), false);
  assert.equal(shouldClearAccountPasswordFieldErrorOnEdit('new', 'new'), true);
  assert.equal(shouldClearAccountPasswordFieldErrorOnEdit('new', 'confirmation'), true);
  assert.equal(shouldClearAccountPasswordFieldErrorOnEdit('current', 'confirmation'), false);
});

test('account password fields associate current, new, and confirmation errors with the alert', () => {
  assert.match(accountSecuritySource, /label="Current password"[^>]*aria-invalid=\{invalidPasswordField === 'current' \|\| undefined\}[^>]*aria-describedby=\{invalidPasswordField === 'current' \? passwordErrorId : undefined\}/);
  assert.match(accountSecuritySource, /label="New password"[^>]*aria-invalid=\{invalidPasswordField === 'new' \|\| undefined\}[^>]*aria-describedby=\{invalidPasswordField === 'new' \? passwordErrorId : undefined\}/);
  assert.match(accountSecuritySource, /passwordConfirmationFieldProps\(error, passwordErrorId, invalidPasswordField === 'confirmation'\)/);
  assert.match(accountSecuritySource, /<p id=\{passwordErrorId\} className="form-error" role="alert">\{error\}<\/p>/);
  assert.match(styles, /\.account-settings-page \.form-stack input\[aria-invalid="true"\] \{ border-color: var\(--danger\); \}/);
});
