import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const componentSource = fs.readFileSync(new URL('../../src/components.tsx', import.meta.url), 'utf8');
const learnerSource = fs.readFileSync(new URL('../../src/pages-learner.tsx', import.meta.url), 'utf8');
const programsSource = fs.readFileSync(new URL('../../src/pages-programs.tsx', import.meta.url), 'utf8');

test('shared loading and deadline icons stay decorative', () => {
  assert.match(componentSource, /<span className="loading-mark" aria-hidden="true"><BookOpen size=\{22\} \/><\/span>/);
  assert.match(learnerSource, /<CalendarDays size=\{15\} aria-hidden="true" \/>/);
});

test('calendar navigation and empty-state icons stay decorative', () => {
  assert.match(programsSource, /<ChevronLeft size=\{17\} aria-hidden="true" \/>/);
  assert.match(programsSource, /<ChevronRight size=\{17\} aria-hidden="true" \/>/);
  assert.match(programsSource, /<CalendarDays size=\{18\} aria-hidden="true" \/>/);
});
