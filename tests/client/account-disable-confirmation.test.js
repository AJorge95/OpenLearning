import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { accountDisableConfirmation } from '../../src/account-disable-confirmation.ts';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const manageSource = fs.readFileSync(path.join(repositoryRoot, 'src/pages-manage.tsx'), 'utf8');

test('account disable confirmation explains logout and the recovery step', () => {
  assert.equal(accountDisableConfirmation('learner-one'),
    "Disable learner-one's account? They will be signed out and cannot sign in until an administrator re-enables the account.");
});

test('the user list confirms a disable before sending the account update', () => {
  const updateUser = manageSource.slice(manageSource.indexOf('async function updateUser'), manageSource.indexOf('async function resetPassword'));

  assert.match(updateUser, /if \(changes\.disabled === true && !window\.confirm\(accountDisableConfirmation\(user\.username\)\)\) return;/);
  assert.ok(updateUser.indexOf('window.confirm(accountDisableConfirmation(user.username))') < updateUser.indexOf('api.patch'));
});

test('account details confirm a disable before sending the account update', () => {
  const updateAccount = manageSource.slice(manageSource.indexOf('async function updateAccount'), manageSource.indexOf('async function loadAccount'));

  assert.match(updateAccount, /if \(changes\.disabled === true && !window\.confirm\(accountDisableConfirmation\(account\.user\.username\)\)\) return;/);
  assert.ok(updateAccount.indexOf('window.confirm(accountDisableConfirmation(account.user.username))') < updateAccount.indexOf('api.patch'));
});
