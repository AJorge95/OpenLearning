import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../../src/pages-learner.tsx', import.meta.url), 'utf8');

test('quiz results provide an accessible aggregate score without answer review', () => {
  assert.match(source, /<div className=\{`score-panel \$\{currentResult\.passed \? 'score-pass' : 'score-retry'\}`\} role="status">/);
  assert.match(source, /hasQuizAttemptBreakdown\(currentResult\) \? `\$\{currentResult\.correctCount\} of \$\{currentResult\.questionCount\} correct` : 'Question breakdown unavailable'/);
  assert.match(source, /<h2 ref=\{resultHeadingRef\} tabIndex=\{-1\}>Quiz result<\/h2>/);
  assert.doesNotMatch(source, /Review your answers|Correct answer:|Your answer is (?:correct|incorrect)/);
});

test('failed attempt-detail requests preserve the saved score and only retry transient errors', () => {
  assert.match(source, /catch \(cause\) \{\s*if \(isCurrentRequest\(\) && !requestController\.signal\.aborted\) \{\s*const unavailable = cause instanceof ApiError && cause\.code === 'quiz_attempt_details_unavailable';\s*setAttemptDetailsFailure\(unavailable \? 'unavailable' : 'retryable'\);/);
  assert.match(source, /Your saved score is available, but its question breakdown could not be read\. Contact your course administrator\./);
  assert.match(source, /setResult\(latestAttempt\);\s*setResultRouteKey\(requestedRouteKey\);/);
  assert.match(source, /attemptDetailsFailure && <ErrorNotice message=\{error\} onRetry=\{attemptDetailsFailure === 'retryable' \? \(\) => setCourseLoadRetryVersion/);
  assert.match(source, /function hasQuizAttemptBreakdown\(attempt: QuizAttempt \| QuizAttemptPreview\): attempt is QuizAttempt/);
});

test('quiz result feedback includes the score and the threshold for passing', () => {
  assert.match(source, /Score \{currentResult\.score\}% ·/);
  assert.match(source, /Pass mark: \$\{quiz\.passMark\}%\./);
  assert.match(source, /You need \$\{quiz\.passMark\}% to pass\./);
});

test('quiz submission and retry move focus into the newly displayed view', () => {
  assert.match(source, /if \(isCurrentSubmission\(\)\) \{\s*focusResultRef\.current = true;\s*setResult\(response\.attempt\)/);
  assert.match(source, /if \(currentResult && focusResultRef\.current\) \{\s*focusResultRef\.current = false;\s*resultHeadingRef\.current\?\.focus\(\);\s*\} else if \(!currentResult && focusFirstAnswerRef\.current\) \{\s*focusFirstAnswerRef\.current = false;\s*firstAnswerRef\.current\?\.focus\(\);/);
  assert.match(source, /function retryQuiz\(\) \{\s*focusFirstAnswerRef\.current = true;\s*setChoiceShuffleGeneration\(\(generation\) => generation \+ 1\);\s*setAnswers\(\{\}\); setResult\(null\);/);
});

test('each quiz question exposes its required answer through native radio semantics', () => {
  assert.match(source, /type="radio" name=\{question\.id\} value=\{choice\.id\} required checked=/);
  assert.match(source, /allAnswered = quiz\.questions\.length > 0 && answeredCount === quiz\.questions\.length/);
});
