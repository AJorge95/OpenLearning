import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../../src/pages-learner.tsx', import.meta.url), 'utf8');

test('quiz review labels each selected answer with its correctness in text', () => {
  assert.match(source, /<strong>\{answerIsCorrect \? 'Your answer is correct: ' : 'Your answer is incorrect: '\}<\/strong>/);
  assert.match(source, /className=\{answerIsCorrect \? 'answer-correct' : 'answer-incorrect'\}/);
  assert.match(source, /!answerIsCorrect && <p className="correct-answer">Correct answer:/);
});
