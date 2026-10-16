import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const styles = fs.readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');

test('competency administration actions keep reliable targets in dense and paged layouts', () => {
  const paginationRule = styles.match(/\.competency-admin-pagination \.button\s*\{([^}]*)\}/)?.[1];
  const rowRule = styles.match(/\.competency-admin-row \.button\s*\{([^}]*)\}/)?.[1];

  assert.ok(paginationRule, 'expected competency pagination button styles');
  assert.ok(rowRule, 'expected competency row action styles');
  assert.match(paginationRule, /min-height:\s*40px/);
  assert.match(rowRule, /min-height:\s*40px/);
  assert.match(styles, /\.competency-admin-row \.button\s*\{[^}]*padding:\s*0 11px/);
});
