import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const authSource = fs.readFileSync(new URL('../../src/pages-auth.tsx', import.meta.url), 'utf8');
const loginPage = authSource.slice(
  authSource.indexOf('export function LoginPage()'),
  authSource.indexOf('export function RegisterPage()'),
);

test('login clears stale feedback when either credential changes', () => {
  assert.match(loginPage, /value=\{username\} onChange=\{\(event\) => \{ setUsername\(event\.target\.value\); setError\(''\); \}\}/);
  assert.match(loginPage, /value=\{password\} onChange=\{\(event\) => \{ setPassword\(event\.target\.value\); setError\(''\); \}\}/);
});
