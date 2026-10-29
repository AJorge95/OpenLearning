import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../../src/pages-manage.tsx', import.meta.url), 'utf8');
const pageStart = source.indexOf('export function CourseManagementPage()');
const pageEnd = source.indexOf('\nfunction Percentage', pageStart);
const page = source.slice(pageStart, pageEnd);

test('course list filters and pagination stay fixed while a row mutation refreshes the list', () => {
  assert.notEqual(pageStart, -1, 'course management page should be present');
  assert.notEqual(pageEnd, -1, 'course management page should end before course analytics helpers');
  assert.match(page, /const hasPendingCourseAction = Object\.keys\(busyActions\)\.length > 0;/);
  assert.match(page, /function submitSearch\(event: React\.FormEvent<HTMLFormElement>\) \{\s*event\.preventDefault\(\);\s*if \(Object\.keys\(busyActionsRef\.current\)\.length > 0\) return;/);
  assert.match(page, /function changeCourseStatusFilter\(nextStatus: string\) \{\s*if \(Object\.keys\(busyActionsRef\.current\)\.length > 0\) return;/);
  assert.match(page, /function clearCourseSearch\(\) \{\s*if \(Object\.keys\(busyActionsRef\.current\)\.length > 0\) return;/);
  assert.match(page, /aria-label="Filter courses by status"[\s\S]*?disabled=\{hasPendingCourseAction\}/);
  assert.match(page, /aria-label="Search courses"[^\n]*disabled=\{hasPendingCourseAction\}[^\n]*disabled=\{hasPendingCourseAction\}/);
  assert.match(page, /ariaLabel="Course list pages"[\s\S]*?loading=\{loading \|\| hasPendingCourseAction\}[\s\S]*?Object\.keys\(busyActionsRef\.current\)\.length === 0/);
});
