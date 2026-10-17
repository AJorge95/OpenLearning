import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('registration clears generic feedback when the username changes', () => {
  const source = fs.readFileSync(new URL('../../src/pages-auth.tsx', import.meta.url), 'utf8');
  const registerPage = source.slice(source.indexOf('export function RegisterPage()'), source.indexOf('export function AccountSecurityPage()'));

  // A registration conflict is intentionally generic, so editing its likely identifier should remove stale feedback.
  assert.match(registerPage, /name="username"[\s\S]*onChange=\{\(event\) => \{ setUsername\(event\.target\.value\); setError\('\'\); \}\}/);
});
