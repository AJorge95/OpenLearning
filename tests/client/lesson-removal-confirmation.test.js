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

test('lesson removal waits for confirmation before deleting the lesson and uploaded files', () => {
  const removeStart = editorSource.indexOf('async function deleteLesson(lessonId: string, currentTitle: string, confirmed = false)');
  const removeEnd = editorSource.indexOf('\n\n  function confirmPendingLessonDeletion()', removeStart);
  const removeSource = editorSource.slice(removeStart, removeEnd);

  assert.ok(editorStart >= 0 && editorEnd > editorStart);
  assert.match(removeSource, /if \(!confirmed\) \{[\s\S]*?setPendingDeleteLesson\(\{ courseId: course\.id, moduleId: module\.id, lessonId, title: currentTitle \}\);[\s\S]*?return;/);
  assert.ok(removeSource.indexOf('setPendingDeleteLesson(') < removeSource.indexOf('api.delete'));
  assert.doesNotMatch(removeSource, /window\.confirm/);
  assert.match(editorSource, /description="This removes the lesson, its video, attached resources, and caption tracks\. This action cannot be undone\." confirmLabel="Remove lesson"/);
  assert.match(editorSource, /pendingDeleteLesson\?\.courseId === course\.id && routeCourseIdRef\.current === course\.id/);
  assert.match(editorSource, /const currentLesson = course\.modules\?\.find\(\(module\) => module\.id === pending\.moduleId\)\?\.lessons\.find\(\(lesson\) => lesson\.id === pending\.lessonId\)/);
  assert.match(editorSource, /if \(currentLesson\) void deleteLesson\(currentLesson\.id, currentLesson\.title, true\)/);
  assert.match(editorSource, /setPendingDeleteLesson\(null\);[\s\S]*?\}, \[route\.courseId\]\);/);
});
