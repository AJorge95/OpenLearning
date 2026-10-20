import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../../src/pages-programs.tsx', import.meta.url), 'utf8');
const adminSource = source.slice(
  source.indexOf('export function AdminCompetenciesPage'),
  source.indexOf('function CompetencyAdminPagination'),
);

test('editing the next competency draft clears the previous create confirmation', () => {
  assert.match(adminSource, /function clearCreateNotice\(\)\s*\{\s*\/\/ The confirmation only applies until another competency draft is started\.\s*setNotice\(''\);\s*\}/);
  assert.match(adminSource, /setTitle\(event\.target\.value\); clearCreateNotice\(\);/);
  assert.match(adminSource, /setDescription\(event\.target\.value\); clearCreateNotice\(\);/);
});
