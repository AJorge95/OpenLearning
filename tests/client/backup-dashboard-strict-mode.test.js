import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../../src/pages-backups.tsx', import.meta.url), 'utf8');

test('backup polling gate is scoped to each StrictMode effect instance', () => {
  const effectStart = source.indexOf('useEffect(() => {');
  const effectEnd = source.indexOf('\n  }, []);', effectStart);
  assert.notEqual(effectStart, -1, 'The dashboard polling effect should exist.');
  assert.notEqual(effectEnd, -1, 'The dashboard polling effect should have a stable cleanup boundary.');

  const effect = source.slice(effectStart, effectEnd).replace(/\s+/g, ' ');
  assert.match(effect, /let requestActive = false;/);
  assert.match(effect, /if \(requestActive\) return;/);
  assert.match(effect, /requestActive = true;/);
  assert.match(effect, /requestActive = false;/);
  assert.doesNotMatch(source, /requestActiveRef/);
});
