import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../../src/pages-manage.tsx', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');
const page = source.slice(source.indexOf('export function AdminRegistrationFieldsPage()'));

test('registration-field removal keeps its accessible destructive action and 40px target', () => {
  assert.match(page, /<Button type="button" variant="quiet" className="registration-field-remove"/);
  assert.match(page, /aria-label=\{`Remove \$\{field\.label \|\| `field \$\{index \+ 1\}`\}`\}/);
  const rule = styles.match(/\.registration-field-remove \{(?=[^}]*min-height:\s*40px)[^}]*\}/)?.[0];
  assert.ok(rule, 'expected the registration-field removal rule');
  assert.match(rule, /min-height:\s*40px/);
  assert.match(rule, /padding:\s*0 8px/);
  assert.match(styles, /\.registration-field-remove:focus-visible \{[^}]*outline:\s*2px solid var\(--purple\)/);
});

test('registration-field removal remains visible in forced-colors mode', () => {
  assert.match(styles, /\.registration-field-remove \{ color: ButtonText; \}/);
  assert.match(styles, /\.registration-field-remove:hover:not\(:disabled\), \.registration-field-remove:focus-visible \{[^}]*background: Highlight/);
});
