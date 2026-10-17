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

test('path archive confirmation warns when archiving will discard edits in its open editor', () => {
  assert.deepEqual(pathArchiveConfirmation('Onboarding', true), {
    title: 'Archive “Onboarding”?',
    description: 'It will be removed from active learning path lists. Existing learner enrollments and course progress will be kept. You can restore it later as a draft. Unsaved edits to this path will also be discarded.',
  });
});

test('archiving is deferred until the current path is confirmed', () => {
  const archiveFlow = pageSource.slice(pageSource.indexOf('async function archivePath'), pageSource.indexOf('async function restorePath'));
  const confirmationFlow = pageSource.slice(pageSource.indexOf('function requestPathArchive'), pageSource.indexOf('async function restorePath'));

  assert.doesNotMatch(archiveFlow, /window\.confirm/);
  assert.match(confirmationFlow, /function requestPathArchive\(path: LearningPath\)[\s\S]*?discardEditorChanges: editing\?\.id === path\.id && pathEditorDirtyRef\.current[\s\S]*?function confirmPathArchive\(\)[\s\S]*?item\.id === pending\.id && item\.title === pending\.title && item\.status !== 'archived'[\s\S]*?if \(path\) void archivePath\(path\)/);
  assert.match(pageSource, /<ConfirmationDialog \{\.\.\.pathArchiveConfirmation\(pendingPathArchive\.title, pendingPathArchive\.discardEditorChanges\)\} confirmLabel="Archive path"/);
  assert.match(pageSource, /onClick=\{\(\) => requestPathArchive\(path\)\}/);
});

test('archiving closes the matching editor only after the server confirms success', () => {
  const archiveFlow = pageSource.slice(pageSource.indexOf('async function archivePath'), pageSource.indexOf('async function restorePath'));
  const responsePosition = archiveFlow.indexOf("await api.patch(`/api/manage/learning-paths/${path.id}`, { status: 'archived' });");
  const closeEditorPosition = archiveFlow.indexOf('setEditing(null);');
  assert.ok(responsePosition >= 0 && closeEditorPosition > responsePosition);
  assert.match(archiveFlow, /if \(editing\?\.id === path\.id\) \{[\s\S]*?pathEditorDirtyRef\.current = false;\s*setEditing\(null\);\s*\}/);
  assert.match(archiveFlow, /catch \(cause\) \{ setError\(requestMessage\(cause, 'Learning path could not be archived\.'\)\); \}/);
  assert.doesNotMatch(archiveFlow.slice(archiveFlow.indexOf('catch (cause)')), /setEditing\(null\)/);
});
