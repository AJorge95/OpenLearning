import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { addLessonCommentToPage, getNewLessonComments } from '../../src/lesson-comments.ts';

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

test('lesson comment pagination detects partial overlap after concurrent feed changes', () => {
  const existing = [comment('comment-1'), comment('comment-2'), comment('comment-3')];
  const incoming = [comment('comment-3'), comment('comment-4')];

  assert.equal(getNewLessonComments(existing, incoming).length, 1);
  assert.notEqual(getNewLessonComments(existing, incoming).length, incoming.length);
});

test('lesson feedback reloads when any requested page overlaps loaded comments', () => {
  const source = fs.readFileSync(new URL('../../src/pages-learner.tsx', import.meta.url), 'utf8');

  assert.match(source, /newComments\.length !== response\.comments\.length/);
});

test('a newly posted comment is prepended without growing the loaded page', () => {
  const existing = Array.from({ length: 40 }, (_, index) => comment(`comment-${index + 1}`));
  const posted = comment('comment-new');

  const updated = addLessonCommentToPage(existing, posted, 20);

  assert.equal(updated.length, 40);
  assert.equal(updated[0].id, 'comment-new');
  assert.equal(updated.at(-1).id, 'comment-39');
  assert.equal(existing[0].id, 'comment-1');
});

test('adding an already visible comment does not duplicate it', () => {
  const existing = [comment('comment-1')];

  assert.equal(addLessonCommentToPage(existing, existing[0], 20), existing);
});
