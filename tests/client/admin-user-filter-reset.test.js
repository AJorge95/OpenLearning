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

test('filtered account lists can clear all filters with or without matching users', () => {
  const page = adminUsersPage();

  assert.match(page, /const userListSearchInputRef = useRef<HTMLInputElement>\(null\)/);
  assert.match(page, /const hasAppliedUserFilters = Boolean\(appliedQuery \|\| roleFilter !== 'all' \|\| approvalFilter !== 'all'\)/);
  assert.match(page, /function clearUserListFilters\(\) \{\s*const filterSelectionChanged = roleFilter !== 'all' \|\| approvalFilter !== 'all';\s*setQuery\(''\);\s*setAppliedQuery\(''\);\s*setRoleFilter\('all'\);\s*setApprovalFilter\('all'\);\s*setPage\(1\);\s*if \(!filterSelectionChanged\) void load\(1, '', 'all', 'all'\);\s*userListSearchInputRef\.current\?\.focus\(\);\s*\}/);
  assert.match(page, /<input ref=\{userListSearchInputRef\} value=\{query\}/);
  assert.match(page, /userListEmptyMessage\(appliedQuery, roleFilter, approvalFilter\)/);
  const filterRowStart = page.indexOf('<div className="user-filter-row">');
  const filterRowEnd = page.indexOf('\n    {error && !resetUser', filterRowStart);
  assert.notEqual(filterRowStart, -1, 'expected the account filter row');
  assert.notEqual(filterRowEnd, -1, 'expected the account filters to end before the result state');
  const filterRow = page.slice(filterRowStart, filterRowEnd);
  assert.match(filterRow, /hasAppliedUserFilters && <Button type="button" variant="secondary" onClick=\{clearUserListFilters\}>Clear filters<\/Button>/);
  assert.match(page, /<div className="access-empty user-list-empty"><p>\{userListEmptyMessage\(appliedQuery, roleFilter, approvalFilter\)\}<\/p><\/div>/);
});

test('account filter reset remains stacked with controls at mobile widths', () => {
  const styles = fs.readFileSync(path.resolve('src/styles.css'), 'utf8');
  const filterRule = styles.indexOf('.users-page .user-filter-row { flex-direction: column; align-items: stretch; }');
  assert.notEqual(filterRule, -1, 'expected the mobile account filter layout');
  const mobileBreakpoint = styles.lastIndexOf('@media (max-width: 720px)', filterRule);
  assert.notEqual(mobileBreakpoint, -1, 'expected account filters to stack at the mobile breakpoint');
});

test('role and registration changes apply the visible user search draft', () => {
  const page = adminUsersPage();

  assert.match(page, /function applyUserListFilterChange\(nextRoleFilter: UserRoleFilter, nextApprovalFilter: UserApprovalFilter\) \{[\s\S]*?const nextQuery = query\.trim\(\);[\s\S]*?const filtersChanged = nextRoleFilter !== roleFilter \|\| nextApprovalFilter !== approvalFilter;[\s\S]*?const searchChanged = nextQuery !== appliedQuery;[\s\S]*?setQuery\(nextQuery\);[\s\S]*?setAppliedQuery\(nextQuery\);[\s\S]*?setRoleFilter\(nextRoleFilter\);[\s\S]*?setApprovalFilter\(nextApprovalFilter\);[\s\S]*?setPage\(1\);[\s\S]*?if \(!filtersChanged && searchChanged\) void load\(1, nextQuery, nextRoleFilter, nextApprovalFilter\);/);
  assert.match(page, /ariaLabel="Filter by role"[^\n]*onChange=\{\(nextRoleFilter\) => applyUserListFilterChange\(nextRoleFilter, approvalFilter\)\}/);
  assert.match(page, /ariaLabel="Filter by registration approval"[^\n]*onChange=\{\(nextApprovalFilter\) => applyUserListFilterChange\(roleFilter, nextApprovalFilter\)\}/);
});
