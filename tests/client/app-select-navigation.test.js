import assert from 'node:assert/strict';
import test from 'node:test';
import { findAppSelectTypeaheadIndex, findEnabledAppSelectIndex } from '../../src/app-select-navigation.ts';

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

test('custom-select typeahead matches case-insensitively, wraps, and skips disabled options', () => {
  const labeledOptions = [
    { label: 'Alpha' },
    { label: 'Another' },
    { label: 'Archived', disabled: true },
    { label: 'Beta' },
  ];

  assert.equal(findAppSelectTypeaheadIndex(labeledOptions, 3, 'a'), 0);
  assert.equal(findAppSelectTypeaheadIndex(labeledOptions, 2, 'a'), 0);
  assert.equal(findAppSelectTypeaheadIndex(labeledOptions, 0, 'an'), 1);
});

test('custom-select repeated-letter typeahead cycles from the active option', () => {
  const labeledOptions = [
    { label: 'Administrator' },
    { label: 'Another role' },
    { label: 'Archived role', disabled: true },
    { label: 'Learner' },
  ];

  assert.equal(findAppSelectTypeaheadIndex(labeledOptions, 0, 'aa', true), 1);
  assert.equal(findAppSelectTypeaheadIndex(labeledOptions, 1, 'aa', true), 0);
  assert.equal(findAppSelectTypeaheadIndex(labeledOptions, 0, 'zz'), -1);
  assert.equal(findAppSelectTypeaheadIndex(labeledOptions, 0, ''), -1);
});
