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

test('course overview explains empty published courses instead of showing inert start actions', () => {
  const compactOverview = overview.replace(/\s+/g, ' ');
  assert.match(compactOverview, /const hasLearningActivities = Boolean\(course\.finalExam\) \|\| \(course\.modules \?\? \[\]\)\.some\(\(module\) => module\.lessons\.length > 0 \|\| Boolean\(module\.quiz\)\);/);
  assert.match(compactOverview, /: <EmptyState title="No learning activities yet" detail="This course does not have any lessons or quizzes available yet\." headingLevel=\{3\} \/>/);
  assert.match(compactOverview, /hasLearningActivities \|\| course\.completed \|\| course\.progress > 0 \? \( <div className="course-hero-actions">/);
  assert.match(compactOverview, /nextActivity \? <Button onClick=\{startLearning\} disabled=\{starting\} aria-busy=\{starting\}>/);
  assert.match(compactOverview, /nextActivity \? \( <div className="course-bottom-cta">.*?<Button onClick=\{startLearning\} disabled=\{starting\} aria-busy=\{starting\}>/);
});

test('course start actions expose and announce their pending enrollment state', () => {
  assert.equal((overview.match(/<Button onClick=\{startLearning\} disabled=\{starting\} aria-busy=\{starting\}>/g) || []).length, 2);
  assert.match(overview, /\{starting && <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">Starting course…<\/span>\}/);
});
