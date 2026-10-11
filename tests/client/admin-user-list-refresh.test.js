import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const sourcePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/pages-manage.tsx');

test('account updates refresh the latest user-list filters and page', () => {
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

  assert.match(component.getText(sourceFile), /userListStateRef\.current = \{ query: appliedQuery, roleFilter, approvalFilter, page \};/);
  assert.match(functions.get('load'), /userListStateRef\.current = \{ query: requestedQuery, roleFilter: requestedRoleFilter, approvalFilter: requestedApprovalFilter, page: requestedPage \};/);
  const updateUser = functions.get('updateUser');
  const refreshBranchStart = updateUser.indexOf('} else if (changes.role !== undefined');
  const refreshBranchEnd = updateUser.indexOf('\n      } else {', refreshBranchStart);
  const refreshBranch = updateUser.slice(refreshBranchStart, refreshBranchEnd);
  assert.ok(refreshBranchStart >= 0 && refreshBranchEnd > refreshBranchStart);
  assert.match(refreshBranch, /setSuccess\(`\$\{user\.username\}'s account was updated\.`\);\s*await load\(currentListState\.page, currentListState\.query, currentListState\.roleFilter, currentListState\.approvalFilter\);\s*return;/);
});
