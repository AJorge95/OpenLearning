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
  const selectControlRules = rulesFor('.account-role-select-control');
  const selectRules = rulesFor('.account-role-select');

  assert.ok(roleControlRules.some((rule) => /pointer-events:\s*none/.test(rule)));
  assert.ok(selectControlRules.some((rule) => /width:\s*8\.5rem/.test(rule) && /pointer-events:\s*auto/.test(rule)));
  assert.ok(selectRules.some((rule) => /width:\s*100%/.test(rule) && /max-width:\s*100%/.test(rule) && /appearance:\s*none/.test(rule)));
  assert.match(styles, /@media \(max-width: 460px\) \{[\s\S]*?\.account-control-row \.account-role-select-control,\s*\.account-control-row \.account-role-select \{ width: 100%; max-width: none; \}/);
});
