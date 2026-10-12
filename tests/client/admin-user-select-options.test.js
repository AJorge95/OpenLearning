import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const sourcePath = new URL('../../src/pages-manage.tsx', import.meta.url);
const source = fs.readFileSync(sourcePath, 'utf8');
const sourceFile = ts.createSourceFile(sourcePath.pathname, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const componentSource = fs.readFileSync(new URL('../../src/components.tsx', import.meta.url), 'utf8');

function adminUsersPage() {
  const declaration = sourceFile.statements.find((statement) => ts.isFunctionDeclaration(statement)
    && statement.name?.text === 'AdminUsersPage');
  assert.ok(declaration?.body, 'Expected AdminUsersPage.');
  return declaration.body.getText(sourceFile);
}

test('admin account selects reuse module-level option lists across page updates', () => {
  const page = adminUsersPage();
  const roleOptions = sourceFile.statements.find((statement) => ts.isVariableStatement(statement)
    && statement.declarationList.declarations.some((declaration) => ts.isIdentifier(declaration.name)
      && declaration.name.text === 'ADMIN_USER_ROLE_OPTIONS'));
  assert.ok(roleOptions, 'Expected account row options outside the rerendering page component.');
  assert.match(page, /<AppSelect<Role>[^\n]*options=\{ADMIN_USER_ROLE_OPTIONS\} \/>/);
  assert.match(page, /ariaLabel="Filter by role"[^\n]*options=\{USER_ROLE_FILTER_OPTIONS\}/);
  assert.match(page, /ariaLabel="Filter by registration approval"[^\n]*options=\{USER_APPROVAL_FILTER_OPTIONS\}/);
  assert.ok(componentSource.includes('const activeOption = options.find('));
  assert.ok(componentSource.includes('}, [activeOptionIndex, activeValue, options, unavailable]);'));
});
