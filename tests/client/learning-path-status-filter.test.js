import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const sourcePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/pages-programs.tsx');
const source = fs.readFileSync(sourcePath, 'utf8');
const sourceFile = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const handlers = new Map();

function collectHandlers(node) {
  if (ts.isFunctionDeclaration(node) && node.name) handlers.set(node.name.text, node.getText(sourceFile));
  ts.forEachChild(node, collectHandlers);
}

collectHandlers(sourceFile);

test('changing learning-path status clears previous results and pager before loading', () => {
  const changePathStatus = handlers.get('changePathStatus');
  assert.ok(changePathStatus, 'expected the learning-path status handler');

  const loadIndex = changePathStatus.indexOf('void load(1, status, nextSearch);');
  assert.ok(loadIndex >= 0, 'expected the selected status to load from page one');
  for (const reset of ['setPaths([]);', 'setPathPage(1);', 'setPathTotal(0);', 'setPathHasMore(false);']) {
    const resetIndex = changePathStatus.indexOf(reset);
    assert.ok(resetIndex >= 0 && resetIndex < loadIndex, `${reset} should run before the filtered request`);
  }
  assert.match(changePathStatus, /setPathStatus\(status\);[\s\S]*?void load\(1, status, nextSearch\);/);
});

test('same-filter pagination keeps the current learning-path results visible while loading', () => {
  const changePathPage = handlers.get('changePathPage');
  assert.ok(changePathPage, 'expected the learning-path page handler');
  assert.match(changePathPage, /void load\(page\);/);
  assert.doesNotMatch(changePathPage, /setPaths\(\[\]\)|setPathTotal\(0\)|setPathHasMore\(false\)/);
});

test('learning-path pagination stays disabled while a path mutation is pending', () => {
  const changePathPage = handlers.get('changePathPage');
  assert.ok(changePathPage, 'expected the learning-path page handler');
  assert.match(changePathPage, /if \(loading \|\| saving \|\| assignmentBusy \|\| page < 1\) return/);
  assert.match(source, /disabled=\{pathPage <= 1 \|\| loading \|\| saving \|\| assignmentBusy\}/);
  assert.match(source, /disabled=\{!pathHasMore \|\| loading \|\| saving \|\| assignmentBusy\}/);
});
