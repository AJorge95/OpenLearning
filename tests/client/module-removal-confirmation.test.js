import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const manageSource = fs.readFileSync(path.join(repositoryRoot, 'src/pages-manage.tsx'), 'utf8');
const editorStart = manageSource.indexOf('export function CourseEditorPage()');
const editorEnd = manageSource.indexOf('\nexport function CourseAccessPage()', editorStart);
const editorSource = manageSource.slice(editorStart, editorEnd);

test('module removal waits for confirmation before deleting lessons, quiz data, and uploaded files', () => {
  const removeStart = editorSource.indexOf('async function deleteModule(module: CourseModule, confirmed = false)');
  const removeEnd = editorSource.indexOf('\n\n  function confirmPendingModuleDeletion()', removeStart);
  const removeSource = editorSource.slice(removeStart, removeEnd);

  assert.ok(editorStart >= 0 && editorEnd > editorStart);
  assert.match(removeSource, /if \(!confirmed\) \{ setPendingDeleteModule\(\{ courseId: course\.id, module \}\); return; \}/);
  assert.ok(removeSource.indexOf('setPendingDeleteModule(') < removeSource.indexOf('api.delete'));
  assert.match(editorSource, /description=\{`This removes all lessons in this module, its quiz and saved attempts, and their uploaded videos, documents, and captions\. This action cannot be undone\.`\}/);
  assert.match(editorSource, /pendingDeleteModule\?\.courseId === course\.id && routeCourseIdRef\.current === course\.id/);
  assert.match(editorSource, /if \(!course \|\| !pending \|\| pending\.courseId !== course\.id \|\| routeCourseIdRef\.current !== pending\.courseId\) return;/);
  assert.match(editorSource, /setPendingDeleteModule\(null\);[\s\S]*?\}, \[route\.courseId\]\);/);
});
