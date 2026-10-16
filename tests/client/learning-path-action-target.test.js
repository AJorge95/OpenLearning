import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const styles = fs.readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');

test('learning-path card actions keep reliable touch targets and visible focus', () => {
  const courseActionRule = styles.match(/\.path-course-list > li > \.text-action\s*\{([^}]*)\}/)?.[1];
  const assignmentActionRule = styles.match(/\.path-assigned-learners \.text-action\s*\{([^}]*)\}/)?.[1];

  assert.ok(courseActionRule, 'expected learning-path course action styles');
  assert.ok(assignmentActionRule, 'expected assigned learner action styles');
  assert.match(courseActionRule, /min-height:\s*40px/);
  assert.match(assignmentActionRule, /min-height:\s*40px/);
  assert.match(styles, /\.path-course-list > li > \.text-action:focus-visible, \.path-assigned-learners \.text-action:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--purple\)/);
});
