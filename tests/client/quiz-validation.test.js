import assert from 'node:assert/strict';
import test from 'node:test';
import { firstQuizTextIssue } from '../../src/quiz-validation.ts';

const validQuestion = {
  prompt: 'Which answer is correct?',
  choices: [{ text: 'First', isCorrect: true }, { text: 'Second', isCorrect: false }],
};

test('accepts an empty draft and complete quiz text', () => {
  assert.equal(firstQuizTextIssue([]), null);
  assert.equal(firstQuizTextIssue([validQuestion]), null);
});

test('returns the first blank question prompt after trimming whitespace', () => {
  assert.deepEqual(firstQuizTextIssue([
    validQuestion,
    { ...validQuestion, prompt: '  ' },
    { ...validQuestion, prompt: '' },
  ]), { questionIndex: 1 });
});

test('returns the first blank answer choice before later question issues', () => {
  assert.deepEqual(firstQuizTextIssue([
    { ...validQuestion, choices: [{ text: 'First', isCorrect: true }, { text: ' \t ', isCorrect: false }] },
    { ...validQuestion, prompt: '' },
  ]), { questionIndex: 0, choiceIndex: 1 });
});
