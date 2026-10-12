import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../../src/pages-learner.tsx', import.meta.url), 'utf8');
const overviewStart = source.indexOf('export function CourseOverviewPage()');
const overviewEnd = source.indexOf('\nfunction orderedLessons', overviewStart);
const overview = source.slice(overviewStart, overviewEnd);

test('course overview keeps its visible course description available to assistive technology', () => {
  assert.match(overview, /course\.description \? <p className="course-hero-description">\{course\.description\}<\/p> : null/);
  assert.doesNotMatch(overview, /className="course-hero-description"[^>]*aria-hidden/);
});
