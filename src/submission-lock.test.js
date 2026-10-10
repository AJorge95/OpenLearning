import assert from 'node:assert/strict';
import test from 'node:test';
import { acquireSubmissionLock, releaseSubmissionLock } from './submission-lock.ts';

test('submission lock rejects a duplicate until the active request releases it', () => {
  const lock = { current: false };

  assert.equal(acquireSubmissionLock(lock), true);
  assert.equal(acquireSubmissionLock(lock), false);

  releaseSubmissionLock(lock);

  assert.equal(acquireSubmissionLock(lock), true);
});

test('submission locks for separate forms do not block one another', () => {
  const profileLock = { current: false };
  const passwordLock = { current: false };

  assert.equal(acquireSubmissionLock(profileLock), true);
  assert.equal(acquireSubmissionLock(passwordLock), true);
});
