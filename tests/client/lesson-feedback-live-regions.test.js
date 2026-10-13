import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../../src/pages-learner.tsx', import.meta.url), 'utf8');

test('lesson feedback mounts action announcements only when they contain a message', () => {
  assert.match(source, /\{commentPostedNotice\?\.courseId === courseId && commentPostedNotice\.lessonId === lessonId && <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">Your comment was posted\.<\/p>\}/);
  assert.match(source, /\{commentModerationNotice\?\.courseId === courseId && commentModerationNotice\.lessonId === lessonId && commentModerationNotice\.message && <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">\{commentModerationNotice\.message\}<\/p>\}/);
});

test('lesson feedback mounts posting and pagination announcements only while busy', () => {
  assert.match(source, /\{commentSaving && <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">Posting comment…<\/p>\}/);
  assert.match(source, /\{commentsLoading && <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">Loading more comments\.<\/p>\}/);
});
