import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const styles = fs.readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');
const accountPage = fs.readFileSync(new URL('../../src/pages-manage.tsx', import.meta.url), 'utf8');

function rulesFor(selector) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rulePattern = new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`, 'g');
  return Array.from(styles.matchAll(rulePattern), (match) => match[1]);
}

test('account role hit area stays bounded by its visible trigger', () => {
  const roleControlRules = rulesFor('.account-role-control');
  const selectControlRules = rulesFor('.account-role-select-control');
  const appSelectRules = rulesFor('.account-role-select-control .app-select');
  const triggerRules = rulesFor('.account-role-select-control .app-select-trigger');

  assert.ok(roleControlRules.some((rule) => /pointer-events:\s*none/.test(rule)));
  assert.ok(selectControlRules.some((rule) => /width:\s*8\.5rem/.test(rule) && /pointer-events:\s*none/.test(rule)));
  assert.ok(appSelectRules.some((rule) => /width:\s*100%/.test(rule) && /max-width:\s*none/.test(rule) && /pointer-events:\s*none/.test(rule)));
  assert.ok(triggerRules.some((rule) => /pointer-events:\s*auto/.test(rule)));
  assert.match(styles, /@media \(max-width: 460px\) \{[\s\S]*?\.account-control-row \.account-role-select-control,\s*\.account-control-row \.account-role-select-control \.app-select \{ width: 100%; max-width: none; \}/);
});

test('account role caption stays separate from the clickable custom selector', () => {
  const roleField = accountPage.match(/<div className="account-role-control">[\s\S]*?<\/div><\/div>/)?.[0];

  assert.ok(roleField, 'expected a bounded account role field');
  assert.match(roleField, /<span id="account-platform-role-label">Platform role<\/span>/);
  assert.match(roleField, /<div className="account-role-select-control"><AppSelect<Role>[\s\S]*ariaLabelledBy="account-platform-role-label"[\s\S]*matchTriggerWidth/);
  assert.doesNotMatch(roleField, /<label\b/, 'the caption must not forward clicks from blank space into the selector');
});

test('a mounted label-wrapped role selector stays bounded during a stylesheet update', () => {
  const legacyLabelRules = rulesFor('.account-control-row > label');
  const legacySelectRules = rulesFor('.account-control-row > label > .app-select');
  const legacyTriggerRules = rulesFor('.account-control-row > label .app-select-trigger');

  assert.ok(legacyLabelRules.some((rule) => /flex:\s*0 0 8\.5rem/.test(rule) && /width:\s*8\.5rem/.test(rule) && /pointer-events:\s*none/.test(rule)));
  assert.ok(legacySelectRules.some((rule) => /width:\s*100%/.test(rule) && /pointer-events:\s*none/.test(rule)));
  assert.ok(legacyTriggerRules.some((rule) => /pointer-events:\s*auto/.test(rule)));
  assert.ok(legacyLabelRules.some((rule) => /flex-basis:\s*auto/.test(rule) && /width:\s*100%/.test(rule) && /max-width:\s*none/.test(rule)), 'the mobile layout should keep its full-width selector');
});
