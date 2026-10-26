import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const authSource = fs.readFileSync(new URL('../../src/pages-auth.tsx', import.meta.url), 'utf8');
const loginPage = authSource.slice(authSource.indexOf('export function LoginPage'), authSource.indexOf('export function RegisterPage'));
const authContext = fs.readFileSync(new URL('../../src/auth-context.tsx', import.meta.url), 'utf8');

test('sign-in accepts a username or email in one credential field', () => {
  assert.match(loginPage, /<span>Username or email<\/span>/);
  assert.match(loginPage, /<input name="username"[^>]*maxLength=\{254\} autoComplete="username"/);
  assert.match(loginPage, /signIn\(identifier, password\)/);
  assert.match(authContext, /\/api\/auth\/login', \{ username: identifier, password \}/);
});
