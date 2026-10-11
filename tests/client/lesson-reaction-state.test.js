import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { updatePendingReactionIds } from '../../src/lesson-reaction-state.ts';

test('pending reaction requests stay isolated by lesson', () => {
  const firstLesson = updatePendingReactionIds(new Set(), 'lesson-a', true);
  const bothLessons = updatePendingReactionIds(firstLesson, 'lesson-b', true);
  const firstFinished = updatePendingReactionIds(bothLessons, 'lesson-a', false);

  assert.deepEqual([...firstFinished], ['lesson-b']);
});

test('pending reaction updates are idempotent', () => {
  const pending = new Set(['lesson-a']);

  assert.equal(updatePendingReactionIds(pending, 'lesson-a', true), pending);
  assert.equal(updatePendingReactionIds(pending, 'lesson-b', false), pending);
});

test('the lesson player keeps the reaction request guard across route changes', () => {
  const source = fs.readFileSync(new URL('../../src/pages-learner.tsx', import.meta.url), 'utf8');
  const feedbackEffect = source.match(/useEffect\(\(\) => \{\s*const requestSequence = \+\+feedbackSequenceRef\.current;[\s\S]*?\}, \[courseId, lessonId, canViewLessonFeedback, feedbackRefreshVersion\]\);/)?.[0];
  const reactionHandler = source.match(/async function chooseReaction\([\s\S]*?\n  }/)?.[0];

  assert.ok(feedbackEffect, 'Expected the lesson feedback route effect.');
  assert.doesNotMatch(feedbackEffect, /setReactionSaving|setPendingReactionLessonIds/);
  assert.match(reactionHandler || '', /pendingReactionLessonIdsRef\.current\.has\(lessonId\)/);
  assert.match(reactionHandler || '', /finally \{ markReactionSaving\(requestedLessonId, false\); \}/);
  assert.match(source, /const reactionSaving = pendingReactionLessonIds\.has\(lessonId\)/);
});
