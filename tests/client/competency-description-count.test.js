import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../../src/pages-programs.tsx', import.meta.url), 'utf8');
const adminSource = source.slice(source.indexOf('export function AdminCompetenciesPage'), source.indexOf('function CompetencyAdminPagination'));
const styles = fs.readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');
const routes = fs.readFileSync(new URL('../../server/routes-programs.js', import.meta.url), 'utf8');

test('competency descriptions expose a count matching create and update limits', () => {
  assert.match(adminSource,
    /<label className="program-full-field">Description<textarea id="competency-description" aria-describedby="competency-description-count" rows=\{2\} maxLength=\{2000\} value=\{description\}/);
  assert.match(adminSource,
    /<small id="competency-description-count" className="field-character-count">\{description\.length\} \/ 2,000 characters<\/small>/);
  assert.match(styles, /\.field-character-count\s*\{[^}]*align-self:\s*flex-end[^}]*justify-self:\s*end/);
  assert.match(routes, /const description = text\(req\.body\?\.description, 'Description', 2000\)/);
  assert.match(routes, /const description = body\.description === undefined \? current\.description : text\(body\.description, 'Description', 2000\)/);
});
