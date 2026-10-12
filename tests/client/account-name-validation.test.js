import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { accountNameError, MAX_ACCOUNT_NAME_LENGTH, normalizeAccountName } from '../../src/account-name-validation.ts';

const source = fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/pages-auth.tsx'),
  'utf8',
);

test('account names normalize whitespace and preserve the server length and control-character rules', () => {
  assert.equal(MAX_ACCOUNT_NAME_LENGTH, 80);
  assert.equal(normalizeAccountName('  Ana   María\tJorge  '), 'Ana María Jorge');
  assert.equal(accountNameError('  Ana   María  ', 'First name'), null);
  assert.equal(accountNameError('a'.repeat(MAX_ACCOUNT_NAME_LENGTH), 'Last name'), null);
  assert.equal(accountNameError('   ', 'First name'), 'First name must be between 1 and 80 characters.');
  assert.equal(accountNameError('a'.repeat(MAX_ACCOUNT_NAME_LENGTH + 1), 'Last name'), 'Last name must be between 1 and 80 characters.');
  assert.equal(accountNameError('Ana\u0000María', 'First name'), 'First name must be between 1 and 80 characters.');
  assert.equal(accountNameError(null, 'Last name'), 'Last name must be between 1 and 80 characters.');
});

test('setup validates and normalizes names before hiding the setup fields', () => {
  const setupPage = source.slice(source.indexOf('export function SetupPage()'), source.indexOf('function BookOpenMark()'));
  assert.match(setupPage, /accountNameError\(firstName, 'First name'\)[\s\S]*setupFirstNameInputRef\.current\?\.focus\(\)[\s\S]*accountNameError\(lastName, 'Last name'\)[\s\S]*setStep\(2\)/);
  assert.match(setupPage, /setFirstName\(normalizeAccountName\(firstName\)\)/);
  assert.match(setupPage, /setLastName\(normalizeAccountName\(lastName\)\)/);
  assert.match(setupPage, /aria-invalid=\{invalidNameField === 'firstName' \|\| undefined\} aria-describedby=\{invalidNameField === 'firstName' \? setupErrorId : undefined\}/);
});

test('registration rejects invalid names and submits normalized values', () => {
  const registerPage = source.slice(source.indexOf('export function RegisterPage()'), source.indexOf('export function AccountSecurityPage()'));
  assert.match(registerPage, /accountNameError\(firstName, 'First name'\)[\s\S]*firstNameInputRef\.current\?\.focus\(\)[\s\S]*accountNameError\(lastName, 'Last name'\)/);
  assert.match(registerPage, /signUp\(email, normalizedFirstName, normalizedLastName/);
  assert.match(registerPage, /aria-invalid=\{invalidNameField === 'lastName' \|\| undefined\} aria-describedby=\{invalidNameField === 'lastName' \? 'registration-form-error' : undefined\}/);
});
