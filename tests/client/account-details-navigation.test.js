import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../../src/pages-manage.tsx', import.meta.url), 'utf8');
const pageStart = source.indexOf('export function AdminUserDetailsPage()');
const pageEnd = source.indexOf('\nexport function AdminSettingsPage()', pageStart);
const accountDetailsPage = source.slice(pageStart, pageEnd);

test('unsaved account detail forms are recognized as drafts for the loaded account', () => {
  assert.match(accountDetailsPage, /const hasUnsavedChanges = account\?\.user\.id === userId && \([\s\S]*?accountEmailUserId === userId && accountEmail\.trim\(\) !== \(account\.user\.email \|\| ''\)[\s\S]*?profileNamesUserId === userId && \(normalizeAccountName\(profileFirstName\) !== \(account\.user\.firstName \|\| ''\)[\s\S]*?normalizeAccountName\(profileLastName\) !== \(account\.user\.lastName \|\| ''\)\)[\s\S]*?Boolean\(password \|\| confirmPassword\)/);
});

test('account detail drafts guard in-app navigation and browser exits until saved or discarded', () => {
  assert.match(accountDetailsPage, /const shouldBlockNavigation = useCallback<BlockerFunction>\(\(\{ currentLocation, nextLocation \}\) => \{[\s\S]*?currentLocation\.pathname !== nextLocation\.pathname[\s\S]*?currentLocation\.search !== nextLocation\.search[\s\S]*?currentLocation\.hash !== nextLocation\.hash[\s\S]*?locationChanged && \(hasUnsavedChanges \|\| saving\)/);
  assert.match(accountDetailsPage, /const preventUnsavedAccountExit = useCallback\(\(event: BeforeUnloadEvent\) => \{\s*if \(!hasUnsavedChanges && !saving\) return;\s*event\.preventDefault\(\);\s*event\.returnValue = '';\s*\}, \[hasUnsavedChanges, saving\]\);\s*useBeforeUnload\(preventUnsavedAccountExit\)/);
  assert.match(accountDetailsPage, /navigationBlocker\.state === 'blocked' && !hasUnsavedChanges && !saving\) navigationBlocker\.proceed\(\)/);
});

test('account detail discard confirmation cannot interrupt a pending save', () => {
  assert.match(accountDetailsPage, /title=\{saving \? 'Account update in progress' : 'Discard unsaved account changes\?'\}/);
  assert.match(accountDetailsPage, /confirmDisabled=\{saving\}/);
  assert.match(accountDetailsPage, /onCancel=\{navigationBlocker\.reset\}\s*onConfirm=\{navigationBlocker\.proceed\}/);
});
