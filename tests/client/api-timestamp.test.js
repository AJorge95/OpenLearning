import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { parseApiTimestamp } from '../../src/api-timestamp.ts';

test('parses SQLite UTC timestamps consistently in an eastward timezone', () => {
  const previousTimezone = process.env.TZ;
  try {
    process.env.TZ = 'Pacific/Kiritimati';

    assert.equal(parseApiTimestamp('2026-10-12 08:00:00').toISOString(), '2026-10-12T08:00:00.000Z');
    assert.equal(parseApiTimestamp('2026-10-12T08:00:00').toISOString(), '2026-10-12T08:00:00.000Z');
  } finally {
    if (previousTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimezone;
  }
});

test('preserves explicit UTC and offset timestamps', () => {
  assert.equal(parseApiTimestamp('2026-10-12T08:00:00Z').toISOString(), '2026-10-12T08:00:00.000Z');
  assert.equal(parseApiTimestamp('2026-10-12 10:00:00+02:00').toISOString(), '2026-10-12T08:00:00.000Z');
  assert.equal(parseApiTimestamp('2026-10-12T10:00:00+02:00').toISOString(), '2026-10-12T08:00:00.000Z');
});

test('all database timestamp renderers use the shared parser', () => {
  const repositoryRoot = new URL('../..', import.meta.url);
  const manageSource = fs.readFileSync(new URL('src/pages-manage.tsx', repositoryRoot), 'utf8');
  const learnerSource = fs.readFileSync(new URL('src/pages-learner.tsx', repositoryRoot), 'utf8');

  for (const expression of [
    'parseApiTimestamp(value)',
    'formatApiTimestamp(review.submittedAt, logTimestampFormatter)',
    'formatApiTimestamp(currentVersion.published_at, logTimestampFormatter)',
    'formatApiTimestamp(version.published_at, logTimestampFormatter)',
  ]) assert.ok(manageSource.includes(expression), `${expression} should be used by management timestamp renderers`);
  assert.ok(learnerSource.includes('parseApiTimestamp(value)'), 'certificate and comment timestamps should use the shared parser');
  assert.doesNotMatch(manageSource, /new Date\((?:review\.submittedAt|currentVersion\.published_at|version\.published_at)\)/);
});

test('returns an invalid Date for malformed timestamps so existing fallback copy is retained', () => {
  assert.ok(Number.isNaN(parseApiTimestamp('not-a-timestamp').getTime()));
});
