import assert from 'node:assert/strict';
import test from 'node:test';
import { quizPriorPassNotice } from '../../src/quiz-prior-pass.ts';

test('explains when a previous quiz pass still counts before a current-version attempt', () => {
  assert.equal(
    quizPriorPassNotice(true, null),
    'A previous passing result still counts toward course completion. You can take this quiz again to record another result.',
  );
});

test('explains that an earlier pass still counts after a failed retake', () => {
  assert.equal(
    quizPriorPassNotice(true, false),
    'A previous passing result still counts toward course completion, even though this attempt did not pass.',
  );
});

test('does not show prior-pass guidance without an earlier pass or after a passing current attempt', () => {
  assert.equal(quizPriorPassNotice(false, null), null);
  assert.equal(quizPriorPassNotice(false, false), null);
  assert.equal(quizPriorPassNotice(true, true), null);
});
