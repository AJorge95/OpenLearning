import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const styles = fs.readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');

test('course-editor curriculum-add actions keep reliable targets at every responsive breakpoint', () => {
  const baseRule = styles.match(/\.module-add-actions > \.text-action\s*\{([^}]*)\}/)?.[1];
  const narrowRule = styles.match(/\.module-add-actions \.text-action\s*\{([^}]*)\}/)?.[1];

  assert.ok(baseRule, 'expected base curriculum-add action styles');
  assert.ok(narrowRule, 'expected narrow-layout curriculum-add action styles');
  assert.match(baseRule, /min-height:\s*40px/);
  assert.match(baseRule, /padding:\s*0 9px/);
  assert.match(narrowRule, /min-height:\s*40px/);
  assert.match(styles, /\.module-add-actions > \.text-action:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--purple\)/);
});
