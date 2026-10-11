import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { lessonCommentRemovalConfirmation } from '../../src/lesson-comment-confirmation.ts';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const pageSource = fs.readFileSync(path.join(repositoryRoot, 'src/pages-learner.tsx'), 'utf8');

test('comment removal confirmation identifies the author and warns that removal is permanent', () => {
  assert.deepEqual(lessonCommentRemovalConfirmation('learner-one'), {
    title: 'Remove comment by learner-one?',
    description: 'This action cannot be undone.',
  });
});

test('comment removal is deferred until the matching current lesson comment is confirmed', () => {
  const removalFlow = pageSource.slice(pageSource.indexOf('function requestCommentRemoval'), pageSource.indexOf('async function loadMoreComments'));

  assert.match(removalFlow, /function requestCommentRemoval\(comment: LessonComment\)[\s\S]*?setPendingCommentRemoval\(\{ courseId, lessonId, commentId: comment\.id, username: comment\.username \}\)/);
  assert.match(removalFlow, /async function confirmCommentRemoval\(\)[\s\S]*?item\.id === pending\.commentId && item\.username === pending\.username[\s\S]*?routeCourseIdRef\.current !== pending\.courseId \|\| routeLessonIdRef\.current !== pending\.lessonId[\s\S]*?api\.delete\(`\/api\/lessons\/\$\{requestedLessonId\}\/comments\/\$\{comment\.id\}`\)/);
  assert.match(pageSource, /<ConfirmationDialog \{\.\.\.lessonCommentRemovalConfirmation\(pendingCommentRemoval\.username\)\} confirmLabel="Remove comment"/);
  assert.doesNotMatch(removalFlow, /window\.confirm/);
});

test('feedback refresh clears a pending removal for an outdated comment list', () => {
  assert.match(pageSource, /setPendingCommentRemoval\(null\); setFeedback\(null\); setFeedbackError\(null\)/);
});
