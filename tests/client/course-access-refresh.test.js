import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const sourcePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/pages-manage.tsx');

test('assignment refreshes use the latest requested search and page', () => {
  const source = fs.readFileSync(sourcePath, 'utf8');
  const sourceFile = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const editor = sourceFile.statements.find((statement) => ts.isFunctionDeclaration(statement)
    && statement.name?.text === 'CourseAccessPage');
  assert.ok(editor, 'expected to find the course access page');

  const functions = new Map();
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name) functions.set(node.name.text, node.getText(sourceFile));
    ts.forEachChild(node, visit);
  }
  visit(editor);

  assert.match(editor.getText(sourceFile), /accessListStateRef\.current = \{ query: appliedQuery, page \};/);
  assert.match(functions.get('load'), /accessListStateRef\.current = \{ query: search, page: requestedPage \};/);
  assert.match(functions.get('toggle'), /const currentListState = accessListStateRef\.current;\s*await load\(currentListState\.query, currentListState\.page,/);
});

test('course access changes announce completion only while the source course is active', () => {
  const source = fs.readFileSync(sourcePath, 'utf8');
  const sourceFile = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const editor = sourceFile.statements.find((statement) => ts.isFunctionDeclaration(statement)
    && statement.name?.text === 'CourseAccessPage');
  assert.ok(editor, 'expected to find the course access page');

  let toggleSource = '';
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'toggle') toggleSource = node.getText(sourceFile);
    ts.forEachChild(node, visit);
  }
  visit(editor);

  assert.match(toggleSource, /markSaving\(user\.id, true\); setError\(''\); setNotice\(''\);/);
  assert.match(toggleSource, /if \(routeCourseIdRef\.current === requestedCourseId\) \{\s*setNotice\(`Course assignment updated for \$\{user\.username\}\.\`\);/);
  assert.match(toggleSource, /catch \(cause\) \{\s*if \(routeCourseIdRef\.current === requestedCourseId\) setError/);
  assert.match(editor.getText(sourceFile), /notice && <div className="inline-notice inline-notice-success" role="status">\{notice\}<\/div>/);
});
