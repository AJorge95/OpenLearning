import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../../src/pages-manage.tsx', import.meta.url), 'utf8');

test('quiz pass-mark choices stay stable while authors edit quiz fields', () => {
  assert.match(source, /const QUIZ_PASS_MARK_OPTIONS: AppSelectOption<number>\[\] = \[50, 60, 70, 80, 90, 100\]/);
  assert.match(source, /ariaLabel=\{`Pass mark for \$\{quizContext\}`\} value=\{passMark\} onChange=\{setPassMark\} options=\{QUIZ_PASS_MARK_OPTIONS\}/);
});

test('account creation reuses the shared platform-role choices', () => {
  assert.match(source, /<AppSelect<Role> ariaLabel="Platform role" describedBy=\{roleHelpId\} value=\{role\} onChange=\{setRole\} disabled=\{saving\} options=\{ACCOUNT_ROLE_OPTIONS\}/);
});
