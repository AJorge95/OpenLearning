import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const source = fs.readFileSync(path.resolve('src/pages-programs.tsx'), 'utf8');
const learningPathsPage = source.slice(source.indexOf('export function LearningPathsPage()'), source.indexOf('export function CompetenciesPage()'));
const competenciesPage = source.slice(source.indexOf('export function CompetenciesPage()'), source.indexOf('export function AdminCompetenciesPage()'));

test('learning-path empty announcements are limited to filtered results', () => {
  assert.match(learningPathsPage, /const shouldAnnounceEmptyPathResult = hasEmptyPathResult && \(Boolean\(appliedPathSearch\) \|\| \(staff && pathStatus !== 'all'\)\);/);
  assert.match(learningPathsPage, /\{shouldAnnounceEmptyPathResult && <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">\{emptyPathState\.title\}/);
  assert.doesNotMatch(learningPathsPage, /\{hasEmptyPathResult && <p className="sr-only"/);
});

test('baseline empty competency state relies on its visible heading and detail', () => {
  assert.match(competenciesPage, /<EmptyState title="No competencies have been added" detail="Your organization’s skills map will appear here when competencies are configured\." \/>/);
  assert.doesNotMatch(competenciesPage, /No competencies have been added\. Your organization’s skills map will appear here when competencies are configured\.<\/p>/);
});
