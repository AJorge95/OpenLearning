import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { validateEmail } from '../../src/email-validation.ts';

const source = fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/pages-auth.tsx'),
  'utf8',
);

test('email validation matches the server rules and trims surrounding whitespace', () => {
  assert.equal(validateEmail(' person+course@example.co.uk '), null);
  assert.equal(validateEmail('a'.repeat(64) + '@example.com'), null);
  assert.equal(validateEmail('a'.repeat(65) + '@example.com'), 'Enter a valid email address (up to 254 characters).');
  assert.equal(validateEmail(`a@${Array(4).fill('b'.repeat(63)).join('.')}`), 'Enter a valid email address (up to 254 characters).');
  assert.equal(validateEmail('learner@localhost'), 'Enter a valid email address (up to 254 characters).');
  assert.equal(validateEmail('learner@-example.com'), 'Enter a valid email address (up to 254 characters).');
  assert.equal(validateEmail('learner@example-.com'), 'Enter a valid email address (up to 254 characters).');
  assert.equal(validateEmail('learner@example..com'), 'Enter a valid email address (up to 254 characters).');
  assert.equal(validateEmail(`learner@${'a'.repeat(64)}.com`), 'Enter a valid email address (up to 254 characters).');
  assert.equal(validateEmail('learner@@example.com'), 'Enter a valid email address (up to 254 characters).');
  assert.equal(validateEmail(null), 'Enter a valid email address (up to 254 characters).');
});

test('setup validates the email while its field is visible and restores it if the server rejects it', () => {
  const setupPage = source.slice(source.indexOf('export function SetupPage()'), source.indexOf('function BookOpenMark()'));
  assert.match(setupPage, /const currentEmailError = validateEmail\(email\);[\s\S]*setupEmailInputRef\.current\?\.focus\(\)\);[\s\S]*setStep\(2\)/);
  assert.match(setupPage, /cause\.code === 'invalid_email'[\s\S]*setStep\(1\)[\s\S]*setupEmailInputRef\.current\?\.focus\(\)\)/);
  assert.match(setupPage, /aria-invalid=\{emailError \? true : undefined\} aria-describedby=\{emailError \? setupEmailErrorId : undefined\}/);
});

test('registration validates email before submission and associates errors with the field', () => {
  const registerPage = source.slice(source.indexOf('export function RegisterPage()'), source.indexOf('export function AccountSecurityPage()'));
  assert.match(registerPage, /const currentEmailError = validateEmail\(email\);[\s\S]*emailInputRef\.current\?\.focus\(\)\);[\s\S]*signUp\(email/);
  assert.match(registerPage, /cause\.code === 'invalid_email'[\s\S]*emailInputRef\.current\?\.focus\(\)\)/);
  assert.match(registerPage, /aria-invalid=\{emailError \? true : undefined\} aria-describedby=\{emailError \? emailErrorId : undefined\}/);
});
