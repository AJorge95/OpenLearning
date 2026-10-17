import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  COMPLETION_WINDOW_ERROR,
  COURSE_CATEGORY_REQUIRED_ERROR,
  COURSE_CATEGORY_TOO_LONG_ERROR,
  MAX_COURSE_CATEGORY_LENGTH,
  COURSE_TITLE_REQUIRED_ERROR,
  COURSE_TITLE_TOO_LONG_ERROR,
  MAX_COURSE_TITLE_LENGTH,
  validateCompletionWindowDays,
  validateCourseCategory,
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

test('course categories are trimmed, required, and limited to the server maximum', () => {
  assert.deepEqual(validateCourseCategory('  Safety  '), { value: 'Safety', error: null });
  assert.deepEqual(validateCourseCategory('x'.repeat(MAX_COURSE_CATEGORY_LENGTH)), {
    value: 'x'.repeat(MAX_COURSE_CATEGORY_LENGTH),
    error: null,
  });
  assert.deepEqual(validateCourseCategory('   '), { value: null, error: COURSE_CATEGORY_REQUIRED_ERROR });
  assert.deepEqual(validateCourseCategory('x'.repeat(MAX_COURSE_CATEGORY_LENGTH + 1)), {
    value: null,
    error: COURSE_CATEGORY_TOO_LONG_ERROR,
  });
});

test('course title errors are attached to the field and checked before both editor save paths', () => {
  const source = fs.readFileSync(path.join(sourceDirectory, 'pages-manage.tsx'), 'utf8');
  const saveCourse = source.slice(source.indexOf('async function saveCourse('), source.indexOf('async function saveCourseDetailsIfChanged('));
  const saveDetails = source.slice(source.indexOf('async function saveCourseDetailsIfChanged('), source.indexOf('async function loadGovernance('));

  assert.match(source, /<input ref=\{courseTitleInputRef\} required value=\{title\} maxLength=\{MAX_COURSE_TITLE_LENGTH\} aria-invalid=\{courseTitleError \? true : undefined\} aria-describedby=\{courseTitleError \? 'course-title-error' : undefined\}/);
  assert.match(source, /id="course-title-error" className="course-detail-field-error" role="alert">\{courseTitleError\}/);
  assert.match(source, /function validatedCourseTitleForSave\(\)[\s\S]*?validateCourseTitle\(title\)[\s\S]*?courseTitleInputRef\.current\?\.focus\(\)/);
  assert.match(saveCourse, /const validatedTitle = validatedCourseTitleForSave\(\)/);
  assert.match(saveDetails, /const validatedTitle = validatedCourseTitleForSave\(\)/);
  assert.match(saveCourse, /title: validatedTitle/);
  assert.match(saveDetails, /title: validatedTitle/);
});

test('course category errors are attached to the field and checked before both editor save paths', () => {
  const source = fs.readFileSync(path.join(sourceDirectory, 'pages-manage.tsx'), 'utf8');
  const saveCourse = source.slice(source.indexOf('async function saveCourse('), source.indexOf('async function saveCourseDetailsIfChanged('));
  const saveDetails = source.slice(source.indexOf('async function saveCourseDetailsIfChanged('), source.indexOf('async function loadGovernance('));

  assert.match(source, /<input ref=\{courseCategoryInputRef\} required value=\{category\} maxLength=\{MAX_COURSE_CATEGORY_LENGTH\} aria-invalid=\{courseCategoryError \? true : undefined\} aria-describedby=\{courseCategoryError \? 'course-category-error' : undefined\}/);
  assert.match(source, /id="course-category-error" className="course-detail-field-error" role="alert">\{courseCategoryError\}/);
  assert.match(source, /function validatedCourseCategoryForSave\(\)[\s\S]*?validateCourseCategory\(category\)[\s\S]*?courseCategoryInputRef\.current\?\.focus\(\)/);
  assert.match(source, /error !== COMPLETION_WINDOW_ERROR && error !== courseTitleError && error !== courseCategoryError/);
  assert.match(saveCourse, /const validatedCategory = validatedCourseCategoryForSave\(\)/);
  assert.match(saveDetails, /const validatedCategory = validatedCourseCategoryForSave\(\)/);
  assert.match(saveCourse, /category: validatedCategory/);
  assert.match(saveDetails, /category: validatedCategory/);
});

test('saved course details sync server normalization without overwriting edits made in flight', () => {
  const source = fs.readFileSync(path.join(sourceDirectory, 'pages-manage.tsx'), 'utf8');
  const saveCourse = source.slice(source.indexOf('async function saveCourse('), source.indexOf('async function saveCourseDetailsIfChanged('));
  const saveDetails = source.slice(source.indexOf('async function saveCourseDetailsIfChanged('), source.indexOf('async function loadGovernance('));
  const syncDetails = source.slice(source.indexOf('function syncCourseDetailsAfterSave('), source.indexOf('function showCourseTitleApiError('));

  for (const field of ['title', 'description', 'category', 'visibility', 'completionWindowDays']) {
    assert.match(syncDetails, new RegExp(`set${field[0].toUpperCase()}${field.slice(1)}\\(\\(current\\) => current === submitted\\.${field} \\?`));
  }
  assert.match(saveCourse, /syncCourseDetailsAfterSave\(response\.course, submittedDetails\)/);
  assert.match(saveDetails, /syncCourseDetailsAfterSave\(response\.course, submittedDetails\)/);
  assert.match(saveDetails, /syncCourseDetailsAfterSave\(course, submittedDetails\)/);
});

test('course editor describes invalid completion-window values and validates before save requests', () => {
  const source = fs.readFileSync(path.join(sourceDirectory, 'pages-manage.tsx'), 'utf8');
  assert.match(source, /step="1"[^>]*aria-invalid=\{completionWindow\.error \? true : undefined\}/);
  assert.match(source, /aria-describedby=\{completionWindow\.error \? 'completion-window-help completion-window-error' : 'completion-window-help'\}/);
  assert.match(source, /id="completion-window-error" className="completion-window-error" role="alert"/);
  assert.equal((source.match(/if \(completionWindow\.error\) \{/g) || []).length, 2);
  assert.match(source, /completionWindowInputRef\.current\?\.focus\(\);\s*throw new ApiError\(400, completionWindow\.error, 'validation_error'\)/);
  assert.match(source, /completionWindowDays: completionWindow\.value/);
});

test('course description exposes its current length and limit to authors', () => {
  const source = fs.readFileSync(path.join(sourceDirectory, 'pages-manage.tsx'), 'utf8');
  assert.match(source, /<label className="field-wide">Description\s*<textarea id="course-description" aria-describedby="course-description-count" rows=\{3\} maxLength=\{6000\} value=\{description\}/);
  assert.match(source, /<small id="course-description-count" className="field-character-count">\{description\.length\} \/ 6,000 characters<\/small>/);
});
