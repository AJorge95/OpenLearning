import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../../src/pages-manage.tsx', import.meta.url), 'utf8');
const authSource = fs.readFileSync(new URL('../../src/pages-auth.tsx', import.meta.url), 'utf8');
const brandingSource = fs.readFileSync(new URL('../../src/branding.ts', import.meta.url), 'utf8');

test('quiz pass-mark choices stay stable while authors edit quiz fields', () => {
  assert.match(source, /const QUIZ_PASS_MARK_OPTIONS: AppSelectOption<number>\[\] = \[50, 60, 70, 80, 90, 100\]/);
  assert.match(source, /ariaLabel=\{`Pass mark for \$\{quizContext\}`\} value=\{passMark\} onChange=\{setPassMark\} options=\{QUIZ_PASS_MARK_OPTIONS\}/);
});

test('account creation reuses the shared platform-role choices', () => {
  assert.match(source, /<AppSelect<Role> ariaLabel="Platform role" describedBy=\{roleHelpId\} value=\{role\} onChange=\{setRole\} disabled=\{saving\} options=\{ACCOUNT_ROLE_OPTIONS\}/);
});

test('setup and admin settings reuse the shared connection protocol choices', () => {
  assert.match(brandingSource, /CONNECTION_PROTOCOL_OPTIONS: \{ value: ConnectionProtocol; label: string \}\[\] = \[[\s\S]*?value: 'http', label: 'HTTP'[\s\S]*?value: 'https', label: 'HTTPS'/);
  assert.match(authSource, /ariaLabel="Public connection protocol" describedBy="setup-protocol-help" value=\{connectionProtocol\} onChange=\{setConnectionProtocol\} disabled=\{saving\} options=\{CONNECTION_PROTOCOL_OPTIONS\}/);
  assert.match(source, /ariaLabel="Public connection protocol" describedBy="protocol-help" value=\{protocol\} onChange=\{setProtocol\} options=\{CONNECTION_PROTOCOL_OPTIONS\}/);
});
