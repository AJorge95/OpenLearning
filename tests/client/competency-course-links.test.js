import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const pagesSource = fs.readFileSync(new URL('../../src/pages-programs.tsx', import.meta.url), 'utf8');
const stylesSource = fs.readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');
const progressPage = pagesSource.slice(
  pagesSource.indexOf('export function CompetenciesPage()'),
  pagesSource.indexOf('export function AdminCompetenciesPage()'),
);

test('learner competency mappings link to accessible courses with keyboard and touch support', () => {
  assert.match(progressPage, /The API has already filtered out courses the learner cannot access\./);
  assert.match(progressPage, /<Link className="competency-course-link" to=\{`\/courses\/\$\{course\.id\}`\}>\{course\.title\}<\/Link>/);
  assert.match(progressPage, /<span className="sr-only">, \{course\.completed \? 'completed' : 'not completed'\}<\/span>/);
  assert.match(stylesSource, /\.competency-course-link \{[^}]*min-height: 40px;[^}]*overflow-wrap: anywhere;/);
  assert.match(stylesSource, /\.competency-course-link:focus-visible \{ outline: 2px solid var\(--purple\); outline-offset: 2px; \}/);
});
