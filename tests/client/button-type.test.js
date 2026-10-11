import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const sourceDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src');

function collectTsxFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectTsxFiles(entryPath);
    return entry.isFile() && entry.name.endsWith('.tsx') ? [entryPath] : [];
  });
}

function buttonsWithoutType(sourceFile) {
  const violations = [];

  function visit(node) {
    const isButton = (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node))
      && ts.isIdentifier(node.tagName) && node.tagName.text === 'button';
    if (isButton && !node.attributes.properties.some((attribute) => (
      ts.isJsxAttribute(attribute) && ts.isIdentifier(attribute.name) && attribute.name.text === 'type'
    ))) {
      const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      violations.push(line + 1);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return violations;
}

test('native JSX buttons declare their form behavior', () => {
  const violations = collectTsxFiles(sourceDirectory).flatMap((filePath) => {
    const source = fs.readFileSync(filePath, 'utf8');
    const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    return buttonsWithoutType(sourceFile).map((line) => `${path.relative(sourceDirectory, filePath)}:${line}`);
  });

  assert.deepEqual(violations, [], `Native buttons need an explicit type to avoid accidental form submission:\n${violations.join('\n')}`);
});
