import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const styles = fs.readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');

test('course row menu keyboard focus has a distinct visible outline', () => {
  const hoverRule = styles.match(/\.row-menu-popover button:hover, \.row-menu-popover a:hover\s*\{([^}]+)\}/);
  const focusRule = styles.match(/\.row-menu-popover \[role="menuitem"\]:focus-visible\s*\{([^}]+)\}/);

  assert.ok(hoverRule, 'expected hover styling to remain on pointer interactions');
  assert.ok(focusRule, 'expected a separate focus-visible rule for menu items');
  assert.doesNotMatch(hoverRule[1], /outline\s*:\s*(?:none|0)/);
  assert.match(focusRule[1], /outline:\s*2px solid var\(--purple\)/);
  assert.match(focusRule[1], /outline-offset:\s*-2px/);
});
