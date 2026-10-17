import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const styles = fs.readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');

test('keeps learning-path reorder controls easy to hit and visible in high contrast', () => {
  const targetRule = [...styles.matchAll(/\.path-reorder-buttons button\s*\{([^}]*)\}/g)]
    .map((match) => match[1])
    .find((rule) => /width:\s*40px/.test(rule));

  assert.ok(targetRule, 'expected learning-path reorder button styles');
  assert.match(targetRule, /width:\s*40px/);
  assert.match(targetRule, /height:\s*40px/);
  assert.match(styles, /\.path-reorder-buttons button:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--purple\)/);
  assert.match(styles, /\.path-reorder-buttons button \{ color: ButtonText; border-color: ButtonText; background: ButtonFace; \}/);
  assert.match(styles, /\.path-reorder-buttons button:hover:not\(:disabled\), \.path-reorder-buttons button:focus-visible\s*\{[^}]*background: Highlight/);
});
