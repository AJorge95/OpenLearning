import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../../src/pages-learner.tsx', import.meta.url), 'utf8');
const compactSource = source.replace(/\s+/g, ' ');

test('quiz results provide an accessible aggregate score without answer review', () => {
  assert.match(compactSource, /<div className=\{`score-panel \$\{currentResult\.passed \? 'score-pass' : 'score-retry'\}`\} role="status">/);
  assert.match(compactSource, /hasQuizAttemptBreakdown\(currentResult\) \? `\$\{currentResult\.correctCount\} of \$\{currentResult\.questionCount\} correct` : 'Question breakdown unavailable'/);
  assert.match(compactSource, /<h2 ref=\{resultHeadingRef\} tabIndex=\{-1\}>\{examQuiz \? 'Exam result' : 'Quiz result'\}<\/h2>/);
  assert.doesNotMatch(compactSource, /Review your answers|Correct answer:|Your answer is (?:correct|incorrect)/);
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
  assert.match(compactSource, /if \(isCurrentSubmission\(\)\) \{ focusResultRef\.current = true; setResult\(response\.attempt\);/);
  assert.match(compactSource, /if \(currentResult && focusResultRef\.current\) \{ focusResultRef\.current = false; resultHeadingRef\.current\?\.focus\(\); \} else if \(!currentResult && focusFirstAnswerRef\.current\) \{ focusFirstAnswerRef\.current = false; firstAnswerRef\.current\?\.focus\(\);/);
  assert.match(compactSource, /async function retryQuiz\(\) \{.*?focusFirstAnswerRef\.current = true; setChoiceShuffleGeneration\(\(generation\) => generation \+ 1\); setAnswers\(\{\}\); setResult\(null\);/);
});

test('each quiz question exposes its required answer through native radio semantics', () => {
  assert.match(source, /type="radio" name=\{question\.id\} value=\{choice\.id\} required checked=/);
  assert.match(source, /allAnswered = quiz\.questions\.length > 0 && answeredCount === quiz\.questions\.length/);
});
