import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const styles = fs.readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');

test('quiz-editor answer and explanation fields keep a reliable 40px target', () => {
  const answerRule = styles.match(/\.choice-editor-row input:not\(\[type="radio"\]\)\s*\{([^}]*)\}/)?.[1];
  const explanationRule = styles.match(/\.explanation-label input\s*\{([^}]*)\}/)?.[1];

  assert.ok(answerRule, 'expected answer-choice input styles');
  assert.ok(explanationRule, 'expected explanation input styles');
  assert.match(answerRule, /min-height:\s*40px/);
  assert.match(explanationRule, /min-height:\s*40px/);
  assert.match(styles, /Keep editable quiz answers aligned with the surrounding 40px editor controls\./);
});
