import assert from 'node:assert/strict';
import test from 'node:test';
import { userListEmptyMessage } from './user-list-empty-state.ts';

test('account list empty messages describe the active search and role filters', () => {
  assert.equal(userListEmptyMessage('', 'all'), 'No user accounts found.');
  assert.equal(userListEmptyMessage('   ', 'admin'), 'No administrator accounts found.');
  assert.equal(userListEmptyMessage('', 'moderator'), 'No moderator accounts found.');
  assert.equal(userListEmptyMessage('alice', 'learner'), 'No learner accounts match this search.');
  assert.equal(userListEmptyMessage('alice', 'all'), 'No users match this search.');
});
