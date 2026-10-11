import assert from 'node:assert/strict';
import test from 'node:test';
import { findAppSelectTypeaheadIndex, findEnabledAppSelectIndex, getAppSelectDisplayLabel, isAppSelectUnavailable, resolveAppSelectActiveIndex } from '../../src/app-select-navigation.ts';

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

test('custom-select active option falls back when live options shrink or disable the active choice', () => {
  const currentOptions = [{}, { disabled: true }, {}];

  assert.equal(resolveAppSelectActiveIndex(currentOptions, 2, 0), 2);
  assert.equal(resolveAppSelectActiveIndex([{}, { disabled: true }], 4, 0), 0);
  assert.equal(resolveAppSelectActiveIndex(currentOptions, 1, 1), 2);
});

test('custom-select is unavailable when it has no enabled choices', () => {
  assert.equal(isAppSelectUnavailable([]), true);
  assert.equal(isAppSelectUnavailable([{ disabled: true }, { disabled: true }]), true);
  assert.equal(isAppSelectUnavailable([{}, { disabled: true }]), false);
  assert.equal(isAppSelectUnavailable([{}], true), true);
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

test('custom-select typeahead matches canonically equivalent accented labels', () => {
  const labeledOptions = [{ label: 'Café' }, { label: 'Café international' }];

  assert.equal(findAppSelectTypeaheadIndex(labeledOptions, 0, 'Cafe\u0301'), 0);
  assert.equal(findAppSelectTypeaheadIndex([{ label: 'Cafe\u0301 international' }], 0, 'Café'), 0);
});

test('custom-select displays an explicit placeholder when its value is absent from live options', () => {
  const currentOptions = [{ value: '', label: 'All actions' }, { value: 'user.created', label: 'User created' }];

  assert.equal(getAppSelectDisplayLabel(currentOptions, ''), 'All actions');
  assert.equal(getAppSelectDisplayLabel(currentOptions, 'course.deleted'), 'Choose an option');
  assert.equal(getAppSelectDisplayLabel([], 'course.deleted'), 'Choose an option');
});
