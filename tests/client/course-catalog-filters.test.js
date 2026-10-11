import assert from 'node:assert/strict';
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
