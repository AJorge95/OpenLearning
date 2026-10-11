import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { filterCourseCompetencies, updateCourseCompetencySelection } from '../../src/course-competency-selection.ts';

test('course competency search is case-insensitive, accent-normalized, and preserves the full list for blank queries', () => {
  const competencies = [
    { id: 'design', title: 'Design systems' },
    { id: 'cafe', title: 'Café operations' },
    { id: 'research', title: 'Research methods' },
  ];

  assert.deepEqual(filterCourseCompetencies(competencies, '  DESIGN '), [competencies[0]]);
  assert.deepEqual(filterCourseCompetencies(competencies, 'Cafe\u0301'), [competencies[1]]);
  assert.equal(filterCourseCompetencies(competencies, '   '), competencies);
  assert.deepEqual(filterCourseCompetencies(competencies, 'missing'), []);
});

test('course competency selection allows the API limit and blocks additional choices', () => {
  const selected = Array.from({ length: 200 }, (_, index) => `competency-${index}`);
  const unchanged = updateCourseCompetencySelection(selected, 'competency-extra', true, 200);
  const legacyOverLimit = [...selected, 'legacy-extra'];

  assert.equal(unchanged, selected);
  assert.equal(updateCourseCompetencySelection(selected, 'competency-0', false, 200).length, 199);
  assert.equal(updateCourseCompetencySelection(['competency-0'], 'competency-0', true, 200).length, 1);
  assert.equal(updateCourseCompetencySelection(legacyOverLimit, 'another-extra', true, 200), legacyOverLimit);
  assert.equal(updateCourseCompetencySelection(legacyOverLimit, 'legacy-extra', false, 200).length, 200);
});

test('course competency editor exposes and explains the server selection limit', () => {
  const source = fs.readFileSync(new URL('../../src/pages-manage.tsx', import.meta.url), 'utf8');

  assert.match(source, /selectionLimit: number/);
  assert.match(source, /setCompetencySelectionLimit\(mapping\.selectionLimit\)/);
  assert.match(source, /const addBlocked = !selected && selectedCompetencies\.length >= competencySelectionLimit/);
  assert.match(source, /disabled=\{addBlocked\}/);
  assert.match(source, /role="status" aria-live="polite">\{selectedCompetencies\.length\} of \{competencySelectionLimit\} competencies selected/);
  assert.match(source, /disabled=\{savingCompetencyMapping \|\| competencyMappingOverLimit\}/);
});

test('course competency search filters visible options without replacing selected mapping state', () => {
  const source = fs.readFileSync(new URL('../../src/pages-manage.tsx', import.meta.url), 'utf8');

  assert.match(source, /const \[competencySearch, setCompetencySearch\] = useState\(''\)/);
  assert.match(source, /filterCourseCompetencies\(competencies, competencySearch\)/);
  assert.match(source, /<label className="course-competency-filter">Search competencies<input type="search"/);
  assert.match(source, /\{visibleCompetencies\.map\(\(competency\) =>/);
  assert.match(source, /No competencies match your search\./);
  assert.match(source, /competencyIds: selectedCompetencies/);
});
