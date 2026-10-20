import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../../src/pages-manage.tsx', import.meta.url), 'utf8');

test('approving from the user list restores focus after the pending action disappears', () => {
  const pageStart = source.indexOf('export function AdminUsersPage()');
  const pageEnd = source.indexOf('\nexport function AdminUserCreatePage()', pageStart);
  const page = source.slice(pageStart, pageEnd);
  const handlerStart = page.indexOf('async function approveRegistration(user: User, trigger: HTMLButtonElement)');
  const handlerEnd = page.indexOf('\n  return <div className="management-page users-page"', handlerStart);
  const handler = page.slice(handlerStart, handlerEnd);

  assert.match(page, /onClick=\{\(event\) => approveRegistration\(user, event\.currentTarget\)\}/);
  assert.match(handler, /document\.activeElement === trigger/);
  assert.match(handler, /window\.requestAnimationFrame\(\(\) => \{[\s\S]*?if \(!trigger\.isConnected && focusWasDropped && searchInput\?\.isConnected\) searchInput\.focus\(\);/);
});

test('approving from account details restores focus to the overview heading', () => {
  const pageStart = source.indexOf('export function AdminUserDetailsPage()');
  const pageEnd = source.indexOf('\nexport function AdminSettingsPage()', pageStart);
  const page = source.slice(pageStart, pageEnd);
  const handlerStart = page.indexOf('async function approveRegistration(trigger: HTMLButtonElement)');
  const handlerEnd = page.indexOf('\n  async function resetPassword(', handlerStart);
  const handler = page.slice(handlerStart, handlerEnd);

  assert.match(page, /onClick=\{\(event\) => approveRegistration\(event\.currentTarget\)\}/);
  assert.match(page, /<h2 ref=\{accountOverviewHeadingRef\} id="account-overview-heading"[^>]*tabIndex=\{-1\}>Account overview<\/h2>/);
  assert.match(handler, /document\.activeElement === trigger/);
  assert.match(handler, /window\.requestAnimationFrame\(\(\) => \{[\s\S]*?if \(!trigger\.isConnected && focusWasDropped && heading\?\.isConnected\) heading\.focus\(\);/);
});
