import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const pageSource = fs.readFileSync(new URL('../../src/pages-auth.tsx', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');
const accountSettingsPage = pageSource.slice(pageSource.indexOf('export function AccountSecurityPage()'));

test('account email keeps copy support while exposing its administrator-managed state', () => {
  assert.match(accountSettingsPage, /<label className="profile-email-field">Email<input type="email" value=\{user\?\.email \|\| ''\} readOnly aria-readonly="true" aria-describedby="profile-email-help" \/><\/label>/);
  assert.match(accountSettingsPage, /Contact an administrator if you need to change your email address\./);
  assert.match(styles, /\.account-settings-page \.profile-email-field input\[readonly\]\s*\{[^}]*color:\s*var\(--muted\);[^}]*background:\s*var\(--subtle\);[^}]*cursor:\s*text;/);
});
