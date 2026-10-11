import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { MAX_LEARNING_PATH_COURSES } from '../../shared/learning-path-limits.js';
import { isPathCourseCheckboxDisabled, togglePathCourseSelection } from '../../src/path-course-selection.ts';

const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('learning-path course selection shares the server limit and keeps selected courses removable', () => {
  const selected = Array.from({ length: MAX_LEARNING_PATH_COURSES }, (_, index) => ({
    courseId: `course-${index}`,
    requiresPrevious: index > 0,
  }));

  assert.equal(MAX_LEARNING_PATH_COURSES, 200);
  assert.equal(isPathCourseCheckboxDisabled(MAX_LEARNING_PATH_COURSES - 1, false), false);
  assert.equal(isPathCourseCheckboxDisabled(MAX_LEARNING_PATH_COURSES, false), true);
  assert.equal(isPathCourseCheckboxDisabled(MAX_LEARNING_PATH_COURSES, true), false);
  assert.equal(isPathCourseCheckboxDisabled(MAX_LEARNING_PATH_COURSES + 1, true), false);

  const overLimitAddition = togglePathCourseSelection(selected, 'course-extra', true);
  assert.strictEqual(overLimitAddition, selected);

  const afterRemoval = togglePathCourseSelection(selected, 'course-0', false);
  assert.equal(afterRemoval.length, MAX_LEARNING_PATH_COURSES - 1);
  const afterAddition = togglePathCourseSelection(afterRemoval, 'course-extra', true);
  assert.equal(afterAddition.length, MAX_LEARNING_PATH_COURSES);
  assert.equal(afterAddition.at(-1).courseId, 'course-extra');
  assert.equal(afterAddition.at(-1).requiresPrevious, true);
});

test('learning-path editor explains the cap, disables unavailable choices, and blocks legacy over-limit saves', () => {
  const source = fs.readFileSync(path.join(projectDirectory, 'src/pages-programs.tsx'), 'utf8');
  const styles = fs.readFileSync(path.join(projectDirectory, 'src/styles.css'), 'utf8');

  assert.ok(source.includes('${selected.length} of ${MAX_LEARNING_PATH_COURSES} courses selected.'));
  assert.ok(source.includes('Maximum of ${MAX_LEARNING_PATH_COURSES} courses selected. Remove a course before adding another.'));
  assert.ok(source.includes('disabled={selectionDisabled}'));
  assert.ok(source.includes('selectionOverLimit || (status === \'published\''));
  assert.match(styles, /\.path-course-selection-count\.at-limit/);
  assert.match(styles, /\.path-course-selection-count\.over-limit/);
  assert.match(styles, /\.path-course-check-disabled:hover/);
});
