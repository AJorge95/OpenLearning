import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const styles = fs.readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');
const source = fs.readFileSync(new URL('../../src/components.tsx', import.meta.url), 'utf8');

test('learner account-menu trigger keeps a reliable target and visible focus', () => {
  const triggerRule = styles.match(/\.user-menu summary\s*\{([^}]*)\}/)?.[1];
  assert.ok(triggerRule, 'expected a shared account-menu trigger rule');
  assert.match(triggerRule, /min-width:\s*40px/);
  assert.match(triggerRule, /min-height:\s*40px/);

  const focusRule = styles.match(/\.user-menu summary:focus-visible\s*\{([^}]*)\}/)?.[1];
  assert.ok(focusRule, 'expected a visible keyboard focus rule for the account-menu trigger');
  assert.match(focusRule, /outline:\s*2px solid var\(--purple\)/);
  assert.match(styles, /\.user-menu summary\s*\{\s*justify-content:\s*center;\s*gap:\s*0;/);
  assert.match(source, /<summary role="button" aria-label=\{user\?\.username/);
  assert.match(source, /Open account menu for \$\{user\.username\}/);
});
