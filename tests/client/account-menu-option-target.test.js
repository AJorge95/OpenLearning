import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const styles = fs.readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');
const source = fs.readFileSync(new URL('../../src/components.tsx', import.meta.url), 'utf8');

test('learner account-menu options keep reliable targets and visible focus', () => {
  const optionRule = styles.match(/\.user-menu-popover a, \.menu-signout\s*\{([^}]*)\}/)?.[1];
  assert.ok(optionRule, 'expected shared account-menu option styles');
  assert.match(optionRule, /display:\s*flex/);
  assert.match(optionRule, /align-items:\s*center/);
  assert.match(optionRule, /min-height:\s*40px/);

  const focusRule = styles.match(/\.user-menu-popover a:focus-visible, \.menu-signout:focus-visible\s*\{([^}]*)\}/)?.[1];
  assert.ok(focusRule, 'expected a local keyboard focus rule for account-menu options');
  assert.match(focusRule, /outline:\s*2px solid var\(--purple\)/);
  assert.match(focusRule, /outline-offset:\s*-2px/);
  assert.match(source, /<button type="button" className="menu-signout"/);
  assert.match(source, /<Link to="\/account\/security">Account settings<\/Link>/);
});
