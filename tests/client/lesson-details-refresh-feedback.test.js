import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const sourcePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/pages-manage.tsx');

test('lesson detail mutations distinguish committed changes from refresh failures', () => {
  const source = fs.readFileSync(sourcePath, 'utf8');
  const editorStart = source.indexOf('function LessonDetailsEditor');
  const editorEnd = source.indexOf('\n\nexport function CourseEditorPage', editorStart);
  const editor = source.slice(editorStart, editorEnd);
  assert.ok(editorStart >= 0 && editorEnd > editorStart, 'expected the lesson details editor');

  assert.match(editor, /onChanged: \(\) => Promise<boolean>/);
  assert.match(editor, /async function completeLessonChange\(successMessage: string\) \{\s*if \(await onChanged\(\)\) \{\s*onNotice\(successMessage\);\s*return;\s*\}\s*onError\(`\$\{successMessage\} The course editor could not be refreshed\. Reload before making another change\.`\);/);
  assert.match(editor, /setLinkTitle\(''\); setLinkUrl\(''\);\s*await completeLessonChange\('Lesson link added\.'\);/);
  assert.match(editor, /setCaptionFile\(null\);\s*setCaptionLanguage\(''\);\s*setCaptionLabel\(''\);\s*if \(input\) input\.value = '';\s*if \(!upload\.controller\.signal\.aborted\) await completeLessonChange\(`/);
  assert.doesNotMatch(editor, /await onChanged\(\);\s*onNotice\(/, 'lesson actions should use the refresh-aware completion helper');
});

test('course refresh reports whether the committed course read completed', () => {
  const source = fs.readFileSync(sourcePath, 'utf8');
  const loadStart = source.indexOf('async function load(id = courseId): Promise<boolean>');
  const loadEnd = source.indexOf('\n\n  useEffect(() => {', loadStart);
  const loadSource = source.slice(loadStart, loadEnd);
  assert.ok(loadStart >= 0 && loadEnd > loadStart, 'expected the course editor load function');
  assert.match(loadSource, /if \(!id \|\| routeCourseIdRef\.current !== id\) return false;/);
  assert.match(loadSource, /if \(!isCurrentRequest\(\)\) return false;/);
  assert.match(loadSource, /setCourse\(response\.course\);[\s\S]*?return true;/);
  assert.match(loadSource, /setError\(cause instanceof ApiError \? cause\.message : 'Course could not be loaded\.'\);[\s\S]*?return false;/);
});
