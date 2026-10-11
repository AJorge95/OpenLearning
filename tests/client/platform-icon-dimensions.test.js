import assert from 'node:assert/strict';
import test from 'node:test';
import { isBrandIconDimensionAllowed, MAX_BRAND_ICON_DIMENSION } from '../../src/branding.ts';

test('platform icon dimensions include the configured square boundary', () => {
  assert.equal(isBrandIconDimensionAllowed(1, 1), true);
  assert.equal(isBrandIconDimensionAllowed(MAX_BRAND_ICON_DIMENSION, MAX_BRAND_ICON_DIMENSION), true);
  assert.equal(isBrandIconDimensionAllowed(MAX_BRAND_ICON_DIMENSION, 1), true);
  assert.equal(isBrandIconDimensionAllowed(1, MAX_BRAND_ICON_DIMENSION), true);
});

test('platform icon dimensions reject invalid and over-limit decoded sizes', () => {
  for (const [width, height] of [
    [0, 1],
    [1, 0],
    [-1, 1],
    [1, -1],
    [MAX_BRAND_ICON_DIMENSION + 1, 1],
    [1, MAX_BRAND_ICON_DIMENSION + 1],
    [1.5, 1],
    [Number.NaN, 1],
    [Number.POSITIVE_INFINITY, 1],
  ]) {
    assert.equal(isBrandIconDimensionAllowed(width, height), false, `${width}×${height}`);
  }
});
