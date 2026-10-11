import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src');
const componentsSource = fs.readFileSync(path.join(sourceRoot, 'components.tsx'), 'utf8');
const managementSource = fs.readFileSync(path.join(sourceRoot, 'pages-manage.tsx'), 'utf8');
const navigationEventsSource = fs.readFileSync(path.join(sourceRoot, 'admin-navigation-events.ts'), 'utf8');
const styles = fs.readFileSync(path.join(sourceRoot, 'styles.css'), 'utf8');
const staffShellSource = componentsSource.slice(
  componentsSource.indexOf('export function StaffFrame()'),
  componentsSource.indexOf('export function PageHeading('),
);

test('admin navigation loads and refreshes the pending registration count', () => {
  assert.ok(staffShellSource.includes("user?.role !== 'admin'"));
  assert.ok(staffShellSource.includes("api.get<{ count: number }>('/api/admin/users/pending-count', { signal: controller.signal })"));
  assert.ok(staffShellSource.includes("window.addEventListener('focus', refresh)"));
  assert.ok(staffShellSource.includes('window.addEventListener(pendingRegistrationCountChangedEvent, refresh)'));
  assert.ok(staffShellSource.includes('requestController?.abort()'));
  assert.ok(staffShellSource.includes('Number.isSafeInteger(result.count)'));
  assert.ok(staffShellSource.includes('setPendingRegistrationCountUnavailable(true)'));
  assert.ok(staffShellSource.includes('setPendingRegistrationCountUnavailable(!countIsValid)'));
  assert.match(staffShellSource, /if \(!controller\.signal\.aborted\) \{\s*setPendingRegistrationCount\(null\);\s*setPendingRegistrationCountUnavailable\(true\);\s*\}/);
});

test('pending approvals badge is accessible and both approval flows refresh it', () => {
  assert.ok(staffShellSource.includes("'Users, pending registration count unavailable'"));
  assert.ok(staffShellSource.includes('aria-label={pendingRegistrationCountLabel}'));
  assert.ok(staffShellSource.includes('staff-nav-count-unavailable'));
  assert.ok(staffShellSource.includes("`Users, ${formatCountLabel(pendingRegistrationCount, 'pending registration', 'pending registrations')}`"));
  assert.ok(staffShellSource.includes("{pendingRegistrationCount > 99 ? '99+' : pendingRegistrationCount}"));
  assert.equal((managementSource.match(/notifyPendingRegistrationCountChanged\(\)/g) || []).length, 2);
  assert.match(navigationEventsSource, /window\.dispatchEvent\(new Event\(pendingRegistrationCountChangedEvent\)\)/);
  assert.match(styles, /\.staff-nav-count\s*\{[^}]*margin-left:\s*auto;[^}]*border-radius:\s*999px;[^}]*color:\s*var\(--purple-dark\);[^}]*background:\s*var\(--purple-soft\);/);
  assert.match(styles, /\.staff-nav-count-unavailable\s*\{\s*color: #8b5700; background: #fff5df;\s*\}/);
});
