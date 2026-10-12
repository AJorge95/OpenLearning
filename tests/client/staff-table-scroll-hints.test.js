import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../../src/pages-manage.tsx', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');

const scrollableStaffTables = [
  ['Scrollable lesson completion metrics', 'Scroll horizontally to see all lesson metrics.'],
  ['Scrollable quiz performance metrics', 'Scroll horizontally to see all quiz metrics.'],
  ['Scrollable learner progress', 'Scroll horizontally to see all learner progress columns.'],
  ['Scrollable course activity', 'Scroll horizontally to see all course activity columns.'],
  ['Scrollable audit log', 'Scroll horizontally to see all audit log columns.'],
  ['Scrollable system log', 'Scroll horizontally to see all system log columns.'],
];

test('wide staff tables explain horizontal scrolling inside their named regions', () => {
  for (const [regionName, hintText] of scrollableStaffTables) {
    const regionPosition = source.indexOf(`aria-label="${regionName}"`);
    assert.notEqual(regionPosition, -1, `${regionName} should remain a named region`);
    const tablePosition = source.indexOf('<table', regionPosition);
    assert.ok(tablePosition > regionPosition, `${regionName} should contain its table`);
    const regionContentBeforeTable = source.slice(source.lastIndexOf('<div', regionPosition), tablePosition);
    assert.ok(regionContentBeforeTable.includes('className="table-scroll-hint"'), `${regionName} should include a scroll hint`);
    assert.ok(regionContentBeforeTable.includes(hintText), `${regionName} should explain its columns`);
  }
});

test('table scroll hints appear only at the narrow-screen breakpoint', () => {
  assert.match(styles, /\.table-scroll-hint\s*\{\s*display:\s*none;\s*\}/);
  const mobileRules = Array.from(styles.matchAll(/@media \(max-width: 720px\)\s*\{([\s\S]*?)\n\}/g), (match) => match[1])
    .find((rules) => rules.includes('.table-scroll-hint')) ?? '';
  assert.notEqual(mobileRules, '', 'narrow layouts should define the scroll-hint presentation');
  assert.match(mobileRules, /\.table-scroll-hint\s*\{[^}]*display:\s*flex;/);
});
