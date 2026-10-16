import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../../src/pages-manage.tsx', import.meta.url), 'utf8');
const settingsPage = source.slice(
  source.indexOf('export function AdminSettingsPage()'),
  source.indexOf('export function AdminRegistrationFieldsPage()'),
);

test('administrator settings associates invalid account-limit responses with the account-limit field', () => {
  assert.match(settingsPage, /const userLimitErrorId = useId\(\);/);
  assert.match(settingsPage, /const userLimitInputRef = useRef<HTMLInputElement>\(null\);/);
  assert.match(settingsPage, /cause\.code === 'invalid_user_limit'[\s\S]*setUserLimitError\(cause\.message\)[\s\S]*userLimitInputRef\.current\?\.focus\(\)/);
  assert.match(settingsPage, /ref=\{userLimitInputRef\}[^>]*type="number"[^>]*aria-invalid=\{userLimitError \? true : undefined\}[^>]*aria-describedby=\{userLimitError \? userLimitErrorId : undefined\}/);
  assert.match(settingsPage, /id=\{userLimitErrorId\} className="form-error" role="alert">\{userLimitError\}<\/p>/);
  assert.match(settingsPage, /setUserLimitValue\(event\.target\.value\); setUserLimitError\(''\)/);
});
