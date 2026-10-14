import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const source = fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/pages-manage.tsx'),
  'utf8',
);
const createPage = source.slice(
  source.indexOf('export function AdminUserCreatePage()'),
  source.indexOf('export function AdminUserDetailsPage()'),
);

test('administrator account creation validates email before sending and focuses invalid values', () => {
  assert.match(createPage, /const currentEmailError = validateEmail\(email\);[\s\S]*setEmailError\(currentEmailError\)[\s\S]*emailInputRef\.current\?\.focus\(\)/);
  assert.match(createPage, /ref=\{emailInputRef\}[\s\S]*aria-invalid=\{emailError \? true : undefined\}[\s\S]*aria-describedby=\{emailError \? accountEmailErrorId : undefined\}/);
  assert.match(createPage, /emailError && <p id=\{accountEmailErrorId\} className="form-error" role="alert">\{emailError\}<\/p>/);
  assert.match(createPage, /setEmail\(event\.target\.value\); setEmailError\(''\)/);
});

test('administrator account creation associates server identifier conflicts with the matching field', () => {
  assert.match(createPage, /cause\.code === 'invalid_email' \|\| cause\.code === 'email_taken'[\s\S]*setEmailError\(cause\.message\)[\s\S]*emailInputRef\.current\?\.focus\(\)/);
  assert.match(createPage, /cause\.code === 'username_taken'[\s\S]*setUsernameError\(cause\.message\)[\s\S]*usernameInputRef\.current\?\.focus\(\)/);
  assert.match(createPage, /ref=\{usernameInputRef\}[\s\S]*aria-invalid=\{usernameError \? true : undefined\}[\s\S]*aria-describedby=\{usernameError \? accountUsernameErrorId : undefined\}/);
  assert.match(createPage, /usernameError && <p id=\{accountUsernameErrorId\} className="form-error" role="alert">\{usernameError\}<\/p>/);
  assert.match(createPage, /setUsername\(event\.target\.value\); setUsernameError\(''\)/);
});
