import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { appendPublishedCourseOptions, hasMorePublishedCourseOptions, publishedCourseOptionsPageUrl } from '../../src/path-course-options.ts';

const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('published course option requests preserve the management pagination contract', () => {
  assert.equal(publishedCourseOptionsPageUrl(1), '/api/manage/courses?status=published&page=1');
  assert.equal(publishedCourseOptionsPageUrl(2), '/api/manage/courses?status=published&page=2');
  assert.equal(hasMorePublishedCourseOptions(1, 50, 51), true);
  assert.equal(hasMorePublishedCourseOptions(2, 50, 51), false);
  assert.equal(hasMorePublishedCourseOptions(0, 50, 51), false);
});

test('loading another page appends new courses once and refreshes duplicate rows in place', () => {
  const firstPage = [
    { id: 'course-a', title: 'Course A', updatedAt: 'old' },
    { id: 'course-b', title: 'Course B', updatedAt: 'old' },
  ];
  const secondPage = [
    { id: 'course-b', title: 'Course B revised', updatedAt: 'new' },
    { id: 'course-c', title: 'Course C', updatedAt: 'new' },
  ];

  assert.deepEqual(appendPublishedCourseOptions(firstPage, secondPage), [
    firstPage[0],
    secondPage[0],
    secondPage[1],
  ]);
});

test('learning-path editor paginates course options with retry and request cleanup', () => {
  const source = fs.readFileSync(path.join(projectDirectory, 'src/pages-programs.tsx'), 'utf8');
  const styles = fs.readFileSync(path.join(projectDirectory, 'src/styles.css'), 'utf8');

  assert.match(source, /function PathEditor\(\{ existing, busy, onSave, onCancel, onDirtyChange \}/);
  assert.match(source, /api\.get<PublishedCoursePage>\(publishedCourseOptionsPageUrl\(requestedPage\), \{ signal: controller\.signal \}\)/);
  assert.match(source, /appendPublishedCourseOptions\(replace \? \[\] : current, result\.courses\)/);
  assert.match(source, /new Map\(\[\.\.\.courses, \.\.\.\(existing\?\.courses \|\| \[\]\)\]/);
  assert.match(source, /Loaded \{courses\.length\} of \{courseTotal\} published courses\./);
  assert.match(source, />Load more courses<|\{courseLoading \? 'Loading…' : 'Load more courses'\}/);
  assert.match(source, /role="alert"[\s\S]*?Retry loading courses/);
  assert.match(source, /courseRequestControllerRef\.current\?\.abort\(\)/);
  assert.match(styles, /\.path-course-options-footer, \.path-course-page-error\s*\{[^}]*flex-wrap:\s*wrap;/);
});
