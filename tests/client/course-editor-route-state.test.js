import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const sourcePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/pages-manage.tsx');

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
  const initialStateResets = effectCallback.body.statements
    .filter((statement) => ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression))
    .slice(0, 2)
    .map((statement) => {
      const call = statement.expression;
      return [call.expression.getText(sourceFile), call.arguments[0]?.getText(sourceFile)];
    });

  assert.deepEqual(initialStateResets, [
    ['setRequiresRecompletion', 'false'],
    ['setChangeNote', "''"],
  ]);
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

test('course-version restores prevent duplicate writes and keep feedback scoped to the source course', () => {
  const source = fs.readFileSync(sourcePath, 'utf8');
  const sourceFile = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const restoreHandlers = [];
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'restoreVersion') restoreHandlers.push(node.getText(sourceFile));
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

  assert.equal(restoreHandlers.length, 1, 'expected one version restore handler');
  const restoreVersion = restoreHandlers[0];
  assert.match(restoreVersion, /const requestedCourseId = courseId;/);
  assert.match(restoreVersion, /const requestKey = `\$\{requestedCourseId\}:\$\{version\.id\}`;/);
  assert.match(restoreVersion, /restoreVersionRequestsRef\.current\.has\(requestKey\)/);
  assert.match(restoreVersion, /api\.post\(`\/api\/manage\/courses\/\$\{requestedCourseId\}\/versions\/\$\{version\.id\}\/restore`/);
  assert.match(restoreVersion, /if \(routeCourseIdRef\.current !== requestedCourseId\) return;/);
  assert.match(restoreVersion, /versionRestored = true;[\s\S]*?setNotice\(`Version \$\{version\.version_number\} was restored[\s\S]*?await load\(requestedCourseId\)/);
  assert.match(restoreVersion, /setError\(versionRestored[\s\S]*?was restored, but the course editor could not be refreshed\./);
});
