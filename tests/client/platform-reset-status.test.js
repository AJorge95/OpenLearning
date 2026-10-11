import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
import { readResetStatusAfterConflict } from '../../src/platform-reset-status.ts';

const sourcePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/pages-manage.tsx');

test('settings distinguish a verified backup from an active platform reset', () => {
  const source = fs.readFileSync(sourcePath, 'utf8');
  const sourceFile = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const settingsPage = sourceFile.statements.find((statement) => ts.isFunctionDeclaration(statement)
    && statement.name?.text === 'AdminSettingsPage');
  assert.ok(settingsPage, 'expected to find the admin settings page');

  const pageSource = settingsPage.getText(sourceFile);
  const statusSource = fs.readFileSync(path.resolve(path.dirname(sourcePath), 'platform-reset-status.ts'), 'utf8');
  assert.match(pageSource, /resetState\.pending && resetState\.phase === 'ready' && !resetState\.confirmationId && <div className="platform-reset-pending" role="status"><strong>Another administrator has prepared a verified backup and can now confirm or cancel the reset\.<\/strong><span>Platform requests remain paused until they confirm or cancel the reset\.<\/span>/);
  assert.match(pageSource, /resetState\.pending && resetState\.phase === 'resetting' && <div className="platform-reset-pending" role="status" aria-live="polite"><strong>Platform reset in progress…<\/strong><span>Platform requests remain paused until the reset completes\.<\/span>/);
  assert.match(statusSource, /phase\?: 'preparing' \| 'ready' \| 'resetting'/);
  assert.match(pageSource, /readResetStatusAfterConflict\(cause, \(\) => api\.get<PlatformResetStatus>\('\/api\/admin\/platform-reset'\)\)/);
});

test('a reset conflict reloads another administrator’s pending status', async () => {
  const status = { pending: true, phase: 'preparing' };
  let requests = 0;

  const recovered = await readResetStatusAfterConflict(
    { code: 'platform_reset_in_progress' },
    async () => { requests++; return status; },
  );

  assert.equal(requests, 1);
  assert.equal(recovered, status);
});

test('reset status recovery ignores unrelated errors and completed conflicts', async () => {
  let requests = 0;
  const loadStatus = async () => { requests++; return { pending: false }; };

  assert.equal(await readResetStatusAfterConflict({ code: 'backup_failed' }, loadStatus), undefined);
  assert.equal(await readResetStatusAfterConflict({ code: 'platform_reset_in_progress' }, loadStatus), undefined);
  assert.equal(requests, 1);
});

test('reset status recovery preserves the original conflict if status refresh fails', async () => {
  const recovered = await readResetStatusAfterConflict(
    { code: 'platform_reset_in_progress' },
    async () => { throw new Error('Status endpoint unavailable.'); },
  );

  assert.equal(recovered, undefined);
});
