import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const pagePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/pages-programs.tsx');

function jsxAttribute(element, name) {
  return element.openingElement.attributes.properties.find((attribute) =>
    ts.isJsxAttribute(attribute) && attribute.name.getText() === name);
}

function expressionAttribute(element, name) {
  const initializer = jsxAttribute(element, name)?.initializer;
  return initializer && ts.isJsxExpression(initializer) ? initializer.expression?.getText() : null;
}

test('competency status buttons name the competency and current action', () => {
  const source = fs.readFileSync(pagePath, 'utf8');
  const sourceFile = ts.createSourceFile(pagePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const toggleButtons = [];

  function visit(node) {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText() === 'Button'
      && expressionAttribute(node, 'onClick')?.includes('toggle(item)')) {
      toggleButtons.push(node);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  assert.equal(toggleButtons.length, 1, 'expected one competency status action button');
  assert.equal(
    expressionAttribute(toggleButtons[0], 'aria-label'),
    "savingId === item.id ? `Saving ${item.title}` : `${item.active ? 'Deactivate' : 'Reactivate'} ${item.title}`",
  );
});
