import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const styles = fs.readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');
const managementSource = fs.readFileSync(new URL('../../src/pages-manage.tsx', import.meta.url), 'utf8');

test('course row menu options keep reliable touch targets and menu semantics', () => {
  const optionRule = styles.match(/\.row-menu-popover button, \.row-menu-popover a\s*\{([^}]+)\}/)?.[1];
  assert.ok(optionRule, 'expected explicit course row menu option styles');
  assert.match(optionRule, /min-height:\s*40px/);
  assert.doesNotMatch(optionRule, /min-height:\s*38px/);
  assert.match(managementSource, /<Link to=\{`\/manage\/courses\/\$\{course\.id\}\/access`\} role="menuitem"/);
  assert.match(managementSource, /<button type="button" role="menuitem"/);
});
