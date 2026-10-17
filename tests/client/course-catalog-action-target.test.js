import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const styles = fs.readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');
const source = fs.readFileSync(new URL('../../src/pages-learner.tsx', import.meta.url), 'utf8');

test('catalog search actions keep names and reliable compact targets', () => {
  assert.match(source, /className="clear-catalog-filters" aria-label="Clear search and filters"/);
  assert.match(source, /<button type="submit" aria-label="Submit search">/);

  const searchActionRule = styles.match(/\.search-field button\s*\{([^}]*)\}/)?.[1];
  assert.ok(searchActionRule, 'expected explicit catalog search action styles');
  assert.match(searchActionRule, /width:\s*40px/);
  assert.match(searchActionRule, /height:\s*40px/);
  assert.match(searchActionRule, /display:\s*grid/);
  assert.match(searchActionRule, /place-items:\s*center/);
});
