import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { courseCatalogCategoryOptions, courseCatalogParams, hasCourseCatalogFilters } from '../../src/course-catalog-filters.ts';

test('the all-courses option has a distinct value from a real category with the same name', () => {
  assert.deepEqual(courseCatalogCategoryOptions(['All courses', 'General']), [
    { value: '', label: 'All courses' },
    { value: 'All courses', label: 'All courses (category)' },
    { value: 'General', label: 'General' },
  ]);
});

test('only the catch-all category omits the category query parameter', () => {
  const allCourses = courseCatalogParams({ query: '', category: '', sort: 'recent' }, 1);
  assert.equal(allCourses.has('category'), false);
  assert.equal(allCourses.get('page'), '1');

  const literalCategory = courseCatalogParams({ query: 'skills', category: 'All courses', sort: 'title' }, 2);
  assert.equal(literalCategory.get('category'), 'All courses');
  assert.equal(literalCategory.get('sort'), 'title');
  assert.equal(literalCategory.get('q'), 'skills');
  assert.equal(literalCategory.get('page'), '2');
  assert.equal(literalCategory.get('includeCategories'), '0');
});

test('catalog empty-state filtering recognizes only submitted search and category values', () => {
  assert.equal(hasCourseCatalogFilters({ query: '', category: '', sort: 'recent' }), false);
  assert.equal(hasCourseCatalogFilters({ query: '', category: 'All courses', sort: 'recent' }), true);
  assert.equal(hasCourseCatalogFilters({ query: 'skills', category: '', sort: 'recent' }), true);
});

test('learners can clear active catalog filters while matching results are visible', () => {
  const source = fs.readFileSync(new URL('../../src/pages-learner.tsx', import.meta.url), 'utf8');

  assert.match(source, /const hasAppliedFilters = hasCourseCatalogFilters\(filtersRef\.current\)/);
  assert.match(source, /\{hasAppliedFilters && <button type="button" className="clear-catalog-filters" aria-label="Clear search and filters"[^>]*onClick=\{clearCatalogFilters\}/);
  assert.match(source, /function clearCatalogFilters\(\) \{[\s\S]*?filtersRef\.current = defaults;[\s\S]*?setQuery\(''\);[\s\S]*?searchInputRef\.current\?\.focus\(\);/);
  assert.match(source, /<EmptyState icon=\{<Filter size=\{24\} \/>\} title=\{emptyCatalogState\.title\} detail=\{emptyCatalogState\.detail\} \/>/);
});

test('catalog category and sort changes apply the visible search draft', () => {
  const source = fs.readFileSync(new URL('../../src/pages-learner.tsx', import.meta.url), 'utf8');

  assert.match(source, /function applyCatalogControlChange\(nextCategory: string, nextSort: string\) \{[\s\S]*?const nextFilters = \{ query: query\.trim\(\), category: nextCategory, sort: nextSort \};[\s\S]*?const controlsChanged = nextCategory !== category \|\| nextSort !== sort;[\s\S]*?const queryChanged = nextFilters\.query !== filtersRef\.current\.query;[\s\S]*?filtersRef\.current = nextFilters;[\s\S]*?setQuery\(nextFilters\.query\);[\s\S]*?if \(!controlsChanged && queryChanged\) void load\(nextFilters\);/);
  assert.match(source, /ariaLabel="Course category"[^\n]*onChange=\{\(nextCategory\) => applyCatalogControlChange\(nextCategory, sort\)\}/);
  assert.match(source, /ariaLabel="Sort by"[^\n]*onChange=\{\(nextSort\) => applyCatalogControlChange\(category, nextSort\)\}/);
});
