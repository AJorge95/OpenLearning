import assert from 'node:assert/strict';
import test from 'node:test';
import { getAppSelectHorizontalPosition, getAppSelectVerticalPosition } from '../../src/app-select-position.ts';

test('keeps a custom-select menu inside a narrow viewport', () => {
  const position = getAppSelectHorizontalPosition({ left: 112, width: 96 }, 150);

  assert.deepEqual(position, { left: 12, width: 126 });
  assert.ok(position.left + position.width <= 150);
});

test('keeps the preferred menu width and clamps it beside the trigger when space allows', () => {
  const position = getAppSelectHorizontalPosition({ left: 280, width: 140 }, 320);

  assert.deepEqual(position, { left: 88, width: 220 });
  assert.ok(position.left + position.width <= 320);
});

test('can match a custom-select menu width to its trigger', () => {
  const position = getAppSelectHorizontalPosition({ left: 280, width: 144 }, 320, 144);

  assert.deepEqual(position, { left: 164, width: 144 });
  assert.ok(position.left + position.width <= 320);
});

test('allocates enough height for a short option list before enabling scrolling', () => {
  const position = getAppSelectVerticalPosition({ top: 338, bottom: 382 }, 720, 3);

  assert.deepEqual(position, { top: 388, maxHeight: 134 });
});

test('caps the menu height to the room on the better side of a short viewport', () => {
  const position = getAppSelectVerticalPosition({ top: 50, bottom: 94 }, 120, 3);

  assert.deepEqual(position, { top: 12, maxHeight: 32 });
  assert.ok(position.top + position.maxHeight <= 108);
});
