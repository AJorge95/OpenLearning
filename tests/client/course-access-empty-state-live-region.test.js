import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const source = fs.readFileSync(path.resolve('src/pages-manage.tsx'), 'utf8');
const pageStart = source.indexOf('export function CourseAccessPage()');
const pageEnd = source.indexOf('\nexport function AdminUsersPage()', pageStart);
const page = source.slice(pageStart, pageEnd);

test('course-access empty results are announced without duplicating the visible recovery content', () => {
  assert.match(page, /const hasEmptyAccessResult = !failedRequest && users\.length === 0;/);
  assert.match(page, /\{hasEmptyAccessResult && <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">\{appliedQuery \? 'No learners match that search\.' : 'No learner accounts are available\.'\}<\/p>\}/);
  assert.match(page, /!failedRequest && <div className="access-empty">/);
});
