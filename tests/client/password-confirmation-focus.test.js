import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';

const sourceRoot = path.resolve('src');

function componentSource(fileName, componentName) {
  const filePath = path.join(sourceRoot, fileName);
  const source = fs.readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declaration = sourceFile.statements.find((statement) => ts.isFunctionDeclaration(statement)
    && statement.name?.text === componentName);
  assert.ok(declaration, `Expected to find ${componentName} in ${fileName}.`);
  return declaration.getText(sourceFile);
}

test('every password-confirmation mismatch focuses its associated input', () => {
  const formComponents = [
    ['pages-auth.tsx', 'SetupPage'],
    ['pages-auth.tsx', 'RegisterPage'],
    ['pages-auth.tsx', 'AccountSecurityPage'],
    ['pages-manage.tsx', 'AdminUsersPage'],
    ['pages-manage.tsx', 'AdminUserCreatePage'],
    ['pages-manage.tsx', 'AdminUserDetailsPage'],
  ];

  for (const [fileName, componentName] of formComponents) {
    const component = componentSource(fileName, componentName);
    assert.match(component, /const confirmPasswordInputRef = useRef<HTMLInputElement>\(null\)/, `${componentName} should own its confirmation input ref`);

    const confirmationField = component.match(/<PasswordField label="Confirm(?: new)? password"[\s\S]*?\/>/)?.[0];
    assert.ok(confirmationField, `${componentName} should render its confirmation field`);
    assert.match(confirmationField, /inputRef=\{confirmPasswordInputRef\}/, `${componentName} should attach the focus ref to the confirmation input`);

    const validationStart = component.indexOf('const confirmationError = getPasswordConfirmationError');
    assert.notEqual(validationStart, -1, `${componentName} should validate the password confirmation`);
    const validation = component.slice(validationStart, validationStart + 600);
    assert.match(validation, /if \(confirmationError\)[\s\S]*?confirmPasswordInputRef\.current\?\.focus\(\)[\s\S]*?return;/, `${componentName} should focus the confirmation field before returning`);
  }
});

test('PasswordField forwards an optional input ref to the rendered password input', () => {
  const source = fs.readFileSync(path.join(sourceRoot, 'components.tsx'), 'utf8');
  const component = source.slice(source.indexOf('type PasswordFieldProps'), source.indexOf('export function EmptyState'));

  assert.match(component, /inputRef\?: React\.Ref<HTMLInputElement>/);
  assert.match(component, /<input \{\.\.\.inputProps\} ref=\{inputRef\}/);
});
