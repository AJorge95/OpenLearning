import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
import { isCourseCreationEditorState } from '../../src/course-editor-state.ts';

const sourcePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/pages-manage.tsx');

test('course editor breadcrumb follows the create route through its draft redirect', () => {
  const source = fs.readFileSync(sourcePath, 'utf8');
  assert.match(source, /isCourseCreationEditorState\(location\.state, route\.courseId\)/);
  assert.match(source, /navigate\(`\/manage\/courses\/\$\{response\.course\.id\}\/edit`, \{ replace: true, state: \{ createdCourseId: response\.course\.id \} \}\)/);
  assert.match(source, /<span>\{isNewCourseDraft \? 'Create course' : 'Edit course'\}<\/span>/);
  assert.equal(isCourseCreationEditorState({ createdCourseId: 'course-new' }, 'course-new'), true);
  assert.equal(isCourseCreationEditorState({ createdCourseId: 'course-new' }, 'course-existing'), false);
  assert.equal(isCourseCreationEditorState(null, 'course-new'), false);
  assert.equal(isCourseCreationEditorState({ createdCourseId: 'course-new' }, undefined), false);
});

test('changing course routes resets publication-only options', () => {
  const source = fs.readFileSync(sourcePath, 'utf8');
  const sourceFile = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const editor = sourceFile.statements.find((statement) => ts.isFunctionDeclaration(statement)
    && statement.name?.text === 'CourseEditorPage');
  assert.ok(editor, 'expected to find the course editor');

  const routeEffect = [];
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'useEffect'
      && ts.isArrayLiteralExpression(node.arguments[1])
      && node.arguments[1].elements.some((dependency) => dependency.getText(sourceFile) === 'route.courseId')) {
      routeEffect.push(node);
    }
    ts.forEachChild(node, visit);
  }
  visit(editor);

  assert.equal(routeEffect.length, 1, 'expected one effect keyed to the course route');
  const effectCallback = routeEffect[0].arguments[0];
  assert.ok(ts.isArrowFunction(effectCallback) && ts.isBlock(effectCallback.body), 'expected a block route effect');
  const resetCalls = effectCallback.body.statements
    .filter((statement) => ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression))
    .map((statement) => {
      const call = statement.expression;
      return [call.expression.getText(sourceFile), call.arguments[0]?.getText(sourceFile)];
    });

  const publicationStateResets = resetCalls.filter(([name]) => ['setRequiresRecompletion', 'setChangeNote'].includes(name));
  assert.deepEqual(publicationStateResets, [
    ['setRequiresRecompletion', 'false'],
    ['setChangeNote', "''"],
  ]);
  assert.ok(effectCallback.body.getText(sourceFile).includes('coverValidationSequenceRef.current += 1;'), 'stale cover validation should be invalidated on route changes');
  assert.equal((effectCallback.body.getText(sourceFile).match(/abortCoverValidation\(\);/g) || []).length, 2, 'pending cover decodes should be aborted when a route starts and when it leaves');
  assert.ok(resetCalls.some(([name, value]) => name === 'setCoverValidating' && value === 'false'), 'cover validation state should reset on route changes');
});

test('a stale course refresh cannot abort the newly selected course request', () => {
  const source = fs.readFileSync(sourcePath, 'utf8');
  const loadStart = source.indexOf('async function load(id = courseId)');
  const loadEnd = source.indexOf('\n\n  useEffect(() => {', loadStart);
  const loadSource = source.slice(loadStart, loadEnd);

  assert.ok(loadStart >= 0 && loadEnd > loadStart);
  assert.match(loadSource, /async function load\(id = courseId\) \{\s*if \(!id \|\| routeCourseIdRef\.current !== id\) return;/);
  assert.ok(loadSource.indexOf('routeCourseIdRef.current !== id') < loadSource.indexOf('courseLoadControllerRef.current?.abort()'),
    'ignore stale refreshes before they can abort the active route request');
});

test('course detail drafts are preserved only while refreshing the same course', () => {
  const source = fs.readFileSync(sourcePath, 'utf8');
  const loadStart = source.indexOf('async function load(id = courseId)');
  const loadEnd = source.indexOf('\n\n  useEffect(() => {', loadStart);
  const loadSource = source.slice(loadStart, loadEnd);

  assert.ok(loadStart >= 0 && loadEnd > loadStart);
  assert.match(loadSource, /const previousCourse = course\?\.id === id \? course : null/);
  assert.match(loadSource, /if \(!previousCourse\) \{\s*setCompletionWindowDays\(response\.course\.completionWindowDays \? String\(response\.course\.completionWindowDays\) : ''\);\s*setTitle\(response\.course\.title\); setDescription\(response\.course\.description\); setCategory\(response\.course\.category\); setVisibility\(response\.course\.visibility\);/);
  assert.match(loadSource, /setTitle\(\(current\) => current === previousCourse\.title \? response\.course\.title : current\)/);
});

test('same-course refreshes preserve an unsaved completion-window value', () => {
  const source = fs.readFileSync(sourcePath, 'utf8');
  const loadStart = source.indexOf('async function load(id = courseId)');
  const loadEnd = source.indexOf('\n\n  useEffect(() => {', loadStart);
  const loadSource = source.slice(loadStart, loadEnd);

  assert.ok(loadStart >= 0 && loadEnd > loadStart);
  assert.match(loadSource, /if \(!previousCourse\) \{\s*setCompletionWindowDays\(response\.course\.completionWindowDays \? String\(response\.course\.completionWindowDays\) : ''\)/);
  assert.match(loadSource, /else \{\s*setCompletionWindowDays\(\(current\) => current === String\(previousCourse\.completionWindowDays \?\? ''\) \? String\(response\.course\.completionWindowDays \?\? ''\) : current\)/);
  assert.equal((loadSource.match(/setCompletionWindowDays\(/g) || []).length, 2,
    'initialize once for a new course and preserve or refresh once for same-course loads');
});

test('lesson and curriculum actions keep late refreshes and errors on their source course', () => {
  const source = fs.readFileSync(sourcePath, 'utf8');
  const handlers = [
    ['async function addLesson', '\n\n  async function addModuleQuiz'],
    ['async function deleteModule', '\n\n  function confirmPendingModuleDeletion'],
    ['async function deleteLesson', '\n\n  function confirmPendingLessonDeletion'],
    ['async function moveItem', '\n\n  async function uploadVideo'],
  ];

  for (const [startMarker, endMarker] of handlers) {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start);
    const handler = source.slice(start, end);
    assert.ok(start >= 0 && end > start, `expected handler ${startMarker}`);
    assert.match(handler, /const requestedCourseId = (?:courseId|course\.id)/);
    assert.match(handler, /if \(routeCourseIdRef\.current !== requestedCourseId\) return;[\s\S]*?await api\.(?:post|delete)/);
    assert.match(handler, /if \(routeCourseIdRef\.current === requestedCourseId\) await load\(requestedCourseId\)|if \(routeCourseIdRef\.current !== requestedCourseId\) return;[\s\S]*?await load\(requestedCourseId\)/);
    assert.match(handler, /catch \(cause\) \{\s*if \(routeCourseIdRef\.current === requestedCourseId\) setError\(/);
  }
});

test('course navigation clears the inline add-module draft and scopes late responses', () => {
  const source = fs.readFileSync(sourcePath, 'utf8');
  assert.match(source, /useEffect\(\(\) => \{\s*let active = true;\s*setModuleTitle\(''\); setAddingModule\(false\); addModuleInvokerRef\.current = null;/);

  const addStart = source.indexOf('async function addModule(event: React.FormEvent)');
  const addEnd = source.indexOf('\n\n  async function addLesson', addStart);
  const addSource = source.slice(addStart, addEnd);
  assert.ok(addStart >= 0 && addEnd > addStart);
  assert.match(addSource, /const requestedCourseId = courseId/);
  assert.match(addSource, /if \(routeCourseIdRef\.current !== requestedCourseId\) return;\s*await api\.post/);
  assert.match(addSource, /await api\.post[\s\S]*?if \(routeCourseIdRef\.current !== requestedCourseId\) return;\s*setModuleTitle\(''\)/);
  assert.match(addSource, /if \(routeCourseIdRef\.current === requestedCourseId\) setError\(/);
  assert.match(source, /aria-expanded=\{addingModule\}[\s\S]*?disabled=\{Boolean\(editingModuleTitle\) \|\| saving \|\| deletingCourse \|\| addingModuleBusy\}/);
});

test('course publishing keeps save failures distinct from settings refresh failures', () => {
  const source = fs.readFileSync(sourcePath, 'utf8');
  const sourceFile = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const saveCourseFunctions = [];
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'saveCourse') saveCourseFunctions.push(node);
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

  assert.equal(saveCourseFunctions.length, 1, 'expected one course save handler');
  const saveCourse = saveCourseFunctions[0].getText(sourceFile);
  const saveRequestIndex = saveCourse.indexOf('await api.patch');
  const savedStateIndex = saveCourse.indexOf('courseSaved = true;');
  const settingsRefreshIndex = saveCourse.indexOf('await loadGovernance(requestedCourseId)');

  assert.match(saveCourse, /let courseSaved = false;/);
  assert.ok(saveRequestIndex >= 0 && saveRequestIndex < savedStateIndex, 'only mark the course saved after the save request resolves');
  assert.ok(savedStateIndex < settingsRefreshIndex, 'track save success before refreshing editor settings');
  assert.match(saveCourse, /setError\(courseSaved\s*\?[\s\S]*?Course was saved, but the editor settings could not be refreshed\.[\s\S]*?: cause instanceof ApiError \? cause\.message : 'Course could not be saved\.'/);
});

test('review actions keep successful decisions visible when editor refreshes fail', () => {
  const source = fs.readFileSync(sourcePath, 'utf8');
  const sourceFile = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const handlers = new Map();
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && ['submitForReview', 'decideReview'].includes(node.name?.text || '')) {
      handlers.set(node.name.text, node.getText(sourceFile));
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

  const submitForReview = handlers.get('submitForReview');
  const decideReview = handlers.get('decideReview');
  assert.ok(submitForReview, 'expected a review-submission handler');
  assert.ok(decideReview, 'expected a review-decision handler');
  assert.match(submitForReview, /reviewRequestSubmitted = true;[\s\S]*?setNotice\('Course revision submitted for review\.'\);[\s\S]*?await loadGovernance\(requestedCourseId\)/);
  assert.match(submitForReview, /setError\(reviewRequestSubmitted[\s\S]*?Review request was submitted, but course settings could not be refreshed\./);
  assert.match(decideReview, /const requestedCourseId = courseId;/);
  assert.match(decideReview, /await api\.post\(`\/api\/manage\/courses\/\$\{requestedCourseId\}\/review\/decision`/);
  assert.match(decideReview, /if \(!isCurrentRequest\(\)\) return;[\s\S]*?reviewDecisionSaved = true;[\s\S]*?setNotice\(decision === 'approve'/);
  assert.match(decideReview, /try \{\s*await loadGovernance\(requestedCourseId\);\s*\} finally \{\s*if \(isCurrentRequest\(\)\) await load\(requestedCourseId\);\s*\}/);
  assert.match(decideReview, /setError\(reviewDecisionSaved[\s\S]*?Review decision was saved, but the course editor could not be refreshed\./);
});

test('blank change-request feedback is announced and associated with its textarea', () => {
  const source = fs.readFileSync(sourcePath, 'utf8');

  assert.match(source, /setChangeRequestNoteError\('Describe the changes the editor should make\.'\);\s*setError\(''\);\s*changeRequestNoteInputRef\.current\?\.focus\(\)/);
  assert.match(source, /<textarea ref=\{changeRequestNoteInputRef\}[\s\S]*?aria-invalid=\{changeRequestNoteError \? true : undefined\}/);
  assert.match(source, /aria-describedby=\{changeRequestNoteError \? `review-change-note-help-\$\{courseId\} review-change-note-error-\$\{courseId\}`/);
  assert.match(source, /\{changeRequestNoteError && <p id=\{`review-change-note-error-\$\{courseId\}`\} className="form-error" role="alert"/);
});

test('course-version restore confirmation validates its route and keeps feedback scoped to the source course', () => {
  const source = fs.readFileSync(sourcePath, 'utf8');
  const sourceFile = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const restoreHandlers = new Map();
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && ['requestRestoreVersion', 'confirmPendingVersionRestore', 'restoreVersion'].includes(node.name?.text || '')) {
      restoreHandlers.set(node.name.text, node.getText(sourceFile));
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

  assert.equal(restoreHandlers.size, 3, 'expected a request, confirmation, and restore handler');
  const requestRestoreVersion = restoreHandlers.get('requestRestoreVersion');
  const confirmPendingVersionRestore = restoreHandlers.get('confirmPendingVersionRestore');
  const restoreVersion = restoreHandlers.get('restoreVersion');
  assert.match(requestRestoreVersion, /const requestedCourseId = courseId;/);
  assert.match(requestRestoreVersion, /restoreVersionRequestsRef\.current\.has\(requestKey\)/);
  assert.match(requestRestoreVersion, /setPendingRestoreVersion\(\{ courseId: requestedCourseId, versionId: version\.id, versionNumber: version\.version_number \}\)/);
  assert.doesNotMatch(requestRestoreVersion, /api\.post|window\.confirm/);
  assert.match(confirmPendingVersionRestore, /pending\.courseId !== courseId \|\| pending\.courseId !== routeCourseIdRef\.current/);
  assert.match(confirmPendingVersionRestore, /versions\.find\(\(current\) => current\.id === pending\.versionId\)/);
  assert.match(confirmPendingVersionRestore, /restoreVersion\(version, pending\.courseId\)/);
  assert.match(restoreVersion, /requestedCourseId: string/);
  assert.match(restoreVersion, /const requestKey = `\$\{requestedCourseId\}:\$\{version\.id\}`;/);
  assert.match(restoreVersion, /restoreVersionRequestsRef\.current\.has\(requestKey\)/);
  assert.match(restoreVersion, /api\.post\(`\/api\/manage\/courses\/\$\{requestedCourseId\}\/versions\/\$\{version\.id\}\/restore`/);
  assert.match(restoreVersion, /if \(routeCourseIdRef\.current !== requestedCourseId\) return;/);
  assert.match(restoreVersion, /versionRestored = true;[\s\S]*?setNotice\(`Version \$\{version\.version_number\} was restored[\s\S]*?await load\(requestedCourseId\)/);
  assert.match(restoreVersion, /setError\(versionRestored[\s\S]*?was restored, but the course editor could not be refreshed\./);
});

test('course-version restore warns about draft replacement and the selected completion policy', () => {
  const source = fs.readFileSync(sourcePath, 'utf8');

  assert.doesNotMatch(source, /window\.confirm\(`Publish version \$\{version\.version_number\}/);
  assert.match(source, /setPendingRestoreVersion\(null\);[\s\S]*?if \(route\.courseId\)/);
  assert.match(source, /title=\{`Restore version \$\{pendingRestoreVersion\.versionNumber\}\?`\}/);
  assert.match(source, /Any current unpublished revision will be discarded\./);
  assert.match(source, /requiresRecompletion[\s\S]*?Learners will need to complete the new version again\. Previous completions, quiz attempts, and certificates stay in history\./);
  assert.match(source, /Existing completions remain valid\. Previous quiz attempts and certificates stay in history\./);
  assert.match(source, /onConfirm=\{confirmPendingVersionRestore\}/);
});
