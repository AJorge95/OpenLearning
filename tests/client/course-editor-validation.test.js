import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  COMPLETION_WINDOW_ERROR,
  COURSE_TITLE_REQUIRED_ERROR,
  COURSE_TITLE_TOO_LONG_ERROR,
  MAX_COURSE_TITLE_LENGTH,
  validateCompletionWindowDays,
  validateCourseTitle,
} from '../../src/course-editor-validation.ts';

const sourceDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src');

test('completion windows accept a blank value and whole days within the supported range', () => {
  assert.deepEqual(validateCompletionWindowDays(''), { value: null, error: null });
  assert.deepEqual(validateCompletionWindowDays('  '), { value: null, error: null });
  assert.deepEqual(validateCompletionWindowDays('1'), { value: 1, error: null });
  assert.deepEqual(validateCompletionWindowDays('3650'), { value: 3650, error: null });
});

test('completion windows reject values the editor API cannot save', () => {
  for (const value of ['0', '-1', '1.5', '3651', 'Infinity', 'not a number']) {
    assert.deepEqual(validateCompletionWindowDays(value), { value: null, error: COMPLETION_WINDOW_ERROR }, value);
  }
});

test('course titles are trimmed, required, and limited to the server maximum', () => {
  assert.deepEqual(validateCourseTitle('  Workplace safety  '), { value: 'Workplace safety', error: null });
  assert.deepEqual(validateCourseTitle('x'.repeat(MAX_COURSE_TITLE_LENGTH)), {
    value: 'x'.repeat(MAX_COURSE_TITLE_LENGTH),
    error: null,
  });
  assert.deepEqual(validateCourseTitle('   '), { value: null, error: COURSE_TITLE_REQUIRED_ERROR });
  assert.deepEqual(validateCourseTitle('x'.repeat(MAX_COURSE_TITLE_LENGTH + 1)), {
    value: null,
    error: COURSE_TITLE_TOO_LONG_ERROR,
  });
});

test('course title errors are attached to the field and checked before both editor save paths', () => {
  const source = fs.readFileSync(path.join(sourceDirectory, 'pages-manage.tsx'), 'utf8');
  const saveCourse = source.slice(source.indexOf('async function saveCourse('), source.indexOf('async function saveCourseDetailsIfChanged('));
  const saveDetails = source.slice(source.indexOf('async function saveCourseDetailsIfChanged('), source.indexOf('async function loadGovernance('));

  assert.match(source, /<input ref=\{courseTitleInputRef\} required value=\{title\} maxLength=\{MAX_COURSE_TITLE_LENGTH\} aria-invalid=\{courseTitleError \? true : undefined\} aria-describedby=\{courseTitleError \? 'course-title-error' : undefined\}/);
  assert.match(source, /id="course-title-error" className="course-title-error" role="alert">\{courseTitleError\}/);
  assert.match(source, /function validatedCourseTitleForSave\(\)[\s\S]*?validateCourseTitle\(title\)[\s\S]*?courseTitleInputRef\.current\?\.focus\(\)/);
  assert.match(saveCourse, /const validatedTitle = validatedCourseTitleForSave\(\)/);
  assert.match(saveDetails, /const validatedTitle = validatedCourseTitleForSave\(\)/);
  assert.match(saveCourse, /title: validatedTitle/);
  assert.match(saveDetails, /title: validatedTitle/);
});

test('course editor describes invalid completion-window values and validates before save requests', () => {
  const source = fs.readFileSync(path.join(sourceDirectory, 'pages-manage.tsx'), 'utf8');
  assert.match(source, /step="1"[^>]*aria-invalid=\{completionWindow\.error \? true : undefined\}/);
  assert.match(source, /aria-describedby=\{completionWindow\.error \? 'completion-window-help completion-window-error' : 'completion-window-help'\}/);
  assert.match(source, /id="completion-window-error" className="completion-window-error"/);
  assert.equal((source.match(/if \(completionWindow\.error\) \{/g) || []).length, 2);
  assert.match(source, /completionWindowInputRef\.current\?\.focus\(\);\s*throw new ApiError\(400, completionWindow\.error, 'validation_error'\)/);
  assert.match(source, /completionWindowDays: completionWindow\.value/);
});

test('course description exposes its current length and limit to authors', () => {
  const source = fs.readFileSync(path.join(sourceDirectory, 'pages-manage.tsx'), 'utf8');
  assert.match(source, /<label className="field-wide">Description\s*<textarea id="course-description" aria-describedby="course-description-count" rows=\{3\} maxLength=\{6000\} value=\{description\}/);
  assert.match(source, /<small id="course-description-count" className="field-character-count">\{description\.length\} \/ 6,000 characters<\/small>/);
});
