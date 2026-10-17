import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const editorSource = fs.readFileSync(path.join(repositoryRoot, 'src/pages-manage.tsx'), 'utf8').replace(/\r\n/g, '\n');
const styles = fs.readFileSync(path.join(repositoryRoot, 'src/styles.css'), 'utf8');
const editorStart = editorSource.indexOf('export function CourseEditorPage()');
const editorEnd = editorSource.indexOf('\nexport function CourseAccessPage()', editorStart);
const courseEditor = editorSource.slice(editorStart, editorEnd);

test('module titles use a labeled inline editor instead of a browser prompt', () => {
  assert.ok(editorStart >= 0 && editorEnd > editorStart);
  assert.doesNotMatch(courseEditor, /window\.prompt\('Module title'/);
  assert.match(courseEditor, /<form className="module-title-edit-form"[^>]*aria-label=\{`Rename module \$\{module\.title\}`\} onSubmit=\{saveModuleTitle\}/);
  assert.match(courseEditor, /<input type="text" autoFocus required maxLength=\{160\} aria-label=\{`Module title for \$\{module\.title\}`\}/);
  assert.match(courseEditor, /<Button type="button" variant="quiet"[^>]*onClick=\{cancelModuleTitleEdit\}>Cancel<\/Button>/);
  assert.match(courseEditor, /event\.key === 'Escape'[\s\S]*?cancelModuleTitleEdit\(\)/);
});

test('module rename saves only the matching module in the current course', () => {
  const saveStart = courseEditor.indexOf('async function saveModuleTitle');
  const saveEnd = courseEditor.indexOf('\n\n  async function deleteModule', saveStart);
  const saveSource = courseEditor.slice(saveStart, saveEnd);

  assert.ok(saveStart >= 0 && saveEnd > saveStart);
  assert.match(saveSource, /pending\.courseId !== course\.id \|\| routeCourseIdRef\.current !== pending\.courseId/);
  assert.match(saveSource, /course\.modules\?\.find\(\(item\) => item\.id === pending\.moduleId\)/);
  assert.ok(saveSource.includes('await api.patch(`/api/manage/modules/${module.id}`, { title: normalizedTitle });'));
  assert.match(saveSource, /moduleTitleSaveRequestRef\.current = true/);
  assert.match(courseEditor, /setEditingModuleTitle\(null\); setSavingModuleTitleId\(''\); pendingModuleTitleFocusRef\.current = ''[\s\S]*?\}, \[route\.courseId\]\);/);
});

test('module title editor keeps its field and actions at reliable touch targets', () => {
  const inputRule = styles.match(/\.module-title-edit-form input\s*\{([^}]*)\}/)?.[1];
  const actionRule = styles.match(/\.module-title-edit-form \.button\s*\{([^}]*)\}/)?.[1];

  assert.ok(inputRule, 'expected inline module title input styles');
  assert.ok(actionRule, 'expected inline module title action styles');
  assert.match(inputRule, /min-height:\s*40px/);
  assert.match(actionRule, /min-height:\s*40px/);
});
