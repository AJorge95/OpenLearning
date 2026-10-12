import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { formatLearningDeadlineDate, getLearningDeadlineRefreshDelay, getLearningDeadlineStatus } from '../../src/learning-deadline.ts';

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

test('deadline status refresh is scheduled just after the due-time boundary', () => {
  const deadline = Date.parse('2026-11-01T09:30:00Z');

  assert.equal(getLearningDeadlineRefreshDelay(new Date(deadline).toISOString(), deadline - 60_000), 60_001);
  assert.equal(getLearningDeadlineRefreshDelay(new Date(deadline).toISOString(), deadline), 1);
  assert.equal(getLearningDeadlineRefreshDelay(new Date(deadline).toISOString(), deadline + 1), null);
});

test('deadline refresh delay handles invalid and long-future dates safely', () => {
  const deadline = '2026-11-01T09:30:00Z';

  assert.equal(getLearningDeadlineRefreshDelay('not-a-date', 0), null);
  assert.equal(getLearningDeadlineRefreshDelay(deadline, Date.parse(deadline) - 2_147_483_700), 2_147_483_647);
});

test('My Learning deadline links refresh once at the due boundary and clear replaced timers', () => {
  const linkSource = pageSource.slice(pageSource.indexOf('function LearningDeadlineLink'), pageSource.indexOf('\ntype LessonWatchProgress'));

  assert.match(linkSource, /const \[now, setNow\] = useState\(\(\) => Date\.now\(\)\)/);
  assert.match(linkSource, /getLearningDeadlineRefreshDelay\(deadlineAt, now\)/);
  assert.match(linkSource, /window\.setTimeout\(\(\) => setNow\(Date\.now\(\)\), delay\)/);
  assert.match(linkSource, /return \(\) => window\.clearTimeout\(timer\)/);
  assert.match(linkSource, /if \(completed\) return;/);
});

test('My Learning deadline cards reuse one module-level date formatter', () => {
  assert.equal((deadlineSource.match(/new Intl\.DateTimeFormat/g) || []).length, 1);
  assert.match(deadlineSource, /const learningDeadlineDateFormatter = new Intl\.DateTimeFormat/);
  assert.match(myLearningSource, /<LearningDeadlineLink deadlineAt=\{course\.deadlineAt\} completed=\{course\.completed\} \/>/);
  assert.doesNotMatch(myLearningSource, /new Intl\.DateTimeFormat/);
});
