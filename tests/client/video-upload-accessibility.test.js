import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const sourcePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/pages-manage.tsx');
const source = fs.readFileSync(sourcePath, 'utf8');
const sourceFile = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function jsxAttribute(element, name) {
  return element.attributes.properties.find((attribute) => (
    ts.isJsxAttribute(attribute) && attribute.name.text === name
  ));
}

function stringAttribute(element, name) {
  const initializer = jsxAttribute(element, name)?.initializer;
  return initializer && ts.isStringLiteral(initializer) ? initializer.text : null;
}

function expressionAttribute(element, name) {
  const initializer = jsxAttribute(element, name)?.initializer;
  return initializer && ts.isJsxExpression(initializer) ? initializer.expression?.getText() ?? null : null;
}

test('lesson video input announces its accepted MP4 format', () => {
  const component = sourceFile.statements.find((statement) => ts.isFunctionDeclaration(statement)
    && statement.name?.text === 'CourseEditorPage');
  assert.ok(component, 'CourseEditorPage should exist');

  const inputs = [];
  const descriptions = [];
  function visit(node) {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText() === 'input'
      && stringAttribute(node, 'type') === 'file'
      && stringAttribute(node, 'accept') === 'video/mp4,.mp4') {
      inputs.push(node);
    }
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText() === 'span'
      && stringAttribute(node.openingElement, 'className') === 'sr-only'
      && node.getText(sourceFile).includes('Choose an MP4 video file.')) {
      descriptions.push(node.openingElement);
    }
    ts.forEachChild(node, visit);
  }
  visit(component);

  assert.equal(inputs.length, 1, 'expected one lesson video file input');
  assert.equal(descriptions.length, 1, 'expected one screen-reader-only video format hint');
  const helpId = expressionAttribute(descriptions[0], 'id');
  assert.ok(helpId, 'the MP4 hint should have an id');
  assert.equal(expressionAttribute(inputs[0], 'aria-describedby'), helpId);
});
