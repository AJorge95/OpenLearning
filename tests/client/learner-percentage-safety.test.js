import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { formatPercentage } from '../../src/percentage.ts';

const componentSource = fs.readFileSync(new URL('../../src/components.tsx', import.meta.url), 'utf8');
const learnerSource = fs.readFileSync(new URL('../../src/pages-learner.tsx', import.meta.url), 'utf8');
const programsSource = fs.readFileSync(new URL('../../src/pages-programs.tsx', import.meta.url), 'utf8');

test('learner-facing percentage labels share the bounded progress formatter', () => {
  assert.equal(formatPercentage(-10), '0%');
  assert.equal(formatPercentage(42.5), '42.5%');
  assert.equal(formatPercentage(150), '100%');
  assert.equal(formatPercentage(Number.NaN), '0%');
  assert.equal(formatPercentage(null), '—');

  assert.match(componentSource, /course\.completed \? 'Completed' : `\$\{formatPercentage\(course\.progress\)\} complete`/);
  assert.match(programsSource, /<strong>\{formatPercentage\(Math\.round\(path\.completedCourses \/ path\.courseCount \* 100\)\)\}<\/strong>/);
  assert.match(learnerSource, /progress-caption">\{formatPercentage\(course\.progress\)\} complete/);
  assert.match(learnerSource, /<small>\{formatPercentage\(course\.progress\)\} complete<\/small>/);
  assert.match(learnerSource, /<span>Pass mark \{formatPercentage\(quiz\.passMark\)\}<\/span>/);
  assert.match(learnerSource, /Score \{formatPercentage\(currentResult\.score\)\}/);
  assert.match(learnerSource, /Pass mark: \$\{formatPercentage\(quiz\.passMark\)\}/);
  assert.match(learnerSource, /<strong>\{formatPercentage\(course\.progress\)\}<\/strong><ProgressBar value=\{course\.progress\}/);
});
