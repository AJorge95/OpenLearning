import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { getAppSelectVerticalPosition } from '../../src/app-select-position.ts';

const pageSource = fs.readFileSync(new URL('../../src/pages-manage.tsx', import.meta.url), 'utf8');
const styles = fs.readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');

test('course action menu positioning includes its rendered rows, gaps, padding, and border', () => {
  const position = getAppSelectVerticalPosition({ top: 670, bottom: 704 }, 720, 3);
  const renderedHeight = 3 * 38 + 2 * 3 + 2 * 6 + 2;

  assert.equal(renderedHeight, 134);
  assert.deepEqual(position, { top: 530, maxHeight: renderedHeight });
  assert.equal(position.top + position.maxHeight, 664);
});

test('course action menu shares viewport-bounded positioning and scrolls on short screens', () => {
  assert.match(pageSource, /getAppSelectVerticalPosition\(rect, window\.innerHeight, itemCount\)/);
  assert.match(pageSource, /setPosition\(\{ top, left, width, maxHeight \}\)/);
  assert.match(styles, /\.row-menu-popover\s*\{[^}]*overflow-y:\s*auto;[^}]*overscroll-behavior:\s*contain;/);
});
