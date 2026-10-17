import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const styles = fs.readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');
const manageSource = fs.readFileSync(new URL('../../src/pages-manage.tsx', import.meta.url), 'utf8');

test('shared staff pagination keeps named previous and next controls easy to activate', () => {
  const paginationRule = styles.match(/\.log-pagination \.button\s*\{([^}]*)\}/)?.[1];

  assert.ok(paginationRule, 'expected shared staff pagination button styles');
  assert.match(paginationRule, /min-height:\s*40px/);
  assert.match(paginationRule, /padding:\s*0 12px/);

  const paginationStart = manageSource.indexOf('function LogPagination(');
  const paginationEnd = manageSource.indexOf('\nfunction LogEmptyState(', paginationStart);
  assert.ok(paginationStart >= 0 && paginationEnd > paginationStart, 'shared pagination component should be available for inspection');
  assert.match(manageSource.slice(paginationStart, paginationEnd), />Previous<[^>]*>[\s\S]*?>Next</);
});
