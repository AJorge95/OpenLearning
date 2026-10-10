import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const sourceDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src');
const editorPath = path.join(sourceDirectory, 'pages-manage.tsx');

function jsxAttribute(element, name) {
  const attribute = element.openingElement.attributes.properties.find((item) =>
    ts.isJsxAttribute(item) && item.name.getText() === name);
  return attribute && ts.isStringLiteral(attribute.initializer) ? attribute.initializer.text : null;
}

test('course details form is exposed as a named region', () => {
  const source = fs.readFileSync(editorPath, 'utf8');
  const sourceFile = ts.createSourceFile(editorPath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const sections = [];
  function visit(node) {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText() === 'section'
      && jsxAttribute(node, 'className')?.split(/\s+/).includes('course-details-form')) {
      sections.push(node);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

  assert.equal(sections.length, 1, 'expected one course details section');
  assert.equal(jsxAttribute(sections[0], 'aria-label'), 'Course details');
});
