import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const sourcePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/pages-manage.tsx');

test('role updates refresh the latest user-list filters and page', () => {
  const source = fs.readFileSync(sourcePath, 'utf8');
  const sourceFile = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const component = sourceFile.statements.find((statement) => ts.isFunctionDeclaration(statement)
    && statement.name?.text === 'AdminUsersPage');
  assert.ok(component, 'expected to find the admin users page');

  const functions = new Map();
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name) functions.set(node.name.text, node.getText(sourceFile));
    ts.forEachChild(node, visit);
  }
  visit(component);

  assert.match(component.getText(sourceFile), /userListStateRef\.current = \{ query: appliedQuery, roleFilter, page \};/);
  assert.match(functions.get('load'), /userListStateRef\.current = \{ query: requestedQuery, roleFilter: requestedRoleFilter, page: requestedPage \};/);
  assert.match(functions.get('updateUser'), /const currentListState = userListStateRef\.current;\s*if \(!\(await load\(currentListState\.page, currentListState\.query, currentListState\.roleFilter\)\)\) return;/);
});
