import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
import { DEFAULT_MAX_UPLOAD_BYTES, formatUploadLimit, uploadSizeError } from '../../src/upload-size-validation.ts';

const sourcePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/pages-manage.tsx');
const source = fs.readFileSync(sourcePath, 'utf8');
const sourceFile = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function findFunction(node, name) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === name) return node;
  let found = null;
  ts.forEachChild(node, (child) => {
    found ??= findFunction(child, name);
  });
  return found;
}

test('upload size validation accepts the configured boundary and matches server error wording', () => {
  assert.equal(DEFAULT_MAX_UPLOAD_BYTES, 2 * 1024 ** 3);
  assert.equal(uploadSizeError(1024, 1024), null);
  assert.equal(uploadSizeError(0, 0), null);
  assert.equal(formatUploadLimit(1), '1 byte (1 byte)');
  assert.equal(formatUploadLimit(1536), '1.5 KiB (1,536 bytes)');
  assert.equal(uploadSizeError(2 * 1024 ** 3 + 1, 2 * 1024 ** 3),
    'This file exceeds the configured upload limit of 2 GiB (2,147,483,648 bytes).');
});

test('document, video, and cover size checks run before saving or uploading', () => {
  const cases = [
    { name: 'uploadDocument', priorAction: 'await persistLessonDetails()', nextAction: 'await api.upload' },
    { name: 'uploadVideo', priorAction: 'await saveCourseDetailsIfChanged()', nextAction: 'await api.upload' },
    { name: 'uploadCover', priorAction: 'await readImageDimensions(file, validationController.signal)', nextAction: 'await api.upload' },
  ];

  for (const { name, priorAction, nextAction } of cases) {
    const fn = findFunction(sourceFile, name);
    assert.ok(fn, `${name} should exist`);
    const body = fn.getText(sourceFile);
    const preflight = body.indexOf('uploadSizeError(file.size, maxUploadBytes)');
    const nextActionIndex = body.indexOf(nextAction);
    assert.ok(preflight >= 0, `${name} should check the configured file-size limit`);
    assert.ok(preflight < body.indexOf(priorAction), `${name} should reject oversized files before its next save or validation action`);
    assert.ok(nextActionIndex >= 0, `${name} should upload the selected file`);
    assert.ok(preflight < nextActionIndex, `${name} should reject oversized files before uploading`);
    assert.match(body.slice(preflight), /input\.focus\(\)/, `${name} should keep the selected file control reachable after an error`);
  }
});
