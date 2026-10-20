import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { offsetPageHasDrift } from '../../src/offset-page-drift.ts';

test('offset pages continue when metadata and item IDs are unchanged', () => {
  const current = [{ id: 'certificate-1' }, { id: 'certificate-2' }];
  const incoming = [{ id: 'certificate-3' }];

  assert.equal(offsetPageHasDrift(current, incoming, 3, 3, 2, 2), false);
});

test('offset pages refresh when totals, clamped pages, or IDs drift', () => {
  const current = [{ id: 'certificate-1' }, { id: 'certificate-2' }];

  assert.equal(offsetPageHasDrift(current, [{ id: 'certificate-3' }], 3, 4, 2, 2), true);
  assert.equal(offsetPageHasDrift(current, [{ id: 'certificate-1' }], 3, 3, 2, 1), true);
  assert.equal(offsetPageHasDrift(current, [{ id: 'certificate-2' }, { id: 'certificate-3' }], 3, 3, 2, 2), true);
});

test('course and certificate pagination both use the shared drift check', () => {
  const source = fs.readFileSync(new URL('../../src/pages-learner.tsx', import.meta.url), 'utf8');

  assert.match(source, /return offsetPageHasDrift\(currentCourses, response\.courses, expectedTotal, response\.total, expectedPage, response\.page\)/);
  assert.match(source, /offsetPageHasDrift\(certificates, result\.certificates, certificateTotal, result\.total, requestedPage, result\.page\)/);
});
