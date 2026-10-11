import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const sourcePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/pages-manage.tsx');

test('settings distinguish a verified reset backup awaiting another admin', () => {
  const source = fs.readFileSync(sourcePath, 'utf8');
  const sourceFile = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const settingsPage = sourceFile.statements.find((statement) => ts.isFunctionDeclaration(statement)
    && statement.name?.text === 'AdminSettingsPage');
  assert.ok(settingsPage, 'expected to find the admin settings page');

  assert.match(settingsPage.getText(sourceFile), /resetState\.pending && !resetState\.confirmationId && resetState\.phase !== 'preparing' && <div className="platform-reset-pending" role="status"><strong>Another administrator has prepared a verified backup and can now confirm or cancel the reset\.<\/strong><span>Platform requests remain paused until they confirm or cancel the reset\.<\/span>/);
});
