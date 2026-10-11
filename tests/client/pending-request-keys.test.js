import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { updatePendingRequestKeys } from '../../src/pending-request-keys.ts';

test('pending request keys stay isolated when one lesson or quiz finishes', () => {
  const firstRequest = updatePendingRequestKeys(new Set(), 'lesson:lesson-a', true);
  const twoRequests = updatePendingRequestKeys(firstRequest, 'course-a:quiz-a', true);
  const lessonFinished = updatePendingRequestKeys(twoRequests, 'lesson:lesson-a', false);

  assert.deepEqual([...lessonFinished], ['course-a:quiz-a']);
});

test('pending request key updates are idempotent', () => {
  const pending = new Set(['lesson:lesson-a']);

  assert.equal(updatePendingRequestKeys(pending, 'lesson:lesson-a', true), pending);
  assert.equal(updatePendingRequestKeys(pending, 'course-a:quiz-a', false), pending);
});

test('lesson reactions keep the same-lesson request guard across route changes', () => {
  const source = fs.readFileSync(new URL('../../src/pages-learner.tsx', import.meta.url), 'utf8');
  const feedbackEffect = source.match(/useEffect\(\(\) => \{\s*const requestSequence = \+\+feedbackSequenceRef\.current;[\s\S]*?\}, \[courseId, lessonId, canViewLessonFeedback, feedbackRefreshVersion\]\);/)?.[0];
  const reactionHandler = source.match(/async function chooseReaction\([\s\S]*?\n  }/)?.[0];

  assert.ok(feedbackEffect, 'Expected the lesson feedback route effect.');
  assert.doesNotMatch(feedbackEffect, /setPendingReactionLessonIds/);
  assert.match(reactionHandler || '', /pendingReactionLessonIdsRef\.current\.has\(lessonId\)/);
  assert.match(reactionHandler || '', /finally \{ markReactionSaving\(requestedLessonId, false\); \}/);
  assert.match(source, /const reactionSaving = pendingReactionLessonIds\.has\(lessonId\)/);
});

test('quiz attempts retain each pending route lock and show results if that route returns', () => {
  const source = fs.readFileSync(new URL('../../src/pages-learner.tsx', import.meta.url), 'utf8');
  const quizPage = source.slice(source.indexOf('export function QuizPage()'));
  const routeEffect = quizPage.match(/useEffect\(\(\) => \{\s*focusFirstAnswerRef\.current = false;[\s\S]*?\}, \[courseId, quizId\]\);/)?.[0];
  const submitHandler = quizPage.match(/async function submit\(event: React\.FormEvent\)[\s\S]*?\n  }/)?.[0];

  assert.ok(routeEffect, 'Expected the quiz route-change effect.');
  assert.doesNotMatch(routeEffect, /setPendingQuizRouteKeys/);
  assert.match(quizPage, /const saving = pendingQuizRouteKeys\.has\(routeKey\)/);
  assert.match(submitHandler || '', /pendingQuizRouteKeysRef\.current\.has\(requestedRouteKey\)/);
  assert.match(submitHandler || '', /const isCurrentSubmission = \(\) => routeKeyRef\.current === requestedRouteKey/);
  assert.match(submitHandler || '', /finally \{\s*markQuizRoutePending\(requestedRouteKey, false\);\s*\}/);
  assert.doesNotMatch(quizPage, /submitSequenceRef/);
});
