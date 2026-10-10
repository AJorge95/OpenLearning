import assert from 'node:assert/strict';
import test from 'node:test';
import { courseEditingNote } from '../../src/course-editing-note.ts';

test('explains that published learners keep their version while a revision is in progress', () => {
  assert.equal(
    courseEditingNote('published', 'public'),
    'Learners continue to see the current published version while you work on a revision. Publish it when it is ready.',
  );
});

test('limits the published-course note to learners with access for private courses', () => {
  assert.equal(
    courseEditingNote('published', 'private'),
    'Learners with access continue to see the current published version while you work on a revision. Publish it when it is ready.',
  );
});

test('explains that draft changes stay hidden until publication', () => {
  assert.equal(courseEditingNote('draft', 'public'), 'This draft is hidden from learners until you publish it.');
});

test('explains how to make an archived course available again', () => {
  assert.equal(
    courseEditingNote('archived', 'private'),
    'This course is archived and hidden from learners. Save it as a draft or publish it to make it available again.',
  );
});
