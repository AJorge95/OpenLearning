import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const source = fs.readFileSync(path.resolve('src/pages-programs.tsx'), 'utf8');

test('filtered competency results return focus to the persistent search field when cleared', () => {
  const clearSearch = source.slice(source.indexOf('function clearSearch'), source.indexOf('async function create'));

  assert.match(source, /const competencySearchInputRef = useRef<HTMLInputElement>\(null\)/);
  assert.match(clearSearch, /setQuery\(''\); setAppliedQuery\(''\); setPage\(1\)/);
  assert.match(clearSearch, /void load\(1, ''\)/);
  assert.match(clearSearch, /competencySearchInputRef\.current\?\.focus\(\)/);
  assert.match(source, /<input ref=\{competencySearchInputRef\} type="search" value=\{query\}/);
  assert.match(source, /<Button type="button" variant="secondary" onClick=\{clearSearch\}>Clear search<\/Button>/);
});
