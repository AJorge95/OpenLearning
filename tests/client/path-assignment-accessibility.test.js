import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { canAssignLearningPathLearners } from '../../src/path-assignment-availability.ts';

const pageSource = fs.readFileSync(new URL('../../src/pages-programs.tsx', import.meta.url), 'utf8');

test('learning-path assignment removal names identify the learner and path', () => {
  assert.match(pageSource, /aria-label=\{`\$\{removingLearnerId === learner\.id \? 'Removing assignment for' : 'Remove assignment for'\} \$\{learner\.username\} from \$\{path\.title\}`\}/);
  assert.match(pageSource, /\{removingLearnerId === learner\.id \? 'Removing…' : 'Remove assignment'\}<\/button>/);
});

test('assignment confirmation describes the enrollment outcome', () => {
  assert.match(pageSource, /setNotice\('Learner is enrolled in the path\.'\)/);
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

test('changing an assigned published path back to draft closes its assignment panel after saving', () => {
  assert.match(pageSource, /if \(editing && !canAssignLearningPathLearners\(value\.status\) && assignmentPathRef\.current === editing\.id\) clearAssignmentPanel\(\);/);
});
