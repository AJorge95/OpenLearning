import assert from 'node:assert/strict';
import test from 'node:test';
import { isImageDimensionWithinLimit, readImageDimensions } from '../../src/image-dimensions.ts';

function mockImageDecoder(t, { width = 1, height = 1, fail = false, pending = false } = {}) {
  const imageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'Image');
  const createObjectUrlDescriptor = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
  const revokeObjectUrlDescriptor = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
  const revoked = [];
  const images = [];

  Object.defineProperty(globalThis, 'Image', {
    configurable: true,
    writable: true,
    value: class {
      constructor() { images.push(this); }
      naturalWidth = width;
      naturalHeight = height;
      onload = null;
      onerror = null;
      srcRemoved = false;

      removeAttribute(name) {
        assert.equal(name, 'src');
        this.srcRemoved = true;
      }

      set src(value) {
        assert.equal(value, 'blob:test-image');
        if (!pending) queueMicrotask(() => fail ? this.onerror?.() : this.onload?.());
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

  return { revoked, images };
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
  const { revoked } = mockImageDecoder(t, { width: 320, height: 180 });

  assert.deepEqual(await readImageDimensions(new Blob(['image'])), { width: 320, height: 180 });
  assert.deepEqual(revoked, ['blob:test-image']);
});

test('image decode failures release their object URL and reject', async (t) => {
  const { revoked } = mockImageDecoder(t, { fail: true });

  await assert.rejects(readImageDimensions(new Blob(['bad image'])), /could not be decoded/);
  assert.deepEqual(revoked, ['blob:test-image']);
});

test('aborting a pending image decode cancels the load and releases its object URL', async (t) => {
  const { revoked, images } = mockImageDecoder(t, { pending: true });
  const controller = new AbortController();
  const dimensions = readImageDimensions(new Blob(['image']), controller.signal);
  const lateLoad = images[0].onload;

  controller.abort();
  lateLoad?.();

  await assert.rejects(dimensions, { name: 'AbortError' });
  assert.equal(images.length, 1);
  assert.equal(images[0].srcRemoved, true);
  assert.deepEqual(revoked, ['blob:test-image']);
});

test('an already aborted image decode allocates no image or object URL', async (t) => {
  const { revoked, images } = mockImageDecoder(t);
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(readImageDimensions(new Blob(['image']), controller.signal), { name: 'AbortError' });
  assert.deepEqual(images, []);
  assert.deepEqual(revoked, []);
});
