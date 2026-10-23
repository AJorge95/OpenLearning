import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { addLessonCommentToPage, getNewLessonComments } from '../../src/lesson-comments.ts';

function comment(id, createdAt = '2026-10-10 12:00:00') {
  return { id, body: `Comment ${id}`, username: 'learner', createdAt };
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

test('lesson feedback reloads when a same-count change moves the loaded page boundary', () => {
  const source = fs.readFileSync(new URL('../../src/pages-learner.tsx', import.meta.url), 'utf8');

  assert.match(source, /anchorId=\$\{encodeURIComponent\(anchorId\)\}/);
  assert.match(source, /!response\.paginationStable/);
});

test('loading another comment page announces progress to assistive technology', () => {
  const source = fs.readFileSync(new URL('../../src/pages-learner.tsx', import.meta.url), 'utf8');

  assert.match(source, /\{commentsLoading && <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">Loading more comments\.<\/p>\}/);
});

test('lesson comment composer keeps a visible label and associated audience guidance', () => {
  const source = fs.readFileSync(new URL('../../src/pages-learner.tsx', import.meta.url), 'utf8');
  const composer = source.match(/<form className="lesson-comment-form"[\s\S]*?<\/form>/)?.[0];

  assert.ok(composer, 'Expected the lesson comment composer form.');
  assert.match(composer, /<label htmlFor="lesson-comment">Add a comment<\/label>/);
  assert.match(composer, /<textarea id="lesson-comment" aria-describedby="lesson-comment-hint"/);
  assert.match(composer, /id="lesson-comment-hint">\{commentDraft\.length\}\/2,000 characters · visible to learners with course access<\/small>/);
});

test('lesson comment authors are headings within the feedback section', () => {
  const source = fs.readFileSync(new URL('../../src/pages-learner.tsx', import.meta.url), 'utf8');
  const styles = fs.readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');

  assert.match(source, /<section className="lesson-feedback" aria-labelledby="lesson-feedback-title">[\s\S]*?<h2[^>]*id="lesson-feedback-title"/);
  assert.match(source, /return <article className="lesson-comment" key=\{comment\.id\}>[\s\S]*?<header><h3>\{comment\.username\}<\/h3>/);
  assert.match(styles, /\.lesson-comment header h3 \{ margin: 0; color: var\(--ink\); font-size: 13px; font-weight: 650; \}/);
});

test('a newly posted comment follows server order without growing the loaded page', () => {
  const existing = Array.from({ length: 40 }, (_, index) => comment(`comment-${String(40 - index).padStart(3, '0')}`));
  const posted = comment('comment-new');

  const updated = addLessonCommentToPage(existing, posted, 20);

  assert.equal(updated.length, 40);
  assert.equal(updated[0].id, 'comment-new');
  assert.equal(updated.at(-1).id, 'comment-002');
  assert.equal(existing[0].id, 'comment-040');
});

test('a posted comment sharing a timestamp is inserted by descending ID', () => {
  const existing = [comment('f000'), comment('c000')];
  const posted = comment('b000');

  const updated = addLessonCommentToPage(existing, posted, 20);

  assert.deepEqual(updated.map(({ id }) => id), ['f000', 'c000', 'b000']);
});

test('a comment with an older timestamp is inserted after newer comments', () => {
  const existing = [comment('a000', '2026-10-10 12:00:01')];
  const posted = comment('z000', '2026-10-10 12:00:00');

  const updated = addLessonCommentToPage(existing, posted, 20);

  assert.deepEqual(updated.map(({ id }) => id), ['a000', 'z000']);
});

test('adding an already visible comment does not duplicate it', () => {
  const existing = [comment('comment-1')];

  assert.equal(addLessonCommentToPage(existing, existing[0], 20), existing);
});
