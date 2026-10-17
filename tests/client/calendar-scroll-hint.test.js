import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const pageSource = fs.readFileSync(new URL('../../src/pages-programs.tsx', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');

test('the learning calendar explains horizontal scrolling when its grid overflows', () => {
  const calendarPage = pageSource.slice(
    pageSource.indexOf('export function CalendarPage()'),
    pageSource.indexOf('export function CompetenciesPage()'),
  );
  const panelStart = calendarPage.indexOf('<section className="calendar-panel"');
  const hintPosition = calendarPage.indexOf('<p className="table-scroll-hint">Scroll horizontally to see the full month.</p>', panelStart);
  const gridPosition = calendarPage.indexOf('<table className="calendar-grid">', panelStart);

  assert.ok(panelStart >= 0, 'the calendar should keep a named, keyboard-focusable scroll region');
  assert.ok(hintPosition > panelStart && hintPosition < gridPosition, 'the cue should appear before the calendar grid');
  assert.match(styles, /\.calendar-panel\s*\{[^}]*overflow-x:\s*auto;[^}]*container-type:\s*inline-size;[^}]*container-name:\s*calendar;/);
  assert.match(styles, /@container calendar \(max-width: 639px\)\s*\{\s*\.calendar-panel > \.table-scroll-hint \{ display: flex; \}\s*\}/);
  assert.match(styles, /\.calendar-grid\s*\{[^}]*min-width:\s*640px;/);
  assert.match(styles, /@media \(max-width: 720px\)\s*\{[\s\S]*?\.table-scroll-hint \{ display: flex; \}/);
});
