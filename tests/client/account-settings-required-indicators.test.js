import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../../src/pages-auth.tsx', import.meta.url), 'utf8');
const accountSettingsPage = source.slice(source.indexOf('export function AccountSecurityPage()'));

test('account profile names show decorative required cues without changing native validation', () => {
  const requiredCue = '<small className="form-required-indicator" aria-hidden="true">Required</small>';
  for (const label of ['First name', 'Last name']) {
    assert.match(
      accountSettingsPage,
      new RegExp(`<span className="form-label-row"><span>${label}</span>${requiredCue}</span>`),
      `Expected ${label} to have a visual required cue.`,
    );
  }
  assert.match(accountSettingsPage, /<span className="form-label-row"><span>First name<\/span>[\s\S]*?name="firstName" required/);
  assert.match(accountSettingsPage, /<span className="form-label-row"><span>Last name<\/span>[\s\S]*?name="lastName" required/);
});
