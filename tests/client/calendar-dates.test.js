import assert from 'node:assert/strict';
import test from 'node:test';
import { calendarMonthRequestRange, groupCalendarDeadlines } from '../../src/calendar-dates.ts';

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
