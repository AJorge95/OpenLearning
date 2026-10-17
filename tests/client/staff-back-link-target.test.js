import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const source = fs.readFileSync(path.resolve('src/components.tsx'), 'utf8');
const styles = fs.readFileSync(path.resolve('src/styles.css'), 'utf8');

test('staff back link keeps its label, decorative icon, and mobile target', () => {
  assert.match(source, /<Link className="staff-back-link" to="\/courses"><ChevronRight size=\{16\} aria-hidden="true" \/>Back to learning<\/Link>/);
  assert.match(styles, /\.staff-back-link\s*\{\s*display:\s*flex;\s*min-height:\s*40px;/);
  assert.match(styles, /\.staff-sidebar nav a, \.staff-back-link\s*\{[^}]*min-height:\s*45px;/);
});
