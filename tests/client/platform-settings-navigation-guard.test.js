import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../../src/pages-manage.tsx', import.meta.url), 'utf8');
const settingsPage = source.slice(
  source.indexOf('export function AdminSettingsPage()'),
  source.indexOf('function AdminSettingsTabs()'),
);

test('every persisted platform setting participates in the unsaved draft check', () => {
  assert.match(settingsPage, /const hasUnsavedChanges = name !== platformName[\s\S]*?userLimitValue !== String\(userLimit\);/);
  for (const field of [
    'icon !== platformIcon',
    'palette !== themePalette',
    'protocol !== connectionProtocol',
    'allowRegistration !== registrationEnabled',
    'requireRegistrationApproval !== registrationApprovalRequired',
  ]) assert.ok(settingsPage.includes(field), `Expected the draft comparison to include ${field}.`);
});

test('platform settings drafts guard in-app and browser navigation with save-aware choices', () => {
  assert.match(settingsPage, /return locationChanged && \(hasUnsavedChanges \|\| saving\)/);
  assert.match(settingsPage, /const navigationBlocker = useBlocker\(shouldBlockNavigation\)/);
  assert.match(settingsPage, /if \(!hasUnsavedChanges && !saving\) return;[\s\S]*?event\.preventDefault\(\)/);
  assert.match(settingsPage, /useBeforeUnload\(preventUnsavedSettingsExit\)/);
  assert.match(settingsPage, /navigationBlocker\.state === 'blocked' && !hasUnsavedChanges && !saving\) navigationBlocker\.proceed\(\)/);
  assert.match(settingsPage, /title=\{saving \? 'Platform settings save in progress' : 'Discard unsaved platform settings\?'\}/);
  assert.match(settingsPage, /confirmLabel=\{saving \? 'Saving…' : 'Discard changes'\}/);
  assert.match(settingsPage, /confirmDisabled=\{saving\}/);
  assert.match(settingsPage, /onCancel=\{navigationBlocker\.reset\}/);
  assert.match(settingsPage, /onConfirm=\{navigationBlocker\.proceed\}/);
});
