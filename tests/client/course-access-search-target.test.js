import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const styles = fs.readFileSync(new URL('../../src/styles.css', import.meta.url), 'utf8');
const source = fs.readFileSync(new URL('../../src/pages-manage.tsx', import.meta.url), 'utf8');

test('course-access search keeps a reliable narrow-layout submit target', () => {
  const mobileRule = styles.match(/\.access-search \.button\s*\{([^}]*)\}/)?.[1];

  assert.ok(mobileRule, 'expected responsive course-access search button styles');
  assert.match(mobileRule, /min-height:\s*40px/);
  assert.match(source, /<form role="search" aria-label="Search course learners" className="access-search"[\s\S]*?<Button variant="secondary" type="submit">Search<\/Button>/);
});
