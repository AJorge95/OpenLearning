import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const styles = fs.readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');
const source = fs.readFileSync(new URL('../../src/pages-programs.tsx', import.meta.url), 'utf8');

test('learning-path assignment empty-search recovery keeps a reliable target', () => {
  const emptyStateRule = styles.match(/\.path-assignment-empty \.button\s*\{([^}]*)\}/)?.[1];

  assert.ok(emptyStateRule, 'expected empty assignment-search action styles');
  assert.match(emptyStateRule, /min-height:\s*40px/);
  assert.match(source, /<div className="path-assignment-empty">[\s\S]*?<Button type="button" variant="quiet"[\s\S]*?>Clear search<\/Button>/);
});
