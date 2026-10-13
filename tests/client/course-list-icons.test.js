import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../../src/pages-manage.tsx', import.meta.url), 'utf8');
const rowMenuStart = source.indexOf('function CourseRowMenu');
const rowMenuEnd = source.indexOf('\nfunction defaultQuizTitle', rowMenuStart);
const rowMenu = source.slice(rowMenuStart, rowMenuEnd);
const courseListStart = source.indexOf('export function CourseManagementPage');
const courseListEnd = source.indexOf('\nfunction Percentage', courseListStart);
const courseList = source.slice(courseListStart, courseListEnd);

test('course-list actions hide icons that duplicate their labels', () => {
  assert.match(rowMenu, /<MoreVertical size=\{18\} aria-hidden="true" \/>/);
  assert.equal((courseList.match(/<Plus\b[^>]*aria-hidden="true"[^>]*\/>/g) ?? []).length, 2);
});

test('course-list cover placeholders stay decorative beside the course title', () => {
  assert.match(courseList, /fallback=\{<BookOpen size=\{20\} aria-hidden="true" \/>\}/);
});
