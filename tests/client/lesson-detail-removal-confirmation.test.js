import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const manageSource = fs.readFileSync(path.join(repositoryRoot, 'src/pages-manage.tsx'), 'utf8');
const editorStart = manageSource.indexOf('function LessonDetailsEditor(');
const editorEnd = manageSource.indexOf('\nexport function CourseEditorPage()', editorStart);
const editorSource = manageSource.slice(editorStart, editorEnd);

test('resource and caption removal require a consequence-specific confirmation', () => {
  assert.ok(editorStart >= 0 && editorEnd > editorStart);
  assert.doesNotMatch(editorSource, /window\.confirm/);
  assert.match(editorSource, /setPendingRemoval\(\{ kind: 'resource', courseId, lessonId: lesson\.id, id: resource\.id, title: resource\.title, resourceKind: resource\.kind \}\)/);
  assert.match(editorSource, /setPendingRemoval\(\{ kind: 'caption', courseId, lessonId: lesson\.id, id: caption\.id, label: caption\.label, language: caption\.language \}\)/);
  assert.match(editorSource, /This removes the document from the lesson and deletes its uploaded file\. This action cannot be undone\./);
  assert.match(editorSource, /This removes the link from the lesson\. This action cannot be undone\./);
  assert.match(editorSource, /This removes the \$\{pendingRemoval\.language\} caption track and its uploaded file\. This action cannot be undone\./);
  assert.match(editorSource, /resources\.find\(\(item\) => item\.id === pending\.id\)/);
  assert.match(editorSource, /captions\.find\(\(item\) => item\.id === pending\.id\)/);
  assert.match(editorSource, /pendingRemoval\?\.courseId === courseId && pendingRemoval\.lessonId === lesson\.id/);
  assert.match(editorSource, /pending\.courseId !== courseId \|\| pending\.lessonId !== lesson\.id/);
  assert.match(editorSource, /setPendingRemoval\(null\);[\s\S]*?\}, \[courseId, lesson\.id, lesson\.title, lesson\.description, lesson\.transcript, lesson\.resources, lesson\.captions\]\);/);
  assert.match(editorSource, /removalRequestRef\.current = true/);
});
