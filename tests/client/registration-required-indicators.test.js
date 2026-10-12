import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const authSource = fs.readFileSync(new URL('../../src/pages-auth.tsx', import.meta.url), 'utf8');
const componentSource = fs.readFileSync(new URL('../../src/components.tsx', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');

test('public registration visibly marks core fields that are required', () => {
  const registrationPage = authSource.slice(authSource.indexOf('export function RegisterPage'));

  assert.match(registrationPage, /<span className="form-label-row"><span>Email<\/span><small className="form-required-indicator" aria-hidden="true">Required<\/small><\/span><input[^>]*name="email" required/);
  assert.match(registrationPage, /<span className="form-label-row"><span>Username<\/span><small className="form-required-indicator" aria-hidden="true">Required<\/small><\/span><\/label><input[^>]*name="username"[^>]*required/);
  assert.match(registrationPage, /<small id=\{firstNameHelpId\}>Required · used on certificates<\/small>/);
  assert.match(registrationPage, /<small id=\{lastNameHelpId\}>Required · used on certificates<\/small>/);
  assert.match(registrationPage, /<PasswordField label="Password"[^>]*required/);
  assert.match(registrationPage, /<PasswordField label="Confirm password"[^>]*required/);
});

test('password fields mark native required state without changing their accessible name', () => {
  assert.match(componentSource, /<label htmlFor=\{inputId\}><span className="form-label-row"><span>\{label\}<\/span>\{inputProps\.required && <small className="form-required-indicator" aria-hidden="true">Required<\/small>\}<\/span><\/label>/);
  assert.match(styles, /\.form-label-row\s*\{[^}]*display:\s*flex;[^}]*justify-content:\s*space-between;/);
  assert.match(styles, /\.form-label-row \.form-required-indicator\s*\{[^}]*font-size:\s*11px;/);
});
