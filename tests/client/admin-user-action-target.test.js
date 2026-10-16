import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../../src/pages-manage.tsx', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');

test('administrator account actions keep reliable row targets and state semantics', () => {
  const rowActions = source.match(/<div className="user-row-actions">[\s\S]*?<\/div><\/td>/)?.[0];
  assert.ok(rowActions, 'expected the administrator account action group');
  assert.match(rowActions, /<Link className="text-action" to=\{`\/admin\/users\/\$\{user\.id\}`\} aria-label=\{`Details for \$\{user\.username\}`\}/);
  assert.match(rowActions, /aria-busy=\{savingIds\.has\(user\.id\) \|\| undefined\} disabled=\{savingIds\.has\(user\.id\)\}/);
  assert.match(rowActions, /user\.disabled \? 'text-action' : 'text-action danger-text'/);

  const targetRule = styles.match(/\.user-row-actions \.text-action\s*\{([^}]*)\}/)?.[1];
  assert.ok(targetRule, 'expected explicit administrator account action styles');
  assert.match(targetRule, /min-height:\s*40px/);
  assert.match(targetRule, /padding:\s*0 7px/);
  assert.match(styles, /\.user-row-actions \.text-action\.danger-text:hover:not\(:disabled\)\s*\{[^}]*color:\s*var\(--danger\)/);
  assert.match(styles, /\.user-row-actions \.text-action:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--purple\)/);
});
