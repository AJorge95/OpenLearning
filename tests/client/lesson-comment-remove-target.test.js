import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const styles = fs.readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');

test('course-manager comment removal keeps a reliable target and visible focus', () => {
  const rule = styles.match(/\.lesson-comment-remove\s*\{([^}]+)\}/)?.[1];

  assert.ok(rule, 'expected the comment removal action styles');
  assert.match(rule, /min-height:\s*40px/);
  assert.match(rule, /padding:\s*0 9px/);
  assert.match(styles, /\.lesson-comment-remove:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--purple\)/);
});
