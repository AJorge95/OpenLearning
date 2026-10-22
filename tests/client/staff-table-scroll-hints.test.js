import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../../src/pages-manage.tsx', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');

const scrollableStaffTables = [
  ['Scrollable course list', 'Scroll horizontally to see all course columns.'],
  ['Scrollable account list', 'Scroll horizontally to see all account columns.'],
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

test('table scroll hints follow the width of each scroll region', () => {
  assert.match(styles, /\.table-scroll-hint\s*\{[^}]*display:\s*none;[^}]*min-height:\s*34px;/);
  assert.match(styles, /\.course-table-wrap\s*\{\s*container-type:\s*inline-size;\s*container-name:\s*course-table;\s*\}/);
  assert.match(styles, /\.user-table-wrap\s*\{\s*container-type:\s*inline-size;\s*container-name:\s*user-table;\s*\}/);
  assert.match(styles, /\.analytics-table-wrap\s*\{\s*container-type:\s*inline-size;\s*container-name:\s*analytics-table;\s*\}/);
  assert.match(styles, /\.analytics-learners-table-wrap\s*\{\s*container-name:\s*analytics-table learner-table;\s*\}/);
  assert.match(styles, /\.log-table-wrap\s*\{[^}]*container-type:\s*inline-size;[^}]*container-name:\s*log-table;/);

  const containerRules = Array.from(styles.matchAll(/@container ([\w-]+) \(max-width: (\d+)px\)\s*\{([^}]+)\}/g), (match) => ({
    name: match[1],
    maxWidth: Number(match[2]),
    rules: match[3],
  }));
  // The course table can overflow at the desktop breakpoint because its action
  // columns need more room than the 1280px staff content area provides.
  // The account table can overflow at the narrower admin layout because its
  // last-administrator guidance keeps a readable minimum width.
  const expectedContainerQueries = [
    ['course-table', 960, '.course-table-wrap'],
    ['user-table', 990, '.user-table-wrap'],
    ['analytics-table', 780, '.analytics-table-wrap:not(.analytics-learners-table-wrap)'],
    ['analytics-table', 940, '.analytics-learners-table-wrap'],
    ['log-table', 850, '.log-table-wrap'],
  ];
  for (const [name, maxWidth, selector] of expectedContainerQueries) {
    const query = containerRules.find((rule) => rule.name === name && rule.maxWidth === maxWidth);
    assert.ok(query, `${name} should reveal its hint at ${maxWidth}px or less`);
    assert.ok(query.rules.includes(`${selector} > .table-scroll-hint`), `${name} should target only its own hint`);
    assert.match(query.rules, /display:\s*flex;/);
  }

  const mobileRules = Array.from(styles.matchAll(/@media \(max-width: 720px\)\s*\{([\s\S]*?)\n\}/g), (match) => match[1])
    .find((rules) => rules.includes('.table-scroll-hint')) ?? '';
  assert.notEqual(mobileRules, '', 'older browsers should retain a narrow-screen fallback');
  assert.match(mobileRules, /\.table-scroll-hint\s*\{[^}]*display:\s*flex;/);
});
