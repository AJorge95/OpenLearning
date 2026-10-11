import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { pathArchiveConfirmation } from '../../src/path-archive-confirmation.ts';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const pageSource = fs.readFileSync(path.join(repositoryRoot, 'src/pages-programs.tsx'), 'utf8');

test('path archive confirmation explains the visibility change and preserved learner progress', () => {
  assert.deepEqual(pathArchiveConfirmation('Onboarding'), {
    title: 'Archive “Onboarding”?',
    description: 'It will be removed from active learning path lists. Existing learner enrollments and course progress will be kept. You can restore it later as a draft.',
  });
});

test('archiving is deferred until the current path is confirmed', () => {
  const archiveFlow = pageSource.slice(pageSource.indexOf('async function archivePath'), pageSource.indexOf('async function restorePath'));
  const confirmationFlow = pageSource.slice(pageSource.indexOf('function requestPathArchive'), pageSource.indexOf('async function restorePath'));

  assert.doesNotMatch(archiveFlow, /window\.confirm/);
  assert.match(confirmationFlow, /function requestPathArchive\(path: LearningPath\)[\s\S]*?setPendingPathArchive\(\{ id: path\.id, title: path\.title \}\)[\s\S]*?function confirmPathArchive\(\)[\s\S]*?item\.id === pending\.id && item\.title === pending\.title && item\.status !== 'archived'[\s\S]*?if \(path\) void archivePath\(path\)/);
  assert.match(pageSource, /<ConfirmationDialog \{\.\.\.pathArchiveConfirmation\(pendingPathArchive\.title\)\} confirmLabel="Archive path"/);
  assert.match(pageSource, /onClick=\{\(\) => requestPathArchive\(path\)\}/);
});
