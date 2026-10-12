import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const sourceRoot = path.resolve('src');
const componentsSource = fs.readFileSync(path.join(sourceRoot, 'components.tsx'), 'utf8');
const usersPageSource = fs.readFileSync(path.join(sourceRoot, 'pages-manage.tsx'), 'utf8');

test('custom selects can expose an in-progress state while disabled', () => {
  assert.match(componentsSource, /disabled\?: boolean;\s*busy\?: boolean;/);
  assert.match(componentsSource, /disabled = false, busy = false/);
  assert.match(componentsSource, /aria-busy=\{busy \|\| undefined\}/);
});

test('administrator account actions communicate row-level progress', () => {
  assert.match(usersPageSource, /value=\{user\.role\} disabled=\{savingIds\.has\(user\.id\) \|\| user\.isLastActiveAdmin\} busy=\{savingIds\.has\(user\.id\)\}/);
  assert.match(usersPageSource, /aria-busy=\{savingIds\.has\(user\.id\) \|\| undefined\} disabled=\{savingIds\.has\(user\.id\)\} onClick=\{\(event\) => openPasswordReset\(user, event\.currentTarget\)\}>\{savingIds\.has\(user\.id\) \? 'Resetting…' : 'Reset password'\}/);
  assert.match(usersPageSource, /aria-label=\{savingIds\.has\(user\.id\) \? `Saving account changes for \$\{user\.username\}` : `\$\{user\.disabled \? 'Enable' : 'Disable'\} account for \$\{user\.username\}`\}/);
  assert.match(usersPageSource, /\{savingIds\.has\(user\.id\) \? 'Saving…' : user\.disabled \? 'Enable' : 'Disable'\}/);
});

test('account-detail role changes expose the same busy state', () => {
  assert.match(usersPageSource, /controlId="account-platform-role"[\s\S]*?disabled=\{saving \|\| user\.isLastActiveAdmin\} busy=\{saving\}/);
});
