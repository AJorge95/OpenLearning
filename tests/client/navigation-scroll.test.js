import assert from 'node:assert/strict';
import test from 'node:test';
import { getHorizontalRevealScrollLeft } from '../../src/navigation-scroll.ts';

test('reveals an active link beyond the right edge with a small inset', () => {
  assert.equal(getHorizontalRevealScrollLeft({ left: 20, right: 320 }, { left: 280, right: 350 }, 0), 42);
});

test('reveals an active link beyond the left edge without scrolling past the start', () => {
  assert.equal(getHorizontalRevealScrollLeft({ left: 20, right: 320 }, { left: -15, right: 45 }, 100), 53);
  assert.equal(getHorizontalRevealScrollLeft({ left: 20, right: 320 }, { left: -15, right: 45 }, 10), 0);
});

test('keeps the current scroll position when the active link is already visible', () => {
  assert.equal(getHorizontalRevealScrollLeft({ left: 20, right: 320 }, { left: 80, right: 140 }, 24), 24);
});
