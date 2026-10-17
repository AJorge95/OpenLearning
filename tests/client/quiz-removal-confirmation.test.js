import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const manageSource = fs.readFileSync(path.join(repositoryRoot, 'src/pages-manage.tsx'), 'utf8').replace(/\r\n/g, '\n');
const quizEditorStart = manageSource.indexOf('function QuizEditor(');
const quizEditorEnd = manageSource.indexOf('\nfunction LessonDetailsEditor(', quizEditorStart);
const quizEditorSource = manageSource.slice(quizEditorStart, quizEditorEnd);

test('quiz removal waits for an accessible warning about saved learner attempts', () => {
  const removeStart = quizEditorSource.indexOf('async function remove(confirmed = false)');
  const removeEnd = quizEditorSource.indexOf('\n\n  return <div className="quiz-editor"', removeStart);
  const removeSource = quizEditorSource.slice(removeStart, removeEnd);

  assert.ok(quizEditorStart >= 0 && quizEditorEnd > quizEditorStart);
  assert.match(removeSource, /if \(!confirmed\) \{ setConfirmingRemoval\(true\); return; \}/);
  assert.ok(removeSource.indexOf('setConfirmingRemoval(true)') < removeSource.indexOf('api.delete'));
  assert.doesNotMatch(quizEditorSource, /window\.confirm\(/);
  assert.match(quizEditorSource, /<ConfirmationDialog title="Remove this quiz\?" description=\{`All saved learner attempts for \$\{quizContext\} will also be removed\. This action cannot be undone\.`\} confirmLabel="Remove quiz"/);
  assert.match(quizEditorSource, /onConfirm=\{\(\) => \{ setConfirmingRemoval\(false\); void remove\(true\); \}\}/);
  assert.match(quizEditorSource, /setConfirmingRemoval\(false\);[\s\S]*?\}, \[module\.id, module\.title, existing\?\.id\]\);/);
});

test('quiz save and removal show distinct success feedback on the source course', () => {
  const saveStart = quizEditorSource.indexOf('async function save()');
  const removeStart = quizEditorSource.indexOf('async function remove(confirmed = false)', saveStart);
  const removeEnd = quizEditorSource.indexOf('\n\n  return <div className="quiz-editor"', removeStart);
  const saveSource = quizEditorSource.slice(saveStart, removeStart);
  const removeSource = quizEditorSource.slice(removeStart, removeEnd);

  assert.ok(saveStart >= 0 && removeStart > saveStart && removeEnd > removeStart);
  assert.match(saveSource, /await onSaved\('saved'\)/);
  assert.match(removeSource, /await api\.delete\(`\/api\/manage\/modules\/\$\{module\.id\}\/quiz`\); await onSaved\('removed'\)/);
  assert.match(manageSource, /onSaved=\{async \(action\) => \{\s*const requestedCourseId = course\.id;\s*if \(routeCourseIdRef\.current !== requestedCourseId\) return;/);
  assert.match(manageSource, /await load\(requestedCourseId\);\s*if \(routeCourseIdRef\.current === requestedCourseId\) setNotice/);
  assert.match(manageSource, /setNotice\(action === 'removed' \? 'Quiz removed\.' : 'Quiz saved\.'\)/);
  assert.match(manageSource, /if \(routeCourseIdRef\.current === course\.id\) setError\(message\)/);
});
