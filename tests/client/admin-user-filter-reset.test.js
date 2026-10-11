import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';

const sourcePath = path.resolve('src/pages-manage.tsx');
const source = fs.readFileSync(sourcePath, 'utf8');
const sourceFile = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function adminUsersPage() {
  const declaration = sourceFile.statements.find((statement) => ts.isFunctionDeclaration(statement)
    && statement.name?.text === 'AdminUsersPage');
  assert.ok(declaration?.body, 'Expected AdminUsersPage.');
  return declaration.body.getText(sourceFile);
}

test('filtered empty account lists can clear all filters and reload unfiltered results', () => {
  const page = adminUsersPage();

  assert.match(page, /const userListSearchInputRef = useRef<HTMLInputElement>\(null\)/);
  assert.match(page, /const hasAppliedUserFilters = Boolean\(appliedQuery \|\| roleFilter !== 'all' \|\| approvalFilter !== 'all'\)/);
  assert.match(page, /function clearUserListFilters\(\) \{\s*const filterSelectionChanged = roleFilter !== 'all' \|\| approvalFilter !== 'all';\s*setQuery\(''\);\s*setAppliedQuery\(''\);\s*setRoleFilter\('all'\);\s*setApprovalFilter\('all'\);\s*setPage\(1\);\s*if \(!filterSelectionChanged\) void load\(1, '', 'all', 'all'\);\s*userListSearchInputRef\.current\?\.focus\(\);\s*\}/);
  assert.match(page, /<input ref=\{userListSearchInputRef\} value=\{query\}/);
  assert.match(page, /userListEmptyMessage\(appliedQuery, roleFilter, approvalFilter\)/);
  assert.match(page, /hasAppliedUserFilters && <Button type="button" variant="secondary" onClick=\{clearUserListFilters\}>Clear filters<\/Button>/);
});
