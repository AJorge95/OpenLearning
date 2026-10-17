import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../../src/pages-auth.tsx', import.meta.url), 'utf8');
const setupPage = source.slice(source.indexOf('export function SetupPage()'), source.indexOf('function BookOpenMark()'));

test('setup returns username conflicts to the named username field', () => {
  assert.match(setupPage, /cause\.code === 'username_taken'[\s\S]*setSetupUsernameError\(cause\.message\)[\s\S]*setStep\(1\)[\s\S]*setupUsernameInputRef\.current\?\.focus\(\)/);
  assert.match(setupPage, /aria-invalid=\{setupUsernameError \? true : undefined\}/);
  assert.match(setupPage, /aria-describedby=\{setupUsernameError \? `\$\{setupUsernameHelpId\} \$\{setupUsernameErrorId\}` : setupUsernameHelpId\}/);
  assert.match(setupPage, /id=\{setupUsernameErrorId\} className="form-error" role="alert"/);
  assert.match(setupPage, /setUsername\(event\.target\.value\); setSetupUsernameError\(''\)/);
});

test('setup treats duplicate email as an email-field error', () => {
  assert.match(setupPage, /cause\.code === 'invalid_email' \|\| cause\.code === 'email_taken'[\s\S]*setEmailError\(cause\.message\)[\s\S]*setStep\(1\)[\s\S]*setupEmailInputRef\.current\?\.focus\(\)/);
});
