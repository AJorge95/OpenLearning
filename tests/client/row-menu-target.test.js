import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../../src/pages-manage.tsx', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');

test('course row menus keep a named action and a reliable compact target', () => {
  const rowMenu = source.match(/<button ref=\{triggerRef\}[^>]*className="row-menu-trigger"[\s\S]*?<\/button>/)?.[0];
  assert.ok(rowMenu, 'expected the course row menu trigger');
  assert.match(rowMenu, /aria-label=\{`More actions for \$\{course\.title\}`\}/);
  assert.match(rowMenu, /aria-haspopup="menu"/);
  assert.match(rowMenu, /aria-expanded=\{open\}/);

  const triggerRule = styles.match(/\.row-menu-trigger\s*\{([^}]*)\}/)?.[1];
  assert.ok(triggerRule, 'expected explicit course row menu trigger styles');
  assert.match(triggerRule, /width:\s*40px/);
  assert.match(triggerRule, /height:\s*40px/);
  assert.match(styles, /\.row-menu-trigger:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--purple\)/);
});
