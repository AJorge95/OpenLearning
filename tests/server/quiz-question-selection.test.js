import assert from 'node:assert/strict';
import test from 'node:test';
import { selectRandomQuizQuestions } from '../../server/quiz-question-selection.js';

test('random selection returns the requested number without duplicates', () => {
  const questions = Array.from({ length: 65 }, (_value, index) => ({ id: `question-${index}` }));
  const selected = selectRandomQuizQuestions(questions, 60);

  assert.equal(selected.length, 60);
  assert.equal(new Set(selected.map((question) => question.id)).size, 60);
  assert.equal(questions.length, 65);
});

test('random selection honors the requested count and all-questions configuration', () => {
  const questions = [{ id: 'one' }, { id: 'two' }, { id: 'three' }];
  assert.deepEqual(selectRandomQuizQuestions(questions, 2, () => 0).map((question) => question.id), ['one', 'two']);
  assert.deepEqual(new Set(selectRandomQuizQuestions(questions, questions.length).map((question) => question.id)), new Set(['one', 'two', 'three']));
});

test('random selection rejects counts outside the available bank', () => {
  assert.throws(() => selectRandomQuizQuestions([], 1), RangeError);
  assert.throws(() => selectRandomQuizQuestions([{ id: 'one' }], -1), RangeError);
  assert.throws(() => selectRandomQuizQuestions([{ id: 'one' }], 1.5), RangeError);
});
