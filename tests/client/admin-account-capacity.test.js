import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';

const sourcePath = path.resolve('src/pages-manage.tsx');
const source = fs.readFileSync(sourcePath, 'utf8');
const sourceFile = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const styles = fs.readFileSync(path.resolve('src/styles.css'), 'utf8');

function adminSettingsPage() {
  const declaration = sourceFile.statements.find((statement) => ts.isFunctionDeclaration(statement)
    && statement.name?.text === 'AdminSettingsPage');
  assert.ok(declaration?.body, 'Expected AdminSettingsPage.');
  return declaration.body.getText(sourceFile);
}

test('settings explain when the selected account cap blocks new accounts', () => {
  const page = adminSettingsPage();

  assert.match(page, /const accountLimitReached = accountLimit > 0 && registeredUserCount !== null && registeredUserCount >= accountLimit/);
  assert.match(page, /accountLimitReached && <p className="registered-count-limit-warning">The cap has no room for additional accounts\. Increase it to create more\.<\/p>/);
  assert.match(page, /<div className="registered-account-usage" role="status" aria-live="polite" aria-atomic="true">/);
  assert.match(styles, /\.registered-count-limit-warning\s*\{[^}]*color:\s*#80570a;[^}]*background:\s*#fff4d9;/);
});
