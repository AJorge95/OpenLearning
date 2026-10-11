import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { pathAssignmentRemovalConfirmation } from '../../src/path-assignment-confirmation.ts';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const pageSource = fs.readFileSync(path.join(repositoryRoot, 'src/pages-programs.tsx'), 'utf8');

test('assignment removal confirmation explains access and retained progress', () => {
  assert.equal(pathAssignmentRemovalConfirmation('learner-one', 'Onboarding'),
    'Remove learner-one from “Onboarding”? They will leave this learning path and may lose access to private courses in it. Their course progress will be kept.');
});

test('the assignment panel confirms before sending the removal request', () => {
  const removeAssignment = pageSource.slice(pageSource.indexOf('async function removeAssignment'), pageSource.indexOf('const assignableLearners'));

  assert.match(removeAssignment, /if \(assignmentBusy \|\| assignmentLoading \|\| assignmentPathRef\.current !== pathId\) return;[\s\S]*?if \(!window\.confirm\(pathAssignmentRemovalConfirmation\(learnerUsername, pathTitle\)\)\) return;[\s\S]*?setAssignmentAction\('remove'\);[\s\S]*?api\.delete/);
  assert.match(pageSource, /onClick=\{\(\) => void removeAssignment\(path\.id, learner\.id, learner\.username, path\.title\)\}/);
});
