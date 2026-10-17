import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const styles = fs.readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');

test('course-editor correct-answer radios have a 24px square pointer target', () => {
  const radioRule = styles.match(/\.choice-editor-row input\[type="radio"\]\s*\{([^}]*)\}/)?.[1];

  assert.ok(radioRule, 'expected correct-answer radio styles');
  assert.match(radioRule, /width:\s*24px/);
  assert.match(radioRule, /height:\s*24px/);
  assert.match(radioRule, /min-height:\s*24px/);
  assert.match(radioRule, /appearance:\s*auto/);
  assert.match(radioRule, /padding:\s*0/);
});
