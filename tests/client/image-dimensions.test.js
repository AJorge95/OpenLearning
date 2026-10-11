import assert from 'node:assert/strict';
import test from 'node:test';
import { isImageDimensionWithinLimit, readImageDimensions } from '../../src/image-dimensions.ts';

function mockImageDecoder(t, { width = 1, height = 1, fail = false } = {}) {
  const imageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'Image');
  const createObjectUrlDescriptor = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
  const revokeObjectUrlDescriptor = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
  const revoked = [];

  Object.defineProperty(globalThis, 'Image', {
    configurable: true,
    writable: true,
    value: class {
      naturalWidth = width;
      naturalHeight = height;
      onload = null;
      onerror = null;

      set src(value) {
        assert.equal(value, 'blob:test-image');
        queueMicrotask(() => fail ? this.onerror?.() : this.onload?.());
      }
    },
  });
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    writable: true,
    value: () => 'blob:test-image',
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    writable: true,
    value: (value) => revoked.push(value),
  });

  t.after(() => {
    for (const [target, key, descriptor] of [
      [globalThis, 'Image', imageDescriptor],
      [URL, 'createObjectURL', createObjectUrlDescriptor],
      [URL, 'revokeObjectURL', revokeObjectUrlDescriptor],
    ]) {
      if (descriptor) Object.defineProperty(target, key, descriptor);
      else delete target[key];
    }
  });

  return revoked;
}

test('image dimension checks include the limit and reject unsafe values', () => {
  assert.equal(isImageDimensionWithinLimit(4096, 4096, 4096), true);
  assert.equal(isImageDimensionWithinLimit(4097, 1, 4096), false);
  assert.equal(isImageDimensionWithinLimit(1, 4097, 4096), false);
  assert.equal(isImageDimensionWithinLimit(0, 1, 4096), false);
  assert.equal(isImageDimensionWithinLimit(1.5, 1, 4096), false);
  assert.equal(isImageDimensionWithinLimit(1, 1, 0), false);
});

test('image dimensions are read from the decoded image and object URLs are released', async (t) => {
  const revoked = mockImageDecoder(t, { width: 320, height: 180 });

  assert.deepEqual(await readImageDimensions(new Blob(['image'])), { width: 320, height: 180 });
  assert.deepEqual(revoked, ['blob:test-image']);
});

test('image decode failures release their object URL and reject', async (t) => {
  const revoked = mockImageDecoder(t, { fail: true });

  await assert.rejects(readImageDimensions(new Blob(['bad image'])), /could not be decoded/);
  assert.deepEqual(revoked, ['blob:test-image']);
});
