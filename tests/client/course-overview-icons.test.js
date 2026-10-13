import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const learnerSource = fs.readFileSync(new URL('../../src/pages-learner.tsx', import.meta.url), 'utf8');
const componentsSource = fs.readFileSync(new URL('../../src/components.tsx', import.meta.url), 'utf8');
const overviewStart = learnerSource.indexOf('export function CourseOverviewPage()');
const overviewEnd = learnerSource.indexOf('\nfunction orderedLessons', overviewStart);
const overview = learnerSource.slice(overviewStart, overviewEnd);
const curriculumStart = componentsSource.indexOf('export function CurriculumModule');
const curriculumEnd = componentsSource.indexOf('\nfunction CurriculumLesson', curriculumStart);
const curriculum = componentsSource.slice(curriculumStart, curriculumEnd);

test('course overview hides icons that duplicate adjacent labels', () => {
  for (const [icon, count] of [['BookOpen', 1], ['Play', 1], ['ArrowRight', 2], ['Award', 2]]) {
    const matches = overview.match(new RegExp(`<${icon}\\b[^>]*aria-hidden="true"[^>]*/>`, 'g')) ?? [];
    assert.equal(matches.length, count, `${icon} should be hidden wherever the overview already has a text label`);
  }
});

test('curriculum module disclosure keeps its visual chevron decorative', () => {
  assert.match(curriculum, /<ChevronDown size=\{17\} aria-hidden="true" \/>/);
});
