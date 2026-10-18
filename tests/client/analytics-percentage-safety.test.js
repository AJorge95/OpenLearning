import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { normalizePercentage } from '../../src/percentage.ts';

const source = fs.readFileSync(new URL('../../src/pages-manage.tsx', import.meta.url), 'utf8');

test('analytics percentage text clamps malformed numeric values', () => {
  assert.equal(normalizePercentage(-10), 0);
  assert.equal(normalizePercentage(42.5), 42.5);
  assert.equal(normalizePercentage(150), 100);
  assert.equal(normalizePercentage(Number.NaN), 0);
  assert.equal(normalizePercentage(Number.POSITIVE_INFINITY), 0);
});

test('analytics rate and score cells share the normalized percentage renderer', () => {
  assert.match(source, /function Percentage\(\{ value \}: \{ value: number \}\) \{\s*return <span className="analytics-percentage">\{normalizePercentage\(value\)\}%<\/span>;/);
  assert.match(source, /data\.summary\.completionRate === null \? '—' : <Percentage value=\{data\.summary\.completionRate\} \/>/);
  assert.match(source, /data\.summary\.averageProgress === null \? '—' : <Percentage value=\{data\.summary\.averageProgress\} \/>/);
  assert.match(source, /quiz\.participationRate === null \? '—' : <Percentage value=\{quiz\.participationRate\} \/>/);
  assert.match(source, /quiz\.averageScore === null \? '—' : <Percentage value=\{quiz\.averageScore\} \/>/);
});
