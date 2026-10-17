import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../../src/pages-learner.tsx', import.meta.url), 'utf8');
const catalogSource = source.slice(
  source.indexOf('export function CatalogPage'),
  source.indexOf('export function MyLearningPage'),
);
const myLearningSource = source.slice(
  source.indexOf('export function MyLearningPage'),
  source.indexOf('export function CourseCertificatePage'),
);

test('course catalog announces only filtered empty results outside the visible empty state', () => {
  assert.match(catalogSource, /const hasFilteredEmptyCatalogResult = hasEmptyCatalogResult && hasAppliedFilters;/);
  assert.match(catalogSource, /\{hasFilteredEmptyCatalogResult && <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">\{emptyCatalogState\.title\}\. \{emptyCatalogState\.detail\}<\/p>\}/);
  assert.doesNotMatch(catalogSource, /\{hasEmptyCatalogResult && <p className="sr-only" role="status"/);
});

test('My learning relies on the visible empty state instead of a duplicate announcement', () => {
  assert.doesNotMatch(myLearningSource, /hasEmptyLearning/);
  assert.doesNotMatch(myLearningSource, /<p className="sr-only" role="status" aria-live="polite" aria-atomic="true">\{learningEmptyState\.title\}/);
});
