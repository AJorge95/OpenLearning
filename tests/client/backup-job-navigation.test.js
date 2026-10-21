import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('../../src/pages-backups.tsx', import.meta.url), 'utf8');
const editorStart = source.indexOf('function JobEditor(');
const pageStart = source.indexOf('export function AdminBackupsPage()');
const editor = source.slice(editorStart, pageStart);
const page = source.slice(pageStart);

test('backup job edits are compared with their initial form values', () => {
  assert.match(source, /function isJobInputDirty\(value: JobInput, baseline: JobInput\)\s*\{\s*return \(Object\.keys\(baseline\) as Array<keyof JobInput>\)\.some\(\(key\) => value\[key\] !== baseline\[key\]\);\s*\}/);
  assert.match(editor, /const initialValueRef = useRef\(value\);[\s\S]*onDirtyChange\(isJobInputDirty\(value, initialValueRef\.current\)\)/);
});

test('dirty backup schedules block route changes and browser exits until saved or discarded', () => {
  assert.match(page, /const hasUnsavedChanges = Boolean\(editor && editorDirty\)/);
  assert.match(page, /locationChanged && \(hasUnsavedChanges \|\| saving\)/);
  assert.match(page, /const preventUnsavedBackupJobExit = useCallback\(\(event: BeforeUnloadEvent\) => \{\s*if \(!hasUnsavedChanges && !saving\) return;\s*event\.preventDefault\(\);\s*event\.returnValue = '';\s*\}, \[hasUnsavedChanges, saving\]\);\s*useBeforeUnload\(preventUnsavedBackupJobExit\)/);
  assert.match(page, /navigationBlocker\.state === 'blocked' && !hasUnsavedChanges && !saving\) navigationBlocker\.proceed\(\)/);
});

test('Cancel confirms draft discard and returns focus to the backup section', () => {
  assert.match(page, /function cancelEditor\(\)\s*\{\s*if \(editorDirty\) \{\s*setPendingEditorDiscard\(true\);\s*return;\s*\}/);
  assert.match(page, /pendingEditorDiscard && <ConfirmationDialog title="Discard unsaved backup schedule\?"[\s\S]*?onConfirm=\{discardEditorDraft\}/);
  assert.match(page, /window\.requestAnimationFrame\(\(\) => backupJobsHeadingRef\.current\?\.focus\(\)\)/);
});

test('opening the backup job editor focuses the job name field', () => {
  assert.match(editor, /<input id=\{nameId\} autoFocus required/);
});

test('an open backup job draft disables actions that could replace or restore over it', () => {
  assert.match(page, /disabled=\{Boolean\(editor\) \|\| busyId === job\.id \|\| restoreBusy\}[^>]*>.*?Edit/);
  assert.match(page, /disabled=\{Boolean\(editor\) \|\| busyId === job\.id \|\| restoreBusy\}[^>]*>.*?Pause/);
  assert.match(page, /disabled=\{restoreBusy \|\| isRunning \|\| Boolean\(editor\)\}[^>]*onClick=\{\(\) => \{ setError\(''\); setSuccess\(''\); setPendingRestore\(run\); \}\}/);
});
