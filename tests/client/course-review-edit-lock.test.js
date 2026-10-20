import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../../src/pages-manage.tsx', import.meta.url), 'utf8');
const detailsStart = source.indexOf('<section className="editor-section course-details-form"');
const governanceStart = source.indexOf('<section className="editor-section course-governance-section"', detailsStart);
const curriculumStart = source.indexOf('<section className="editor-section curriculum-editor-section"', governanceStart);
const editorEnd = source.indexOf('{course.status === \'archived\' && <div className="delete-course-row"', curriculumStart);

test('pending review announces the edit lock and disables course details and curriculum', () => {
  assert.match(source, /const reviewPending = review\?\.status === 'in_review';/);
  assert.match(source, /This revision is awaiting review\. Course content is locked until the reviewer approves it or requests changes\./);
  assert.ok(detailsStart >= 0 && governanceStart > detailsStart);
  assert.ok(curriculumStart > governanceStart && editorEnd > curriculumStart);
  assert.match(source.slice(detailsStart, governanceStart), /<fieldset className="course-review-locked-fields" disabled=\{reviewPending \|\| saving\}>/);
  assert.match(source.slice(curriculumStart, editorEnd), /<fieldset className="course-review-locked-fields" disabled=\{reviewPending \|\| saving\}>/);
  assert.match(source, /onClick=\{\(\) => saveCourse\('draft'\)\} disabled=\{saving \|\| reviewPending/);
});

test('pending review keeps independent decisions available and blocks other editor writes', () => {
  const governance = source.slice(governanceStart, curriculumStart);
  assert.match(governance, /disabled=\{savingCompetencyMapping \|\| reviewPending\}/);
  assert.match(governance, /disabled=\{restoring \|\| reviewPending\}/);
  assert.match(governance, /checked=\{requiresRecompletion\} onChange=\{\(event\) => setRequiresRecompletion\(event\.target\.checked\)\} disabled=\{savingReviewDecision\}/);
  assert.match(governance, /className="review-decision-actions"/);
  assert.match(governance, /onClick=\{\(\) => void decideReview\('approve'\)\}/);
  assert.match(governance, /onSubmit=\{\(event\) => \{ event\.preventDefault\(\); void decideReview\('changes_requested', changeRequestNote\); \}\}/);
});
