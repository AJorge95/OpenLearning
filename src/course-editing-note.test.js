import assert from 'node:assert/strict';
import test from 'node:test';
import { courseEditingNote } from './course-editing-note.ts';

test('explains that saved edits to a published public course are visible right away', () => {
  assert.equal(
    courseEditingNote('published', 'public'),
    'Changes you save to this published course are visible right away to learners.',
  );
});

test('limits the published-course note to learners with access for private courses', () => {
  assert.equal(
    courseEditingNote('published', 'private'),
    'Changes you save to this published course are visible right away to learners with course access.',
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
