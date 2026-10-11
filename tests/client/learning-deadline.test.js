import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { formatLearningDeadlineDate, getLearningDeadlineStatus } from '../../src/learning-deadline.ts';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const pageSource = fs.readFileSync(path.join(repositoryRoot, 'src/pages-learner.tsx'), 'utf8');
const deadlineSource = fs.readFileSync(path.join(repositoryRoot, 'src/learning-deadline.ts'), 'utf8');
const myLearningSource = pageSource.slice(
  pageSource.indexOf('export function MyLearningPage'),
  pageSource.indexOf('export function CourseCertificatePage'),
);

test('deadline status keeps completed courses complete and separates due-time boundaries', () => {
  const now = Date.parse('2026-10-11T12:00:00Z');

  assert.equal(getLearningDeadlineStatus('2026-10-11T11:59:59Z', false, now), 'overdue');
  assert.equal(getLearningDeadlineStatus('2026-10-11T12:00:00Z', false, now), 'upcoming');
  assert.equal(getLearningDeadlineStatus('2026-10-11T12:00:01Z', false, now), 'upcoming');
  assert.equal(getLearningDeadlineStatus('2026-10-11T11:00:00Z', true, now), 'completed');
});

test('deadline formatting returns a readable localized date and time', () => {
  const value = '2026-11-01T09:30:00Z';
  const expected = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));

  assert.equal(formatLearningDeadlineDate(value), expected);
});

test('My Learning deadline cards reuse one module-level date formatter', () => {
  assert.equal((deadlineSource.match(/new Intl\.DateTimeFormat/g) || []).length, 1);
  assert.match(deadlineSource, /const learningDeadlineDateFormatter = new Intl\.DateTimeFormat/);
  assert.match(myLearningSource, /<LearningDeadlineLink deadlineAt=\{course\.deadlineAt\} completed=\{course\.completed\} \/>/);
  assert.doesNotMatch(myLearningSource, /new Intl\.DateTimeFormat/);
});
