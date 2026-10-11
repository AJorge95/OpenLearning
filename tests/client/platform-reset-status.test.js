import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const sourcePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/pages-manage.tsx');

test('settings distinguish a verified backup from an active platform reset', () => {
  const source = fs.readFileSync(sourcePath, 'utf8');
  const sourceFile = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const settingsPage = sourceFile.statements.find((statement) => ts.isFunctionDeclaration(statement)
    && statement.name?.text === 'AdminSettingsPage');
  assert.ok(settingsPage, 'expected to find the admin settings page');

  const pageSource = settingsPage.getText(sourceFile);
  assert.match(pageSource, /resetState\.pending && resetState\.phase === 'ready' && !resetState\.confirmationId && <div className="platform-reset-pending" role="status"><strong>Another administrator has prepared a verified backup and can now confirm or cancel the reset\.<\/strong><span>Platform requests remain paused until they confirm or cancel the reset\.<\/span>/);
  assert.match(pageSource, /resetState\.pending && resetState\.phase === 'resetting' && <div className="platform-reset-pending" role="status" aria-live="polite"><strong>Platform reset in progress…<\/strong><span>Platform requests remain paused until the reset completes\.<\/span>/);
  assert.match(pageSource, /phase\?: 'preparing' \| 'ready' \| 'resetting'/);
});
