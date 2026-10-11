import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { nextVisibleCompetencyCount, COMPETENCY_PROGRESS_BATCH_SIZE } from '../../src/competency-progress-list.ts';

test('competency progress reveals bounded batches and clamps the final batch', () => {
  assert.equal(COMPETENCY_PROGRESS_BATCH_SIZE, 12);
  assert.equal(nextVisibleCompetencyCount(12, 40), 24);
  assert.equal(nextVisibleCompetencyCount(36, 40), 40);
  assert.equal(nextVisibleCompetencyCount(48, 40), 40);
  assert.equal(nextVisibleCompetencyCount(-5, 4), 4);
});

test('competency progress keeps overall totals while rendering a bounded card list', () => {
  const source = fs.readFileSync(new URL('../../src/pages-programs.tsx', import.meta.url), 'utf8');

  assert.match(source, /const achieved = competencies\.filter\(\(item\) => item\.achieved\)\.length/);
  assert.match(source, /const visibleCompetencies = competencies\.slice\(0, visibleCompetencyCount\)/);
  assert.match(source, /\{achieved\} of \{competencies\.length\} competencies achieved/);
  assert.match(source, /role="status" aria-live="polite">Showing \{visibleCompetencies\.length\} of \{competencies\.length\} competencies/);
  assert.match(source, /Show \{Math\.min\(COMPETENCY_PROGRESS_BATCH_SIZE, competencies\.length - visibleCompetencyCount\)\} more competencies/);
  assert.match(source, /if \(nextCount === competencies\.length\) window\.requestAnimationFrame\(\(\) => competencyListStatusRef\.current\?\.focus\(\)\)/);
});
