import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src');
const authSource = fs.readFileSync(path.join(sourceRoot, 'pages-auth.tsx'), 'utf8');
const managementSource = fs.readFileSync(path.join(sourceRoot, 'pages-manage.tsx'), 'utf8');
const authContextSource = fs.readFileSync(path.join(sourceRoot, 'auth-context.tsx'), 'utf8');

test('pending registration does not sign in and shows an approval confirmation', () => {
  const registerPage = authSource.slice(
    authSource.indexOf('export function RegisterPage()'),
    authSource.indexOf('export function AccountSecurityPage()'),
  );
  const signUp = authContextSource.slice(
    authContextSource.indexOf('const signUp = useCallback('),
    authContextSource.indexOf('const completeSetup = useCallback('),
  );

  assert.ok(registerPage.includes('if (result.approvalRequired) { setApprovalSubmitted(true); return; }'));
  assert.ok(registerPage.includes('const approvalConfirmationHeadingRef = useRef<HTMLHeadingElement>(null);'));
  assert.match(registerPage, /if \(approvalSubmitted\) approvalConfirmationHeadingRef\.current\?\.focus\(\);/);
  assert.ok(registerPage.includes('<h1 ref={approvalConfirmationHeadingRef} tabIndex={-1}>Registration submitted</h1>'));
  assert.ok(registerPage.includes('Your account is waiting for administrator approval. You can sign in after it has been approved.'));
  assert.match(signUp, /if \(!approvalRequired\)\s*\{[\s\S]*?setUser\(result\.user\);/);
});

test('administrators can filter for and approve pending accounts', () => {
  assert.ok(managementSource.includes('ariaLabel="Filter by registration approval"'));
  assert.ok(managementSource.includes("{ value: 'pending', label: 'Pending approval' }"));
  assert.ok(managementSource.includes("params.set('registrationStatus', requestedApprovalFilter)"));
  assert.ok(managementSource.includes('user.registrationStatus === \'pending\' ? \'Pending approval\''));
  assert.ok(managementSource.includes('aria-label={`Approve registration for ${user.username}`}'));
  assert.ok(managementSource.includes('Registration could not be approved.'));
  assert.ok(managementSource.includes('No registrations are waiting for approval.'));
});

test('platform settings expose the approval policy through a labeled checkbox', () => {
  assert.ok(managementSource.includes('<strong>Require admin approval for new registrations</strong>'));
  assert.ok(managementSource.includes('checked={requireRegistrationApproval}'));
  assert.ok(managementSource.includes('registrationApprovalRequired: requireRegistrationApproval'));
});
