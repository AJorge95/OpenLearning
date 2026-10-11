import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { pathAssignmentRemovalConfirmation } from '../../src/path-assignment-confirmation.ts';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const pageSource = fs.readFileSync(path.join(repositoryRoot, 'src/pages-programs.tsx'), 'utf8');

test('assignment removal confirmation explains access and retained progress', () => {
  assert.deepEqual(pathAssignmentRemovalConfirmation('learner-one', 'Onboarding'), {
    title: 'Remove learner-one from “Onboarding”?',
    description: 'They will leave this learning path and may lose access to private courses in it. Their course progress will be kept.',
  });
});

test('assignment removal opens an accessible confirmation before sending the request', () => {
  const removalFlow = pageSource.slice(pageSource.indexOf('function requestAssignmentRemoval'), pageSource.indexOf('const assignableLearners'));

  assert.match(removalFlow, /function requestAssignmentRemoval\(path: LearningPath, learner: PathLearner\)[\s\S]*?setPendingAssignmentRemoval\(\{ pathId: path\.id, pathTitle: path\.title, learnerId: learner\.id, learnerUsername: learner\.username \}\)/);
  assert.match(removalFlow, /async function confirmAssignmentRemoval\(\)[\s\S]*?item\.id === pending\.learnerId && item\.username === pending\.learnerUsername && item\.enrolled && item\.source === 'assigned'[\s\S]*?if \(assignmentBusy \|\| assignmentLoading \|\| assignmentPathRef\.current !== pending\.pathId \|\| !path \|\| !learner\) return;[\s\S]*?api\.delete\(`\/api\/manage\/learning-paths\/\$\{pending\.pathId\}\/assignments\/\$\{learner\.id\}`\)/);
  assert.match(pageSource, /onClick=\{\(\) => requestAssignmentRemoval\(path, learner\)\}/);
  assert.match(pageSource, /<ConfirmationDialog \{\.\.\.pathAssignmentRemovalConfirmation\(pendingAssignmentRemoval\.learnerUsername, pendingAssignmentRemoval\.pathTitle\)\} confirmLabel="Remove assignment"/);
  assert.doesNotMatch(removalFlow, /window\.confirm/);
});
