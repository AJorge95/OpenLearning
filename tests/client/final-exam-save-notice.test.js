import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const sourcePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/pages-manage.tsx');
const source = fs.readFileSync(sourcePath, 'utf8');
const finalExamEditor = source.slice(source.indexOf('function CourseFinalExamEditor('), source.indexOf('\nexport function CourseEditorPage()'));

test('editing final-exam settings clears the previous success notice', () => {
  assert.match(finalExamEditor, /value=\{title\} onChange=\{\(event\) => \{ onNotice\(''\); setTitle\(event\.target\.value\); \}\}/);
  assert.match(finalExamEditor, /value=\{passMark\} onChange=\{\(value\) => \{ onNotice\(''\); setPassMark\(value\); \}\}/);
  assert.match(finalExamEditor, /value=\{questionsPerAttempt\} onChange=\{\(event\) => \{ onNotice\(''\); setQuestionsPerAttempt/);
  assert.match(finalExamEditor, /checked=\{requiredForCompletion\} onChange=\{\(event\) => \{ onNotice\(''\); setRequiredForCompletion/);
});

test('editing or starting a final-exam question clears the previous success notice', () => {
  assert.match(finalExamEditor, /function updateActiveQuestion\([\s\S]*?onNotice\(''\);/);
  assert.match(finalExamEditor, /function addQuestion\(\) \{\s*onNotice\(''\);/);
});
