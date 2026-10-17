import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const authSource = fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/pages-auth.tsx'),
  'utf8',
);
const registerPage = authSource.slice(
  authSource.indexOf('export function RegisterPage()'),
  authSource.indexOf('export function AccountSecurityPage()'),
);

test('the registration form does not move focus into its long form on page load', () => {
  assert.match(registerPage, /<label><span className="form-label-row"><span>Email<\/span><small className="form-required-indicator" aria-hidden="true">Required<\/small><\/span><input[^>]*type="email"[^>]*maxLength=\{254\}[^>]*autoComplete="email"/);
  assert.match(registerPage, /aria-invalid=\{emailError \? true : undefined\} aria-describedby=\{emailError \? emailErrorId : undefined\}/);
  assert.doesNotMatch(registerPage, /autoFocus/);
});
