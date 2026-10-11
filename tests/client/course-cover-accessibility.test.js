import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
import { MAX_COURSE_COVER_DIMENSION } from '../../src/course-cover-validation.ts';

const sourcePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/pages-manage.tsx');
const source = fs.readFileSync(sourcePath, 'utf8');
const sourceFile = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function jsxAttribute(element, name) {
  return element.attributes.properties.find((attribute) => (
    ts.isJsxAttribute(attribute) && attribute.name.text === name
  ));
}

function expressionAttribute(element, name) {
  const initializer = jsxAttribute(element, name)?.initializer;
  return initializer && ts.isJsxExpression(initializer) ? initializer.expression?.getText() ?? null : null;
}

test('course cover file input announces its accepted formats and dimension limit', () => {
  const component = sourceFile.statements.find((statement) => ts.isFunctionDeclaration(statement)
    && statement.name?.text === 'CourseEditorPage');
  assert.ok(component, 'CourseEditorPage should exist');

  const hints = [];
  const inputs = [];
  function visit(node) {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText() === 'small'
      && node.getText(sourceFile).includes('JPG, PNG, or WebP · max')
      && (node.getText(sourceFile).match(/MAX_COURSE_COVER_DIMENSION/g) || []).length === 2) {
      hints.push(node.openingElement);
    }
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText() === 'input'
      && jsxAttribute(node, 'type')?.initializer?.getText() === '"file"'
      && jsxAttribute(node, 'accept')?.initializer?.getText() === '"image/jpeg,image/png,image/webp"') {
      inputs.push(node);
    }
    ts.forEachChild(node, visit);
  }
  visit(component);

  assert.equal(hints.length, 1, 'expected one visible course cover size hint');
  assert.equal(inputs.length, 1, 'expected one course cover file input');
  const hintId = expressionAttribute(hints[0], 'id');
  assert.ok(hintId, 'the visible course cover hint should have an id');
  assert.equal(expressionAttribute(inputs[0], 'aria-describedby'), hintId);
  assert.equal(MAX_COURSE_COVER_DIMENSION, 4096);
});
