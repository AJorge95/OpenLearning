import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const manageSource = fs.readFileSync(new URL('../../src/pages-manage.tsx', import.meta.url), 'utf8');
const accountPage = manageSource.slice(
  manageSource.indexOf('export function AdminUserDetailsPage()'),
  manageSource.indexOf('export function AdminSettingsPage()'),
);

test('administrator account-detail required fields show decorative cues without changing native semantics', () => {
  assert.match(accountPage, /<label><span className="form-label-row"><span>Email address<\/span><small className="form-required-indicator" aria-hidden="true">Required<\/small><\/span><input[^>]*name="email"[^>]*required/);
  assert.match(accountPage, /<label><span className="form-label-row"><span>First name<\/span><small className="form-required-indicator" aria-hidden="true">Required<\/small><\/span><input[^>]*name="firstName"[^>]*required/);
  assert.match(accountPage, /<label><span className="form-label-row"><span>Last name<\/span><small className="form-required-indicator" aria-hidden="true">Required<\/small><\/span><input[^>]*name="lastName"[^>]*required/);
  assert.match(accountPage, /aria-describedby=\{accountEmailError \? `\$\{accountEmailHelpId\} \$\{accountEmailErrorId\}` : accountEmailHelpId\}/);
  assert.match(accountPage, /aria-describedby=\{invalidCertificateNameField === 'firstName' \? certificateNameErrorId : undefined\}/);
  assert.match(accountPage, /aria-describedby=\{invalidCertificateNameField === 'lastName' \? certificateNameErrorId : undefined\}/);
});
