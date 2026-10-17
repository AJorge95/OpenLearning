import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const styles = fs.readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');
const rootBlock = styles.match(/^:root\s*\{([^}]*)\}/m)?.[1] ?? '';

test('every CSS custom property used by the interface has a root definition', () => {
  const declaredTokens = new Set(Array.from(rootBlock.matchAll(/(--[a-z0-9-]+)\s*:/g), (match) => match[1]));
  const usedTokens = new Set(Array.from(styles.matchAll(/var\((--[a-z0-9-]+)/g), (match) => match[1]));

  // Undefined custom properties invalidate the whole declaration without a browser error.
  assert.notEqual(rootBlock, '', 'expected the shared root token block');
  assert.deepEqual(
    [...usedTokens].filter((token) => !declaredTokens.has(token)),
    [],
    'all referenced interface tokens should be declared in :root',
  );
});
