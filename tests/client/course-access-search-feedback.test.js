import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../../src/pages-manage.tsx', import.meta.url), 'utf8');
const pageStart = source.indexOf('export function CourseAccessPage()');
const pageEnd = source.indexOf('\nexport function AdminUsersPage()', pageStart);
const page = source.slice(pageStart, pageEnd);

test('submitting a new course learner search clears the previous assignment confirmation', () => {
  assert.match(page, /function submitSearch\(event: React\.FormEvent\) \{\s*event\.preventDefault\(\);\s*const search = query\.trim\(\);\s*\/\/ A new result set changes which learner the assignment confirmation describes\.\s*setNotice\(''\);\s*setAppliedQuery\(search\);\s*setPage\(1\);\s*load\(search, 1\);\s*\}/);
  assert.match(page, /<form role="search" aria-label="Search course learners" className="access-search" onSubmit=\{submitSearch\}>/);
});
