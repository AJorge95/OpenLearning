import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const styles = fs.readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');

test('learner program pages keep content inside the shared mobile gutters', () => {
  const baseRule = styles.match(/\.app-main > \.programs-page\s*\{([^}]*)\}/)?.[1];

  assert.ok(baseRule, 'expected learner program-page spacing');
  assert.match(baseRule, /padding:\s*58px 42px 84px;/);
  assert.match(baseRule, /margin-inline:\s*auto;/);

  const mobileRule = styles.match(/@media \(max-width: 720px\)\s*\{[\s\S]*?\.app-main > \.programs-page\s*\{([^}]*)\}/)?.[1];
  assert.ok(mobileRule, 'expected mobile learner program-page spacing');
  assert.match(mobileRule, /padding:\s*34px 16px 54px;/);
});
