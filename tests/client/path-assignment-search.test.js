import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const pageSource = fs.readFileSync(path.resolve('src/pages-programs.tsx'), 'utf8');

test('filtered empty assignment searches can clear and reload the first unfiltered learner page', () => {
  const clearSearch = pageSource.slice(pageSource.indexOf('function clearPathLearnerSearch'), pageSource.indexOf('function changeAssignmentPage'));

  assert.match(pageSource, /const assignmentSearchInputRef = useRef<HTMLInputElement>\(null\)/);
  assert.match(clearSearch, /if \(assignmentBusy \|\| assignmentPathRef\.current !== pathId\) return/);
  assert.match(clearSearch, /setAssignmentSearch\(''\); setAssignmentAppliedSearch\(''\); setAssignmentPage\(1\); setSelectedLearner\(''\)/);
  assert.match(clearSearch, /assignmentSearchInputRef\.current\?\.focus\(\)/);
  assert.match(clearSearch, /void loadPathLearners\(pathId, '', 1\)/);
  assert.match(pageSource, /<input ref=\{assignmentSearchInputRef\} type="search" aria-label="Search learners by name or email"/);
  assert.match(pageSource, /assignmentAppliedSearch\s*\?\s*<div className="path-assignment-empty"><p className="path-assignment-status" role="status">No active learners match this search\.<\/p><Button type="button" variant="quiet" disabled=\{assignmentBusy\} onClick=\{\(\) => clearPathLearnerSearch\(path\.id\)\}>Clear search<\/Button><\/div>/);
});
