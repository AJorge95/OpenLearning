import assert from 'node:assert/strict';
import test from 'node:test';
import { formatCountLabel } from '../../src/count-label.ts';

test('formats count labels with singular and explicit plural nouns', () => {
  assert.equal(formatCountLabel(0, 'lesson', 'lessons'), '0 lessons');
  assert.equal(formatCountLabel(1, 'lesson', 'lessons'), '1 lesson');
  assert.equal(formatCountLabel(2, 'quiz', 'quizzes'), '2 quizzes');
});
