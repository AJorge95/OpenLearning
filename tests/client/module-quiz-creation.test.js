import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const editorSource = fs.readFileSync(path.join(repositoryRoot, 'src/pages-manage.tsx'), 'utf8').replace(/\r\n/g, '\n');
const editorStart = editorSource.indexOf('export function CourseEditorPage()');
const editorEnd = editorSource.indexOf('\nexport function CourseAccessPage()', editorStart);
const courseEditor = editorSource.slice(editorStart, editorEnd);

test('module quiz creation prevents duplicate requests while a module is loading', () => {
  const addStart = courseEditor.indexOf('async function addModuleQuiz');
  const addEnd = courseEditor.indexOf('\n\n  function startModuleTitleEdit', addStart);
  const addSource = courseEditor.slice(addStart, addEnd);

  assert.ok(addStart >= 0 && addEnd > addStart);
  assert.match(addSource, /if \(module\.quiz \|\| addingQuizModuleIdsRef\.current\.has\(module\.id\)\) return/);
  assert.match(addSource, /pending\.add\(module\.id\); addingQuizModuleIdsRef\.current = pending; setAddingQuizModuleIds\(pending\)/);
  assert.match(addSource, /nextPending\.delete\(module\.id\); addingQuizModuleIdsRef\.current = nextPending; setAddingQuizModuleIds\(nextPending\)/);
  assert.match(addSource, /pendingQuizTriggerFocusRef\.current = module\.id;\s*setError\(/);
  assert.match(courseEditor, /onClick=\{\(\) => void addModuleQuiz\(module\)\} disabled=\{Boolean\(module\.quiz\) \|\| addingQuizModuleIds\.has\(module\.id\)\} aria-busy=\{addingQuizModuleIds\.has\(module\.id\)\}/);
  assert.match(courseEditor, /if \(!moduleId \|\| addingQuizModuleIds\.has\(moduleId\)\) return;[\s\S]*?pendingQuizTriggerFocusRef\.current = '';\s*trigger\.focus\(\)/);
});

test('newly added module quiz moves focus into its title field after refresh', () => {
  assert.match(courseEditor, /const pendingQuizTitleFocusRef = useRef\(''\)/);
  assert.match(courseEditor, /pendingQuizTitleFocusRef\.current = module\.id;\s*await load\(requestedCourseId\)/);
  assert.match(courseEditor, /const titleInput = quizTitleInputRefs\.current\.get\(moduleId\);\s*if \(!titleInput\) return;\s*pendingQuizTitleFocusRef\.current = '';\s*titleInput\.focus\(\)/);
  assert.match(courseEditor, /titleInputRef=\{\(node\) => \{ if \(node\) quizTitleInputRefs\.current\.set\(module\.id, node\); else quizTitleInputRefs\.current\.delete\(module\.id\); \}\}/);
});
