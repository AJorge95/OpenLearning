import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { COMPETENCY_PROGRESS_PAGE_SIZE } from '../../shared/competency-progress.js';

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
  assert.match(source, /setCompetencies\(\(current\) => \[\.\.\.current, \.\.\.result\.competencies\]\)/);
  assert.match(source, /if \(!result\.hasMore\) window\.requestAnimationFrame\(\(\) => competencyListStatusRef\.current\?\.focus\(\)\)/);
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
  const mappedCourses = source.match(/<ul>\{item\.courses\.map\(\(course\) => <li key=\{course\.id\}>.*?<\/ul>/s)?.[0] || '';

  assert.match(mappedCourses, /course\.completed \? <Check size=\{15\} aria-hidden="true" \/> : <BookOpen size=\{15\} aria-hidden="true" \/>/);
  assert.match(mappedCourses, /<span>\{course\.title\}<span className="sr-only">, \{course\.completed \? 'completed' : 'not completed'\}<\/span><\/span>/);
});
