import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../../src/pages-manage.tsx', import.meta.url), 'utf8');
const createPage = source.slice(
  source.indexOf('export function AdminUserCreatePage()'),
  source.indexOf('export function AdminUserDetailsPage()'),
);

test('all entered account details and non-default roles count as an unsaved draft', () => {
  assert.match(createPage, /const hasUnsavedChanges = Boolean\(email \|\| firstName \|\| lastName \|\| username \|\| password \|\| confirmPassword \|\| role !== 'learner'\)/);
});

test('account creation drafts guard in-app and browser navigation while saving', () => {
  assert.match(createPage, /return locationChanged && \(hasUnsavedChanges \|\| saving\)/);
  assert.match(createPage, /const navigationBlocker = useBlocker\(shouldBlockNavigation\)/);
  assert.match(createPage, /accountCreationCommittedRef\.current \|\| \(!hasUnsavedChanges && !saving\)/);
  assert.match(createPage, /useBeforeUnload\(preventUnsavedAccountExit\)/);
  assert.match(createPage, /title=\{saving \? 'Account creation in progress' : 'Discard account draft\?'\}/);
  assert.match(createPage, /confirmLabel=\{saving \? 'Creating…' : 'Discard draft'\}/);
  assert.match(createPage, /confirmDisabled=\{saving\}/);
  assert.match(createPage, /onCancel=\{navigationBlocker\.reset\}/);
  assert.match(createPage, /onConfirm=\{navigationBlocker\.proceed\}/);
});

test('a successful account creation follows a pending route or opens the new account', () => {
  assert.match(createPage, /accountCreationCommittedRef\.current = true;[\s\S]*?const pendingNavigation = navigationBlockerRef\.current;[\s\S]*?if \(pendingNavigation\.state === 'blocked'\) pendingNavigation\.proceed\(\);[\s\S]*?else navigate\(`\/admin\/users\/\$\{response\.user\.id\}`/);
});
