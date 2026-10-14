import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { formatApiTimestamp } from '../../src/format-api-timestamp.ts';
import { parseApiTimestamp } from '../../src/api-timestamp.ts';

const sourceDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src');

test('management timestamp formatting preserves valid values and falls back for malformed values', () => {
  const formatter = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });
  const valid = '2026-10-14 12:34:56';
  assert.equal(formatApiTimestamp(valid, formatter), formatter.format(parseApiTimestamp(valid)));
  assert.equal(formatApiTimestamp('not-a-timestamp', formatter), '—');
  assert.equal(formatApiTimestamp('not-a-timestamp', formatter, 'Unavailable'), 'Unavailable');
});

test('course governance timestamps use the safe formatter', () => {
  const source = fs.readFileSync(path.join(sourceDirectory, 'pages-manage.tsx'), 'utf8');
  for (const expression of [
    'formatApiTimestamp(review.submittedAt, logTimestampFormatter)',
    'formatApiTimestamp(currentVersion.published_at, logTimestampFormatter)',
    'formatApiTimestamp(version.published_at, logTimestampFormatter)',
  ]) assert.ok(source.includes(expression), `${expression} should use the safe timestamp formatter`);
  assert.doesNotMatch(source, /logTimestampFormatter\.format\(parseApiTimestamp\((?:review\.submittedAt|currentVersion\.published_at|version\.published_at)\)\)/);
});
