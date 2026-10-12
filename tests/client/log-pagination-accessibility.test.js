import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const sourcePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/pages-manage.tsx');
const source = fs.readFileSync(sourcePath, 'utf8');

test('admin result pagination exposes a named navigation landmark on every page', () => {
  const labels = Array.from(source.matchAll(/<LogPagination ariaLabel="([^"]+)"/g), (match) => match[1]);

  assert.deepEqual(labels, [
    'Course list pages',
    'Learner progress pages',
    'Course access pages',
    'User accounts pages',
    'Course activity pages',
    'Audit log pages',
    'System log pages',
  ]);

  const paginationStart = source.indexOf('function LogPagination(');
  const paginationEnd = source.indexOf('\nfunction LogEmptyState(', paginationStart);
  assert.ok(paginationStart >= 0 && paginationEnd > paginationStart, 'shared pagination component should be available for inspection');
  assert.match(source.slice(paginationStart, paginationEnd), /return <nav className="log-pagination" aria-label=\{ariaLabel\}>/);
});
