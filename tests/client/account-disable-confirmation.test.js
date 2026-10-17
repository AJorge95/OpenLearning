import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { accountDisableConfirmation } from '../../src/account-disable-confirmation.ts';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const manageSource = fs.readFileSync(path.join(repositoryRoot, 'src/pages-manage.tsx'), 'utf8');

test('account disable confirmation names the account and explains the recovery step', () => {
  assert.deepEqual(accountDisableConfirmation('learner-one'), {
    title: "Disable learner-one's account?",
    description: 'They will be signed out and cannot sign in until an administrator re-enables the account.',
  });
});

test('the user list stages account disable until the confirmation is accepted', () => {
  const updateUser = manageSource.slice(manageSource.indexOf('async function updateUser'), manageSource.indexOf('async function resetPassword'));

  assert.match(updateUser, /if \(changes\.disabled === true && !disableConfirmed\) \{ setPendingDisableUser\(user\); return; \}/);
  assert.ok(updateUser.indexOf('setPendingDisableUser(user)') < updateUser.indexOf('api.patch'));
  assert.match(manageSource, /onCancel=\{\(\) => setPendingDisableUser\(null\)\}/);
  assert.match(manageSource, /onConfirm=\{\(\) => \{ const user = pendingDisableUser; setPendingDisableUser\(null\); if \(user\) void updateUser\(user, \{ disabled: true \}, true\); \}\}/);
});

test('account details stage account disable until the confirmation is accepted', () => {
  const updateAccount = manageSource.slice(manageSource.indexOf('async function updateAccount'), manageSource.indexOf('async function loadAccount'));

  assert.match(updateAccount, /if \(changes\.disabled === true && !disableConfirmed\) \{ setPendingDisableAccountId\(account\.user\.id\); return; \}/);
  assert.ok(updateAccount.indexOf('setPendingDisableAccountId(account.user.id)') < updateAccount.indexOf('api.patch'));
  assert.match(manageSource, /onCancel=\{\(\) => setPendingDisableAccountId\(null\)\}/);
  assert.match(manageSource, /if \(requestedUserId === user\.id\) void updateAccount\(\{ disabled: true \}, `\$\{user\.username\}'s account was disabled\.`, true\);/);
});
