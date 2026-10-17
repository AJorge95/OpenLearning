import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../../src/pages-manage.tsx', import.meta.url), 'utf8');
const createAccountPage = source.slice(source.indexOf('export function AdminUserCreatePage()'), source.indexOf('export function AdminUserDetailsPage()'));

test('administrator account creation shows decorative cues for required identity fields', () => {
  const requiredCue = '<small className="form-required-indicator" aria-hidden="true">Required</small>';
  for (const label of ['Email', 'First name', 'Last name', 'Username']) {
    assert.match(
      createAccountPage,
      new RegExp(`<span className="form-label-row"><span>${label}</span>${requiredCue}</span>`),
      `Expected ${label} to have a visual required cue.`,
    );
  }
  assert.match(createAccountPage, /<span className="form-label-row"><span>Email<\/span>[\s\S]*?name="email" required/);
  assert.match(createAccountPage, /<span className="form-label-row"><span>First name<\/span>[\s\S]*?name="firstName" required/);
  assert.match(createAccountPage, /<span className="form-label-row"><span>Last name<\/span>[\s\S]*?name="lastName" required/);
  assert.match(createAccountPage, /<span className="form-label-row"><span>Username<\/span>[\s\S]*?name="username" required/);
});
