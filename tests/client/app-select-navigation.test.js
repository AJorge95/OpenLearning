import assert from 'node:assert/strict';
import test from 'node:test';
import { findEnabledAppSelectIndex } from '../../src/app-select-navigation.ts';

const options = [{}, { disabled: true }, {}];

test('custom-select ArrowUp navigation keeps moving backward past disabled options', () => {
  assert.equal(findEnabledAppSelectIndex(options, 1, -1), 0);
});

test('custom-select ArrowDown navigation keeps moving forward past disabled options', () => {
  assert.equal(findEnabledAppSelectIndex(options, 1, 1), 2);
});

test('custom-select navigation wraps in the requested direction', () => {
  assert.equal(findEnabledAppSelectIndex(options, -1, -1), 2);
  assert.equal(findEnabledAppSelectIndex(options, options.length, 1), 0);
});

test('custom-select End navigation finds the last enabled option', () => {
  assert.equal(findEnabledAppSelectIndex([{}, {}, { disabled: true }], 2, -1), 1);
});

test('custom-select navigation keeps its empty and all-disabled fallbacks', () => {
  assert.equal(findEnabledAppSelectIndex([], 0), 0);
  assert.equal(findEnabledAppSelectIndex([{ disabled: true }, { disabled: true }], 1, -1), 0);
});
