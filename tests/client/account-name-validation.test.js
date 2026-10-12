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
const manageSource = fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/pages-manage.tsx'),
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
  for (const [name, label, helpId] of [['firstName', 'First', 'firstNameHelpId'], ['lastName', 'Last', 'lastNameHelpId']]) {
    assert.ok(registerPage.includes('const ' + name + 'InputId = useId();'));
    assert.ok(registerPage.includes('<label htmlFor={' + name + 'InputId}>' + label + ' name</label>'));
    assert.ok(registerPage.includes('<small id={' + helpId + '}>Required · used on certificates</small>'));
    assert.match(registerPage, new RegExp(`<input\\s+id=\\{${name}InputId\\}`));
    assert.ok(registerPage.includes("aria-describedby={invalidNameField === '" + name + "' ?"));
    assert.ok(registerPage.includes('${' + helpId + '} registration-form-error`'));
    assert.ok(registerPage.includes(': ' + helpId + '}'));
  }
  assert.match(registerPage, /aria-invalid=\{invalidNameField === 'firstName' \|\| undefined\}/);
  assert.match(registerPage, /aria-invalid=\{invalidNameField === 'lastName' \|\| undefined\}/);
});

test('certificate-name editing validates before saving and identifies the field to correct', () => {
  const accountPage = manageSource.slice(manageSource.indexOf('export function AdminUserDetailsPage()'), manageSource.indexOf('export function AdminSettingsPage()'));
  assert.match(accountPage, /accountNameError\(profileFirstName, 'First name'\)[\s\S]*profileFirstNameInputRef\.current\?\.focus\(\)[\s\S]*accountNameError\(profileLastName, 'Last name'\)[\s\S]*profileLastNameInputRef\.current\?\.focus\(\)/);
  assert.match(accountPage, /firstName: normalizeAccountName\(profileFirstName\),\s*lastName: normalizeAccountName\(profileLastName\)/);
  assert.match(accountPage, /aria-invalid=\{invalidCertificateNameField === 'firstName' \|\| undefined\} aria-describedby=\{invalidCertificateNameField === 'firstName' \? certificateNameErrorId : undefined\}/);
  assert.match(accountPage, /aria-invalid=\{invalidCertificateNameField === 'lastName' \|\| undefined\} aria-describedby=\{invalidCertificateNameField === 'lastName' \? certificateNameErrorId : undefined\}/);
  assert.match(accountPage, /cause\.code === 'invalid_name'[\s\S]*setCertificateNameError\(cause\.message\)[\s\S]*profileLastNameInputRef\.current : profileFirstNameInputRef\.current\)\?\.focus\(\)/);
});

test('administrator account creation validates names before sending and handles server name errors', () => {
  const createPage = manageSource.slice(manageSource.indexOf('export function AdminUserCreatePage()'), manageSource.indexOf('export function AdminUserDetailsPage()'));
  assert.match(createPage, /accountNameError\(firstName, 'First name'\)[\s\S]*firstNameInputRef\.current\?\.focus\(\)[\s\S]*accountNameError\(lastName, 'Last name'\)[\s\S]*lastNameInputRef\.current\?\.focus\(\)/);
  assert.match(createPage, /firstName: normalizeAccountName\(firstName\),\s*lastName: normalizeAccountName\(lastName\)/);
  assert.match(createPage, /aria-invalid=\{invalidNameField === 'firstName' \|\| undefined\} aria-describedby=\{invalidNameField === 'firstName' \? accountNameErrorId : undefined\}/);
  assert.match(createPage, /aria-invalid=\{invalidNameField === 'lastName' \|\| undefined\} aria-describedby=\{invalidNameField === 'lastName' \? accountNameErrorId : undefined\}/);
  assert.match(createPage, /cause\.code === 'invalid_name'[\s\S]*setNameError\(cause\.message\)[\s\S]*lastNameInputRef\.current : firstNameInputRef\.current\)\?\.focus\(\)/);
});

test('self-service profile editing validates and normalizes certificate names accessibly', () => {
  const accountPage = source.slice(source.indexOf('export function AccountSecurityPage()'));
  assert.match(accountPage, /accountNameError\(firstName, 'First name'\)[\s\S]*firstNameInputRef\.current\?\.focus\(\)[\s\S]*accountNameError\(lastName, 'Last name'\)[\s\S]*lastNameInputRef\.current\?\.focus\(\)/);
  assert.match(accountPage, /firstName: normalizeAccountName\(firstName\),\s*lastName: normalizeAccountName\(lastName\)/);
  assert.match(accountPage, /aria-invalid=\{invalidProfileNameField === 'firstName' \|\| undefined\} aria-describedby=\{invalidProfileNameField === 'firstName' \? profileNameErrorId : undefined\}/);
  assert.match(accountPage, /aria-invalid=\{invalidProfileNameField === 'lastName' \|\| undefined\} aria-describedby=\{invalidProfileNameField === 'lastName' \? profileNameErrorId : undefined\}/);
  assert.match(accountPage, /cause\.code === 'invalid_name'[\s\S]*setProfileError\(cause\.message\)[\s\S]*lastNameInputRef\.current : firstNameInputRef\.current\)\?\.focus\(\)/);
});
