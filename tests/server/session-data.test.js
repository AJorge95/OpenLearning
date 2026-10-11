import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSessionData, sessionUserIdFromJson } from '../../server/session-data.js';

test('parses object session data and rejects malformed or non-object JSON', () => {
  assert.deepEqual(parseSessionData('{"userId":"learner-1"}'), { userId: 'learner-1' });
  assert.equal(parseSessionData('{'), null);
  assert.equal(parseSessionData('null'), null);
  assert.equal(parseSessionData('[]'), null);
  assert.equal(parseSessionData('"session"'), null);
});

test('legacy session ownership only uses a string user ID from valid object data', () => {
  assert.equal(sessionUserIdFromJson('{"userId":"learner-1"}'), 'learner-1');
  assert.equal(sessionUserIdFromJson('{"userId":42}'), null);
  assert.equal(sessionUserIdFromJson('{"other":"value"}'), null);
  assert.equal(sessionUserIdFromJson('{'), null);
});
