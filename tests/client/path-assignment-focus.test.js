import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const pageSource = fs.readFileSync(new URL('../../src/pages-programs.tsx', import.meta.url), 'utf8');
const removalStart = pageSource.indexOf('async function confirmAssignmentRemoval()');
const removalEnd = pageSource.indexOf('\n  const assignableLearners', removalStart);
const removalFlow = pageSource.slice(removalStart, removalEnd);

test('confirmed assignment removal returns focus to the persistent learner search', () => {
  const responsePosition = removalFlow.indexOf('await api.delete(');
  const refreshPosition = removalFlow.indexOf('await loadPathLearners(pending.pathId, assignmentAppliedSearch, assignmentPage);', responsePosition);
  const focusPosition = removalFlow.indexOf('window.requestAnimationFrame(() => assignmentSearchInputRef.current?.focus());', refreshPosition);

  assert.ok(responsePosition >= 0, 'expected the assignment removal request');
  assert.ok(refreshPosition > responsePosition, 'expected the assignment list to refresh after removal');
  assert.ok(focusPosition > refreshPosition, 'expected focus to move after the refreshed list removes the action');
  assert.match(removalFlow.slice(refreshPosition), /if \(assignmentPathRef\.current === pending\.pathId\) \{[\s\S]*?window\.requestAnimationFrame\(\(\) => assignmentSearchInputRef\.current\?\.focus\(\)\);/);
});
