import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../../src/components.tsx', import.meta.url), 'utf8');

test('shared empty-state illustrations stay decorative beside their text', () => {
  assert.match(source, /The heading and detail provide the empty-state meaning; the illustration is decorative\./);
  assert.match(source, /<span className="empty-icon" aria-hidden="true">\{icon\}<\/span>/);
});
