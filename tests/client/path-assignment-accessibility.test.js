import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { canAssignLearningPathLearners } from '../../src/path-assignment-availability.ts';

const pageSource = fs.readFileSync(new URL('../../src/pages-programs.tsx', import.meta.url), 'utf8');
const stylesSource = fs.readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');

test('learning-path assignment removal names identify the learner and path', () => {
  assert.match(pageSource, /aria-label=\{`\$\{removingLearnerId === learner\.id \? 'Removing assignment for' : 'Remove assignment for'\} \$\{learner\.username\} from \$\{path\.title\}`\}/);
  assert.match(pageSource, /\{removingLearnerId === learner\.id \? 'Removing…' : 'Remove assignment'\}<\/button>/);
});

test('learning-path learner paging is a landmark named for its path', () => {
  assert.match(pageSource, /<nav className="log-pagination path-learner-pagination" aria-label=\{`Learner assignment pages for \$\{path\.title\}`\}>/);
  assert.match(pageSource, /assignmentPage <= 1 \|\| assignmentBusy/);
  assert.match(pageSource, /!assignmentHasMore \|\| assignmentBusy/);
});

test('learner assignment rows and selector options stay stable during unrelated page updates', () => {
  assert.match(pageSource, /const assignableLearners = useMemo\(\(\) => learners\.filter\(\(learner\) => !learner\.enrolled\), \[learners\]\)/);
  assert.match(pageSource, /const enrolledLearners = useMemo\(\(\) => learners\.filter\(\(learner\) => learner\.enrolled\), \[learners\]\)/);
  assert.match(pageSource, /const assignmentOptions = useMemo\(\(\) => \[[\s\S]*?\], \[assignableLearners, assignmentTotal\]\)/);
  assert.match(pageSource, /ariaLabel="Select a learner"[^\n]*options=\{assignmentOptions\}/);
});

test('assignment confirmation describes the enrollment outcome', () => {
  assert.match(pageSource, /setNotice\('Learner is enrolled in the path\.'\)/);
});

test('learning-path prerequisite labels provide at least a 24px pointer target', () => {
  const prerequisiteRule = stylesSource.match(/\.path-prerequisite\s*\{([^}]*)\}/)?.[1];

  assert.ok(prerequisiteRule, 'expected prerequisite label styles');
  assert.match(prerequisiteRule, /min-height:\s*24px/);
});

test('only published learning paths can be assigned learners', () => {
  assert.equal(canAssignLearningPathLearners('published'), true);
  assert.equal(canAssignLearningPathLearners('draft'), false);
  assert.equal(canAssignLearningPathLearners('archived'), false);
});

test('draft learning paths explain why learner assignment is unavailable', () => {
  assert.match(pageSource, /\{canAssignLearningPathLearners\(path\.status\)\s*\?\s*<Button/);
  assert.match(pageSource, /<span className="muted">Publish this path to assign learners\.<\/span>/);
  assert.match(pageSource, /staff && canAssignLearningPathLearners\(path\.status\) && assignmentPath === path\.id/);
});

test('staff learning-path cards identify personal progress and omit zero-course progress', () => {
  assert.match(pageSource, /\{path\.courseCount > 0 && <>/);
  assert.match(pageSource, /\{staff \? 'Your progress: ' : ''\}\{path\.completedCourses\} of \{path\.courseCount\} courses complete/);
  assert.match(pageSource, /label=\{`\$\{staff \? 'Your progress in' : 'Progress in'\} \$\{path\.title\}`\}/);
});

test('learning-path cards explain when no courses are currently included', () => {
  assert.match(pageSource, /path\.courses\.length > 0 \? <ol className="path-course-list">[\s\S]*?<\/ol> : <p className="path-course-list-empty muted">No courses are currently included in this path\.<\/p>/);
});

test('changing an assigned published path back to draft closes its assignment panel after saving', () => {
  assert.match(pageSource, /if \(editing && !canAssignLearningPathLearners\(value\.status\) && assignmentPathRef\.current === editing\.id\) clearAssignmentPanel\(\);/);
});
