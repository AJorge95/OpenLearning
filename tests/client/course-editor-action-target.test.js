import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const styles = fs.readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');

test('keeps course editor reorder and delete controls easy to hit at every responsive breakpoint', () => {
  const targetRules = [...styles.matchAll(/\.module-tools button, \.lesson-tools button\s*\{([^}]*)\}/g)]
    .map((match) => match[1]);

  assert.equal(targetRules.length, 2, 'expected base and narrow-layout curriculum action rules');
  for (const rule of targetRules) {
    assert.match(rule, /width:\s*40px/);
    assert.match(rule, /height:\s*40px/);
  }
  assert.match(styles, /\.module-tools button:focus-visible, \.lesson-tools button:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--purple\)/);
});
