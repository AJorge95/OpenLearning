import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../../src/pages-programs.tsx', import.meta.url), 'utf8');

test('learning-path search by name or description is accessible and clearable', () => {
  assert.match(source, /<form role="search" aria-label="Search learning paths" className="management-search" onSubmit=\{submitPathSearch\}>/);
  assert.match(source, /<input ref=\{pathSearchInputRef\} type="search" value=\{pathSearch\} onChange=\{\(event\) => setPathSearch\(event\.target\.value\)\} placeholder="Search by name or description" aria-label="Search learning paths" maxLength=\{120\} \/>/);
  assert.match(source, /title: 'No matching learning paths'/);
  assert.match(source, /onClick=\{clearPathSearch\}>Clear search<\/Button>/);

  const submitSearch = source.slice(source.indexOf('function submitPathSearch'), source.indexOf('function changePathPage'));
  assert.match(submitSearch, /const nextSearch = pathSearch\.trim\(\)/);
  assert.match(submitSearch, /setAppliedPathSearch\(nextSearch\)/);
  assert.match(submitSearch, /void load\(1, pathStatus, nextSearch\)/);
  assert.match(submitSearch, /clearAssignmentPanel\(\)/);
});

test('path-list requests retain the applied search through status changes and pagination', () => {
  const load = source.slice(source.indexOf('async function load(requestedPage'), source.indexOf('useEffect(() => {\n    pathsPageActiveRef.current'));
  const changeStatus = source.slice(source.indexOf('function changePathStatus'), source.indexOf('async function savePath'));
  const changePage = source.slice(source.indexOf('function changePathPage'), source.indexOf('function changePathStatus'));

  assert.match(load, /requestedSearch = appliedPathSearch/);
  assert.match(load, /if \(requestedSearch\) params\.set\('q', requestedSearch\)/);
  assert.match(changeStatus, /const nextSearch = pathSearch\.trim\(\)/);
  assert.match(changeStatus, /void load\(1, status, nextSearch\)/);
  assert.match(changePage, /void load\(page\)/);
});

test('clearing the path search restores the current status filter and returns focus to the input', () => {
  const clearSearch = source.slice(source.indexOf('function clearPathSearch'), source.indexOf('function changePathPage'));

  assert.match(clearSearch, /setPathSearch\(''\)/);
  assert.match(clearSearch, /setAppliedPathSearch\(''\)/);
  assert.match(clearSearch, /void load\(1, pathStatus, ''\)/);
  assert.match(clearSearch, /pathSearchInputRef\.current\?\.focus\(\)/);
});
