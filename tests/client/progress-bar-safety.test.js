import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const source = fs.readFileSync(path.resolve('src/components.tsx'), 'utf8');

test('ProgressBar converts non-finite values to a valid zero progress state', () => {
  assert.match(source, /const progress = Number\.isFinite\(value\) \? Math\.max\(0, Math\.min\(100, value\)\) : 0;/);
  assert.match(source, /aria-valuenow=\{progress\}/);
  assert.match(source, /width: `\$\{progress\}%`/);
});
