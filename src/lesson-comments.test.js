import assert from 'node:assert/strict';
import test from 'node:test';
import { getNewLessonComments } from './lesson-comments.ts';

function comment(id) {
  return { id, body: `Comment ${id}`, username: 'learner', createdAt: '2026-10-10T12:00:00Z' };
}

test('lesson comment pagination appends only unseen IDs in server order', () => {
  const existing = [comment('comment-1'), comment('comment-2')];
  const incoming = [comment('comment-2'), comment('comment-3'), comment('comment-3'), comment('comment-4')];

  assert.deepEqual(getNewLessonComments(existing, incoming).map(({ id }) => id), ['comment-3', 'comment-4']);
});

test('lesson comment pagination handles long loaded lists and an overlapping page', () => {
  const existing = Array.from({ length: 5_000 }, (_, index) => comment(`comment-${index + 1}`));
  const incoming = [comment('comment-5000'), ...Array.from({ length: 20 }, (_, index) => comment(`comment-${index + 5001}`))];

  assert.deepEqual(getNewLessonComments(existing, incoming).map(({ id }) => id),
    Array.from({ length: 20 }, (_, index) => `comment-${index + 5001}`));
});
