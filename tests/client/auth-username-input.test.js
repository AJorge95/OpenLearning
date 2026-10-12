import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const authSource = fs.readFileSync(new URL('../../src/pages-auth.tsx', import.meta.url), 'utf8');
const manageSource = fs.readFileSync(new URL('../../src/pages-manage.tsx', import.meta.url), 'utf8');

test('all username fields prevent mobile capitalization and spellcheck changes', () => {
  const usernameInputs = `${authSource}\n${manageSource}`
    .match(/<input\b[^>]*autoComplete="username"[^>]*>/gs) || [];

  assert.equal(usernameInputs.length, 4, 'expected setup, sign-in, registration, and staff-created account fields');
  for (const input of usernameInputs) {
    assert.match(input, /autoCapitalize="none"/);
    assert.match(input, /spellCheck=\{false\}/);
  }
});
