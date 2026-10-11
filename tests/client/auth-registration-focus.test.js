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
  assert.match(registerPage, /<label>Email<input required type="email" maxLength=\{254\} autoComplete="email"/);
  assert.doesNotMatch(registerPage, /autoFocus/);
});
