import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { shouldCloseAppSelectForLayoutChange } from '../../src/app-select-layout.ts';

const sourceDirectory = path.resolve('src');

test('keeps an AppSelect menu open while its own options scroll', () => {
  const option = { nodeType: 1 };
  const menuElement = { contains: (target) => target === option };

  assert.equal(shouldCloseAppSelectForLayoutChange(option, menuElement), false);
});

test('closes an AppSelect menu when page content scrolls or the viewport resizes', () => {
  const pageElement = { nodeType: 1 };
  const menuElement = { contains: () => false };

  assert.equal(shouldCloseAppSelectForLayoutChange(pageElement, menuElement), true);
  assert.equal(shouldCloseAppSelectForLayoutChange({ nodeType: 9 }, menuElement), true);
});

test('closes an AppSelect menu if its layout event has no DOM target or menu element', () => {
  assert.equal(shouldCloseAppSelectForLayoutChange(null, { contains: () => false }), true);
  assert.equal(shouldCloseAppSelectForLayoutChange({}, { contains: () => false }), true);
  assert.equal(shouldCloseAppSelectForLayoutChange({ nodeType: 1 }, null), true);
});

test('wires and cleans up the tested layout handler for scroll and resize', () => {
  const componentSource = fs.readFileSync(path.join(sourceDirectory, 'components.tsx'), 'utf8');
  const layoutHandler = componentSource.match(/function closeForLayoutChange\(event: Event\) \{[\s\S]*?\n    \}/)?.[0];

  assert.ok(layoutHandler, 'Expected the AppSelect layout-change handler.');
  assert.match(layoutHandler, /shouldCloseAppSelectForLayoutChange\(event\.target, menuRef\.current\)/);
  assert.match(componentSource, /window\.addEventListener\('scroll', closeForLayoutChange, true\)/);
  assert.match(componentSource, /window\.addEventListener\('resize', closeForLayoutChange\)/);
  assert.match(componentSource, /window\.removeEventListener\('scroll', closeForLayoutChange, true\)/);
  assert.match(componentSource, /window\.removeEventListener\('resize', closeForLayoutChange\)/);
});
