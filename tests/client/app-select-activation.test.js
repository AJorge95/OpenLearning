import assert from 'node:assert/strict';
import test from 'node:test';
import { isAppSelectActivationWithinTrigger } from '../../src/app-select-activation.ts';

const triggerBounds = { left: 100, right: 240, top: 20, bottom: 64 };

test('accepts pointer activation inside the visible custom-select trigger', () => {
  assert.equal(isAppSelectActivationWithinTrigger({ detail: 1, clientX: 120, clientY: 40 }, triggerBounds, true), true);
});

test('rejects label-forwarded pointer activation from beside the trigger', () => {
  assert.equal(isAppSelectActivationWithinTrigger({ detail: 1, clientX: 246, clientY: 40 }, triggerBounds, false), false);
  assert.equal(isAppSelectActivationWithinTrigger({ detail: 1, clientX: 120, clientY: 70 }, triggerBounds, false), false);
  assert.equal(isAppSelectActivationWithinTrigger({ detail: 1, clientX: 246, clientY: 40 }, triggerBounds, true), false);
});

test('rejects zero-detail activations with coordinates outside the trigger', () => {
  assert.equal(isAppSelectActivationWithinTrigger({ detail: 0, clientX: 246, clientY: 40 }, triggerBounds, false), false);
});

test('keeps keyboard activation available without pointer coordinates', () => {
  assert.equal(isAppSelectActivationWithinTrigger({ detail: 0, clientX: 0, clientY: 0 }, triggerBounds, false), true);
});

test('rejects a label-forwarded click even if its reported coordinates land inside the trigger', () => {
  assert.equal(isAppSelectActivationWithinTrigger({ detail: 1, clientX: 120, clientY: 40 }, triggerBounds, false), false);
});
