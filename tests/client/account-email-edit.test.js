import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { validateEmail } from '../../src/email-validation.ts';

const sourceDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src');
const accountPageSource = fs.readFileSync(path.join(sourceDirectory, 'pages-manage.tsx'), 'utf8')
  .split('export function AdminUserDetailsPage()')[1]
  .split('export function AdminSettingsPage()')[0];

test('administrator account email editing uses the shared email rules', () => {
  assert.equal(validateEmail(' person@example.invalid '), null);
  assert.ok(validateEmail('not-an-email'));
  assert.ok(validateEmail('a'.repeat(245) + '@example.invalid'));

  assert.match(accountPageSource, /<form className="account-profile-form account-email-form form-stack" onSubmit=\{saveAccountEmail\} noValidate/);
  assert.match(accountPageSource, /<label>Email address<input ref=\{accountEmailInputRef\} name="email" type="email" required maxLength=\{254\} autoComplete="email"/);
  assert.match(accountPageSource, /aria-invalid=\{Boolean\(accountEmailError\) \|\| undefined\} aria-describedby=\{accountEmailError \? accountEmailErrorId : undefined\}/);
  assert.match(accountPageSource, /saveAccountEmail[\s\S]*?validateEmail\(accountEmail\)[\s\S]*?setAccountEmailError\(emailError\)[\s\S]*?accountEmailInputRef\.current\?\.focus\(\)[\s\S]*?email: accountEmail\.trim\(\)/);
});

test('administrator account email conflicts return to the named email field', () => {
  assert.match(accountPageSource, /cause\.code === 'invalid_email' \|\| cause\.code === 'email_taken'[\s\S]*?changes\.email !== undefined[\s\S]*?setAccountEmailError\(cause\.message\)[\s\S]*?accountEmailInputRef\.current\?\.focus\(\)/);
  assert.match(accountPageSource, /disabled=\{saving \|\| !accountEmailReady \|\| !accountEmailChanged\}/);
  assert.match(accountPageSource, /signedInUser\.email !== response\.user\.email/);
});
