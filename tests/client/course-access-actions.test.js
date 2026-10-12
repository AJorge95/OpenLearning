import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { courseAccessAction } from '../../src/course-access-action.ts';

test('active learners can be assigned and unassigned', () => {
  assert.equal(courseAccessAction({ disabled: false, granted: false }), 'assign');
  assert.equal(courseAccessAction({ disabled: false, granted: true }), 'unassign');
});

test('disabled learners cannot be assigned but existing grants remain revocable', () => {
  assert.equal(courseAccessAction({ disabled: true, granted: false }), null);
  assert.equal(courseAccessAction({ disabled: true, granted: true }), 'unassign');
});

test('the course access row keeps disabled state and exposes only its valid action', () => {
  const source = fs.readFileSync(new URL('../../src/pages-manage.tsx', import.meta.url), 'utf8');
  const styles = fs.readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');
  const start = source.indexOf('const assignmentAction = courseAccessAction(learner)');
  const end = source.indexOf('</li>;', start);
  const row = source.slice(start, end);

  assert.ok(start >= 0 && end > start, 'expected the course access learner row');
  assert.match(row, /learner\.disabled && <span className="muted">Account disabled<\/span>/);
  assert.match(row, /assignmentAction && <button[\s\S]*?disabled=\{savingIds\.has\(learner\.id\)\}/);
  assert.match(row, /aria-label=\{unassign \? `Unassign \$\{learner\.username\} from \$\{course\?\.title \|\| 'this course'\}`/);
  assert.match(styles, /\.access-row-actions\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;/);
});
