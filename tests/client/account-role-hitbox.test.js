import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const styles = fs.readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');

function rulesFor(selector) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rulePattern = new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`, 'g');
  return Array.from(styles.matchAll(rulePattern), (match) => match[1]);
}

test('account role hit area stays bounded by its visible trigger', () => {
  const roleControlRules = rulesFor('.account-role-control');
  const triggerRules = rulesFor('.account-role-control .app-select-trigger');
  const desktopSelectRules = rulesFor('.account-control-row .account-role-control > .account-role-select');

  assert.ok(roleControlRules.some((rule) => /pointer-events:\s*none/.test(rule)));
  assert.ok(triggerRules.some((rule) => /pointer-events:\s*auto/.test(rule)));
  assert.ok(desktopSelectRules.some((rule) => /width:\s*9rem/.test(rule) && /max-width:\s*9rem/.test(rule)));
  assert.match(styles, /@media \(max-width: 460px\) \{[\s\S]*?\.account-control-row \.account-role-control > \.account-role-select,\s*\.account-control-row \.account-role-control > \.account-role-select \.app-select-trigger \{ width: 100%; max-width: none; \}/);
});
