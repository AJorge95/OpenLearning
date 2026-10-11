import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../../src/pages-learner.tsx', import.meta.url), 'utf8');

test('quiz review labels each selected answer with its correctness in text', () => {
  assert.match(source, /<strong>\{answerIsCorrect \? 'Your answer is correct: ' : 'Your answer is incorrect: '\}<\/strong>/);
  assert.match(source, /className=\{answerIsCorrect \? 'answer-correct' : 'answer-incorrect'\}/);
  assert.match(source, /!answerIsCorrect && <p className="correct-answer">Correct answer:/);
});

test('quiz submission and retry move focus into the newly displayed view', () => {
  assert.match(source, /if \(isCurrentSubmission\(\)\) \{\s*focusReviewRef\.current = true;\s*setResult\(response\.attempt\)/);
  assert.match(source, /if \(currentResult && focusReviewRef\.current\) \{\s*focusReviewRef\.current = false;\s*reviewHeadingRef\.current\?\.focus\(\);\s*\} else if \(!currentResult && focusFirstAnswerRef\.current\) \{\s*focusFirstAnswerRef\.current = false;\s*firstAnswerRef\.current\?\.focus\(\);/);
  assert.match(source, /function retryQuiz\(\) \{\s*focusFirstAnswerRef\.current = true;\s*setAnswers\(\{\}\); setResult\(null\);/);
});

test('each quiz question exposes its required answer through native radio semantics', () => {
  assert.match(source, /type="radio" name=\{question\.id\} value=\{choice\.id\} required checked=/);
  assert.match(source, /allAnswered = quiz\.questions\.length > 0 && answeredCount === quiz\.questions\.length/);
});
