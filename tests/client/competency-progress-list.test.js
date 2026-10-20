import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { COMPETENCY_PROGRESS_PAGE_SIZE } from '../../shared/competency-progress.js';
import { appendUnchangedCompetencyPage } from '../../src/competency-progress.ts';

test('competency progress uses the shared server page size', () => {
  assert.equal(COMPETENCY_PROGRESS_PAGE_SIZE, 12);
});

test('competency progress fetches bounded pages and keeps the overall achieved summary', () => {
  const source = fs.readFileSync(new URL('../../src/pages-programs.tsx', import.meta.url), 'utf8');

  assert.match(source, /api\.get<CompetencyProgressPage>\('\/api\/competencies\?page=1'/);
  assert.match(source, /api\.get<CompetencyProgressPage>\(`\/api\/competencies\?page=\$\{nextPage\}`/);
  assert.match(source, /setAchievedCompetencyTotal\(result\.achievedTotal \?\? 0\)/);
  assert.match(source, /\{achievedCompetencyTotal\} of \{competencyTotal\} competencies achieved/);
  assert.match(source, /Showing \{competencies\.length\} of \{competencyTotal\} competencies/);
  assert.match(source, /appendUnchangedCompetencyPage\(\s*competencies, result\.competencies, nextPage, result\.page, competencyTotal, result\.total,/);
  assert.match(source, /if \(!nextCompetencies\) \{\s*setReloadSequence\(\(current\) => current \+ 1\);/);
  assert.match(source, /setCompetencies\(nextCompetencies\)/);
  assert.match(source, /if \(!result\.hasMore\) window\.requestAnimationFrame\(\(\) => competencyListStatusRef\.current\?\.focus\(\)\)/);
});

test('competency page appends when its page and total still match the list', () => {
  const existing = [{ id: 'competency-1' }, { id: 'competency-2' }];
  const incoming = [{ id: 'competency-3' }];

  assert.deepEqual(appendUnchangedCompetencyPage(existing, incoming, 2, 2, 3, 3), [...existing, ...incoming]);
  assert.deepEqual(existing, [{ id: 'competency-1' }, { id: 'competency-2' }]);
});

test('competency page refreshes when an offset is clamped after a removal', () => {
  const existing = [{ id: 'competency-1' }, { id: 'competency-2' }];
  const clampedPage = [{ id: 'competency-1' }, { id: 'competency-2' }];

  assert.equal(appendUnchangedCompetencyPage(existing, clampedPage, 2, 1, 3, 2), null);
});

test('competency page refreshes when the total changes or an ID overlaps', () => {
  const existing = [{ id: 'competency-1' }, { id: 'competency-2' }];
  const overlappingPage = [{ id: 'competency-2' }, { id: 'competency-3' }];

  assert.equal(appendUnchangedCompetencyPage(existing, [{ id: 'competency-3' }], 2, 2, 3, 4), null);
  assert.equal(appendUnchangedCompetencyPage(existing, overlappingPage, 2, 2, 3, 3), null);
});

test('competency page loading and retry states are announced and actionable', () => {
  const source = fs.readFileSync(new URL('../../src/pages-programs.tsx', import.meta.url), 'utf8');

  assert.match(source, /role="status" aria-live="polite">\s*\{loadingMoreCompetencies \? 'Loading more competencies\. ' : ''\}/);
  assert.match(source, /\{loadMoreCompetenciesError && <div className="error-notice error-notice-actionable competency-progress-load-error" role="alert">/);
  assert.match(source, /disabled=\{loadingMoreCompetencies\} aria-busy=\{loadingMoreCompetencies\}/);
  const styles = fs.readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');
  assert.match(styles, /\.competency-progress-status\s*\{[^}]*display:\s*grid;[^}]*min-width:\s*0;/);
  assert.match(styles, /\.competency-progress-load-error\s*\{\s*margin:\s*0;\s*\}/);
});

test('mapped course completion states are announced alongside each course title', () => {
  const source = fs.readFileSync(new URL('../../src/pages-programs.tsx', import.meta.url), 'utf8');
  const mappedCourses = source.match(/<ul>\{item\.courses\.map\(\(course\) => \(\s*<li key=\{course\.id\}>[\s\S]*?<\/li>\s*\)\)\}<\/ul>/)?.[0] || '';

  assert.match(mappedCourses, /course\.completed \? <Check size=\{15\} aria-hidden="true" \/> : <BookOpen size=\{15\} aria-hidden="true" \/>/);
  assert.match(mappedCourses, /<Link className="competency-course-link" to=\{`\/courses\/\$\{course\.id\}`\}>\{course\.title\}<\/Link>\s*<span className="sr-only">, \{course\.completed \? 'completed' : 'not completed'\}<\/span>/);
});
