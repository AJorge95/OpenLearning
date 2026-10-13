import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const source = fs.readFileSync(path.resolve(import.meta.dirname, '../../src/components.tsx'), 'utf8');

test('staff navigation icons stay decorative beside their link labels', () => {
  for (const icon of ['BookOpen', 'UsersRound', 'Route', 'Award', 'ClipboardList', 'Activity', 'Settings2']) {
    assert.match(source, new RegExp(`<${icon} size=\\{18\\} aria-hidden="true" />`), `${icon} should be decorative`);
  }
  assert.match(source, /<ChevronRight size=\{16\} aria-hidden="true" \/>Back to learning/);
});
