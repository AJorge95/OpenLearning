import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const styles = fs.readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');

test('learner lesson feedback actions keep reliable touch targets', () => {
  const targetRules = [
    ['.lesson-reactions .button', /\.lesson-reactions \.button\s*\{([^}]+)\}/],
    ['.lesson-comment-form .button', /\.lesson-comment-form \.button\s*\{([^}]+)\}/],
    ['.load-comments-button', /\.load-comments-button\s*\{([^}]+)\}/],
  ];

  for (const [selector, pattern] of targetRules) {
    const rule = styles.match(pattern)?.[1];
    assert.ok(rule, `expected explicit styles for ${selector}`);
    assert.match(rule, /min-height:\s*40px/);
  }
});
