import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../../src/pages-manage.tsx', import.meta.url), 'utf8');
const pageStart = source.indexOf('export function AdminUserDetailsPage()');
const pageEnd = source.indexOf('\nexport function AdminAuditLogPage()', pageStart);
const accountDetailsPage = source.slice(pageStart, pageEnd);

test('editing account details clears page-level action feedback', () => {
  assert.match(accountDetailsPage, /function clearAccountActionFeedback\(\)\s*\{\s*\/\/ The shared banner reports the previous action, so edits start a new attempt\.\s*setError\(''\);\s*setSuccess\(''\);\s*\}/);
  assert.match(accountDetailsPage, /setAccountEmail\(event\.target\.value\); setAccountEmailError\(''\); clearAccountActionFeedback\(\);/);
  assert.match(accountDetailsPage, /setProfileFirstName\(event\.target\.value\); clearAccountActionFeedback\(\);/);
  assert.match(accountDetailsPage, /setProfileLastName\(event\.target\.value\); clearAccountActionFeedback\(\);/);
  assert.match(accountDetailsPage, /setPassword\(event\.target\.value\); clearAccountActionFeedback\(\);/);
  assert.match(accountDetailsPage, /setConfirmPassword\(event\.target\.value\); clearAccountActionFeedback\(\);/);
});
