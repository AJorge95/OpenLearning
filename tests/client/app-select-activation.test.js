import assert from 'node:assert/strict';
import test from 'node:test';
import { isAppSelectActivationWithinTrigger, subscribeToAppSelectPointerTracking } from '../../src/app-select-activation.ts';

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

test('pointer-tracking cleanup is idempotent and does not disable later subscribers', () => {
  const originalDocument = globalThis.document;
  const listeners = new Set();
  let additions = 0;
  let removals = 0;
  globalThis.document = {
    addEventListener: (_type, listener) => { additions += 1; listeners.add(listener); },
    removeEventListener: (_type, listener) => { removals += 1; listeners.delete(listener); },
  };

  try {
    const unsubscribe = subscribeToAppSelectPointerTracking();
    unsubscribe();
    unsubscribe();

    const unsubscribeLater = subscribeToAppSelectPointerTracking();
    assert.equal(additions, 2, 'a later select should register the shared pointer listener');
    assert.equal(listeners.size, 1);
    unsubscribeLater();
    assert.equal(removals, 2);
    assert.equal(listeners.size, 0);
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});
