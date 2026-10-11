import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../../src/pages-learner.tsx', import.meta.url), 'utf8');

test('course catalog and My Learning announce when another page is loading', () => {
  const announcements = source.match(/<p className="sr-only" role="status" aria-live="polite" aria-atomic="true">\{loadingMore \? 'Loading more courses…' : ''\}<\/p>/g) || [];

  assert.equal(announcements.length, 2);
});

test('certificate history announces when another page is loading', () => {
  assert.match(source, /<p className="sr-only" role="status" aria-live="polite" aria-atomic="true">\{loadingMoreCertificates \? 'Loading more certificates…' : ''\}<\/p>/);
});
