import assert from 'node:assert/strict';
import test from 'node:test';
import { formatRedactedLogJson, redactLogEntryForCopy } from '../../src/log-export.ts';

test('redacted audit JSON masks person IDs and identity fields repeated in summaries', () => {
  const entry = {
    id: 14,
    actorUsername: 'admin.operator',
    action: 'account.created',
    entityType: 'user',
    entityId: '7',
    summary: 'Created account for learner-seven (user 7)',
    details: {
      username: 'learner-seven',
      email: 'learner@example.test',
      role: 'learner',
      password: 'never-copy-this',
    },
  };

  const output = redactLogEntryForCopy(entry);
  const serialized = formatRedactedLogJson(entry);

  assert.equal(output.actorUsername, '[redacted]');
  assert.equal(output.entityId, '[redacted]');
  assert.equal(output.details.username, '[redacted]');
  assert.equal(output.details.email, '[redacted]');
  assert.equal(output.details.password, '[redacted]');
  assert.equal(output.details.role, 'learner');
  assert.match(output.summary, /Created account for \[redacted\] \(user \[redacted\]\)/);
  for (const value of ['admin.operator', 'learner-seven', 'learner@example.test', 'never-copy-this']) {
    assert.equal(serialized.includes(value), false, `${value} should not be copied`);
  }
});

test('redacted audit JSON masks contact and credential values embedded in log text', () => {
  const serialized = formatRedactedLogJson({
    summary: 'Contact learner@example.org from 203.0.113.42; password="hunter2"',
    details: {
      message: 'Authorization: Bearer eyJhbGci.abc',
      safeContext: 'Account update completed',
    },
  });

  for (const value of ['learner@example.org', '203.0.113.42', 'hunter2', 'eyJhbGci.abc']) {
    assert.equal(serialized.includes(value), false, `${value} should not be copied`);
  }
  assert.match(serialized, /Account update completed/);
});

test('redacting an audit entry leaves the source object unchanged', () => {
  const entry = {
    actorUsername: 'admin.operator',
    entityType: 'account',
    entityId: '12',
    summary: 'Updated admin.operator',
    details: { email: 'admin@example.org' },
  };
  const original = structuredClone(entry);

  redactLogEntryForCopy(entry);

  assert.deepEqual(entry, original);
});
