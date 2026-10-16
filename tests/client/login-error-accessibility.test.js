import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const authSource = fs.readFileSync(new URL('../../src/pages-auth.tsx', import.meta.url), 'utf8');
const loginPage = authSource.slice(
  authSource.indexOf('export function LoginPage()'),
  authSource.indexOf('export function RegisterPage'),
);

test('login authentication errors remain associated with both credential fields', () => {
  assert.match(loginPage, /const loginErrorId = useId\(\);/);
  assert.match(loginPage, /aria-describedby=\{error \? `login-description \$\{loginErrorId\}` : 'login-description'\}/);
  assert.match(loginPage, /<PasswordField label="Password" name="password" aria-describedby=\{error \? loginErrorId : undefined\}/);
  assert.match(loginPage, /\{error && <p id=\{loginErrorId\} className="form-error" role="alert">\{error\}<\/p>\}/);
});
