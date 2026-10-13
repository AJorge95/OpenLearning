import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../../src/pages-learner.tsx', import.meta.url), 'utf8');

test('course catalog and My Learning mount a pagination announcement only while another page is loading', () => {
  const announcements = source.match(/\{loadingMore && <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">Loading more courses…<\/p>\}/g) || [];

  assert.equal(announcements.length, 2);
  assert.doesNotMatch(source, /\{loadingMore \? 'Loading more courses…' : ''\}/);
});

test('certificate history mounts its pagination announcement only while another page is loading', () => {
  assert.match(source, /\{loadingMoreCertificates && <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">Loading more certificates…<\/p>\}/);
  assert.doesNotMatch(source, /\{loadingMoreCertificates \? 'Loading more certificates…' : ''\}/);
});
