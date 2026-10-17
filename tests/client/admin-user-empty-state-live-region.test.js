import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const source = fs.readFileSync(path.resolve('src/pages-manage.tsx'), 'utf8');

test('empty account results are announced while focus stays in the filters', () => {
  assert.match(source, /\/\* Announce empty results while focus stays in the search and filter controls\. \*\/[\s\S]*?!loading && !failedRequest && !users\.length && <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">\{userListEmptyMessage\(appliedQuery, roleFilter, approvalFilter\)\}<\/p>/);
});
