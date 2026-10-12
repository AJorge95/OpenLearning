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
  assert.match(overview, /const hasLearningActivities = \(course\.modules \?\? \[\]\)\.some\(\(module\) => module\.lessons\.length > 0 \|\| Boolean\(module\.quiz\)\)/);
  assert.match(overview, /hasLearningActivities \? course\.modules\?\.map\([\s\S]*?: <EmptyState title="No learning activities yet" detail="This course does not have any lessons or quizzes available yet\." headingLevel=\{3\} \/>/);
  assert.match(overview, /hasLearningActivities \|\| course\.completed \|\| course\.progress > 0 \? \(\s*<div className="course-hero-actions">/);
  assert.match(overview, /nextActivity \? <Button onClick=\{startLearning\} disabled=\{starting\}>/);
  assert.match(overview, /nextActivity \? \(\s*<div className="course-bottom-cta">[\s\S]*?<Button onClick=\{startLearning\} disabled=\{starting\}>/);
});
