import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { calendarMonthRequestRange, currentCalendarMonth, groupCalendarDeadlines, isSameCalendarMonth, shouldShowCalendarEmptyState } from '../../src/calendar-dates.ts';

test('current-month navigation returns to the first day of the local month', () => {
  const month = currentCalendarMonth(new Date(2026, 9, 11, 14, 30));

  assert.equal(month.getFullYear(), 2026);
  assert.equal(month.getMonth(), 9);
  assert.equal(month.getDate(), 1);
  assert.equal(month.getHours(), 0);
});

test('calendar month navigation recognizes the same local month across different days', () => {
  assert.equal(isSameCalendarMonth(new Date(2026, 9, 1), new Date(2026, 9, 12)), true);
  assert.equal(isSameCalendarMonth(new Date(2026, 9, 1), new Date(2026, 10, 1)), false);
  assert.equal(isSameCalendarMonth(new Date(2025, 9, 1), new Date(2026, 9, 1)), false);
});

test('calendar ranges include UTC dates whose deadlines belong to an adjacent local month', () => {
  const previousTimezone = process.env.TZ;
  try {
    process.env.TZ = 'America/Los_Angeles';
    const februaryRange = calendarMonthRequestRange(2026, 1);
    const westwardBoundary = { id: 'westward-boundary', dueAt: '2026-03-01T01:30:00.000Z' };
    const nextLocalMonth = { id: 'march', dueAt: '2026-03-01T08:30:00.000Z' };
    const february = groupCalendarDeadlines([westwardBoundary, nextLocalMonth], 2026, 1);

    assert.deepEqual(februaryRange, { from: '2026-01-31', to: '2026-03-01' });
    assert.ok(westwardBoundary.dueAt >= februaryRange.from);
    assert.ok(westwardBoundary.dueAt < `${februaryRange.to}Z`);
    assert.deepEqual(february.monthItems.map((item) => item.id), ['westward-boundary']);
    assert.deepEqual([...february.itemsByLocalDay.keys()], ['2026-02-28']);

    process.env.TZ = 'Pacific/Kiritimati';
    const marchRange = calendarMonthRequestRange(2026, 2);
    const eastwardBoundary = { id: 'eastward-boundary', dueAt: '2026-02-28T10:30:00.000Z' };
    const previousLocalMonth = { id: 'february', dueAt: '2026-02-28T09:30:00.000Z' };
    const march = groupCalendarDeadlines([previousLocalMonth, eastwardBoundary], 2026, 2);

    assert.deepEqual(marchRange, { from: '2026-02-28', to: '2026-04-01' });
    assert.ok(eastwardBoundary.dueAt >= marchRange.from);
    assert.ok(eastwardBoundary.dueAt < `${marchRange.to}Z`);
    assert.deepEqual(march.monthItems.map((item) => item.id), ['eastward-boundary']);
    assert.deepEqual([...march.itemsByLocalDay.keys()], ['2026-03-01']);
  } finally {
    if (previousTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimezone;
  }
});

test('calendar empty state appears only after a successful empty response', () => {
  assert.equal(shouldShowCalendarEmptyState(true, '', 0), false);
  assert.equal(shouldShowCalendarEmptyState(false, 'Calendar could not be loaded.', 0), false);
  assert.equal(shouldShowCalendarEmptyState(false, '', 0), true);
  assert.equal(shouldShowCalendarEmptyState(false, '', 1), false);
});

test('calendar page uses the successful-empty-state guard', () => {
  const pageSource = fs.readFileSync(new URL('../../src/pages-programs.tsx', import.meta.url), 'utf8');

  assert.match(pageSource, /shouldShowCalendarEmptyState\(loading, error, monthItems\.length\)/);
  assert.match(pageSource, /function navigateToMonth\(requestedMonth: Date\) \{\s*\/\/ Keep the loaded deadlines when the current-month control targets the displayed month\.\s*if \(isSameCalendarMonth\(month, requestedMonth\)\) return;\s*setLoading\(true\);\s*setError\(''\);\s*setItems\(\[\]\);\s*setMonth\(currentCalendarMonth\(requestedMonth\)\);\s*\}/);
  assert.match(pageSource, /aria-label="Previous month" onClick=\{\(\) => navigateToMonth\(new Date\(year, monthIndex - 1, 1\)\)\}/);
  assert.match(pageSource, /aria-label="Next month" onClick=\{\(\) => navigateToMonth\(new Date\(year, monthIndex \+ 1, 1\)\)\}/);
  assert.match(pageSource, /className="calendar-current-month" onClick=\{\(\) => navigateToMonth\(currentCalendarMonth\(\)\)\}>This month<\/Button>/);
});

test('calendar weekday headers keep short visual labels and expose full names to assistive tech', () => {
  const pageSource = fs.readFileSync(new URL('../../src/pages-programs.tsx', import.meta.url), 'utf8');

  assert.match(pageSource, /<th scope="col" key=\{day\}><span aria-hidden="true">\{day\.slice\(0, 3\)\}<\/span><span className="sr-only">\{day\}<\/span><\/th>/);
});

test('calendar reuses month and day formatters outside the component render path', () => {
  const pageSource = fs.readFileSync(new URL('../../src/pages-programs.tsx', import.meta.url), 'utf8');
  const componentStart = pageSource.indexOf('export function CalendarPage()');
  const componentEnd = pageSource.indexOf('export function CompetenciesPage()', componentStart);
  const componentSource = pageSource.slice(componentStart, componentEnd);
  const monthFormatterIndex = pageSource.indexOf('const calendarMonthFormatter = new Intl.DateTimeFormat');
  const dayFormatterIndex = pageSource.indexOf('const calendarFullDateFormatter = new Intl.DateTimeFormat');

  assert.ok(componentStart >= 0, 'expected to find CalendarPage');
  assert.ok(monthFormatterIndex >= 0 && monthFormatterIndex < componentStart);
  assert.ok(dayFormatterIndex >= 0 && dayFormatterIndex < componentStart);
  assert.match(componentSource, /calendarMonthFormatter\.format\(month\)/);
  assert.match(componentSource, /calendarFullDateFormatter\.format\(date\)/);
  assert.doesNotMatch(componentSource, /new Intl\.DateTimeFormat/);
});
