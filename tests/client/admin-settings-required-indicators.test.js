import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const manageSource = fs.readFileSync(new URL('../../src/pages-manage.tsx', import.meta.url), 'utf8');
const settingsPage = manageSource.slice(
  manageSource.indexOf('export function AdminSettingsPage()'),
  manageSource.indexOf('export function AdminRegistrationFieldsPage()'),
);

test('administrator settings required fields show decorative cues without changing native semantics', () => {
  assert.match(settingsPage, /<label><span className="form-label-row"><span>Platform name<\/span><small className="form-required-indicator" aria-hidden="true">Required<\/small><\/span><input[^>]*required[^>]*value=\{name\}/);
  assert.match(settingsPage, /<label><span className="form-label-row"><span>Maximum registered accounts<\/span><small className="form-required-indicator" aria-hidden="true">Required<\/small><\/span><input[^>]*type="number"[^>]*required[^>]*value=\{userLimitValue\}/);
  assert.match(settingsPage, /aria-describedby=\{platformNameError \? platformNameErrorId : undefined\}/);
  assert.match(settingsPage, /0 means no limit\. The cap includes administrators, moderators, and learners\./);
});
