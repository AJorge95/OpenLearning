import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../../src/pages-backups.tsx', import.meta.url), 'utf8');

test('backup dashboard pauses hidden-tab polling and refreshes when visible again', () => {
  assert.match(source, /const isVisible = \(\) => document\.visibilityState === 'visible';/);
  assert.match(source, /if \(!active \|\| !isVisible\(\)\) return;/);
  assert.match(source, /const refreshOnVisible = \(\) => \{ if \(isVisible\(\)\) void load\(\); \};/);
  assert.match(source, /document\.addEventListener\('visibilitychange', refreshOnVisible\);/);
  assert.match(source, /document\.removeEventListener\('visibilitychange', refreshOnVisible\);/);
});
