import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const authSource = fs.readFileSync(new URL('../../src/pages-auth.tsx', import.meta.url), 'utf8');

test('setup visibly marks each required configuration field', () => {
  const setupPage = authSource.slice(authSource.indexOf('export function SetupPage'), authSource.indexOf('function BookOpenMark'));

  for (const label of ['Platform name', 'Admin email', 'First name', 'Last name', 'Admin username', 'One-time setup token', 'Maximum registered accounts']) {
    assert.match(
      setupPage,
      new RegExp(`<span className="form-label-row"><span>${label}</span><small className="form-required-indicator" aria-hidden="true">Required</small></span>`),
      `Expected ${label} to have a visual required cue.`,
    );
  }
});

test('setup required cues remain decorative while native constraints stay in place', () => {
  const setupPage = authSource.slice(authSource.indexOf('export function SetupPage'), authSource.indexOf('function BookOpenMark'));

  assert.match(setupPage, /Platform name[\s\S]*?required minLength=/);
  assert.match(setupPage, /Admin email[\s\S]*?name="email" required/);
  assert.match(setupPage, /name="firstName" required/);
  assert.match(setupPage, /name="lastName" required/);
  assert.match(setupPage, /name="username"[\s\S]*?required minLength=/);
  assert.match(setupPage, /name="setupToken" required minLength=/);
  assert.match(setupPage, /Maximum registered accounts[\s\S]*?step=\{1\} required/);
  assert.equal((setupPage.match(/aria-hidden="true">Required/g) || []).length, 7);
});
