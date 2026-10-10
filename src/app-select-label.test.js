import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));

function jsxTagName(tagName) {
  return ts.isIdentifier(tagName) ? tagName.text : '';
}

function labelWrappedAppSelects(sourceFile) {
  const violations = [];

  function visit(node, insideLabel = false) {
    if (ts.isJsxElement(node)) {
      const tagName = jsxTagName(node.openingElement.tagName);
      if (tagName === 'AppSelect' && insideLabel) violations.push(node.openingElement);
      const childIsInsideLabel = insideLabel || tagName === 'label';
      node.children.forEach((child) => visit(child, childIsInsideLabel));
      return;
    }

    if (ts.isJsxSelfClosingElement(node)) {
      if (jsxTagName(node.tagName) === 'AppSelect' && insideLabel) violations.push(node);
      return;
    }

    ts.forEachChild(node, (child) => visit(child, insideLabel));
  }

  visit(sourceFile);
  return violations;
}

function collectTsxFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectTsxFiles(entryPath);
    return entry.isFile() && entry.name.endsWith('.tsx') ? [entryPath] : [];
  });
}

test('the AppSelect label guard detects a wrapped custom control', () => {
  const source = ts.createSourceFile(
    'fixture.tsx',
    'const field = <label>Role <AppSelect ariaLabel="Role" /></label>;',
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );

  assert.equal(labelWrappedAppSelects(source).length, 1);
});

test('AppSelect controls are not nested inside native labels', () => {
  const violations = collectTsxFiles(sourceDirectory).flatMap((filePath) => {
    const source = fs.readFileSync(filePath, 'utf8');
    const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    return labelWrappedAppSelects(sourceFile).map((node) => {
      const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      return `${path.relative(sourceDirectory, filePath)}:${line + 1}`;
    });
  });

  assert.deepEqual(violations, [], `AppSelect must use a separate field container instead of a wrapping label:\n${violations.join('\n')}`);
});
