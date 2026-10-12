import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src');

function stringAttribute(element, attributeName) {
  const attribute = element.attributes.properties.find((property) => (
    ts.isJsxAttribute(property) && ts.isIdentifier(property.name) && property.name.text === attributeName
  ));
  return attribute && ts.isJsxAttribute(attribute) && ts.isStringLiteral(attribute.initializer)
    ? attribute.initializer.text : '';
}

test('lesson and quiz names provide row context in course analytics tables', () => {
  const sourcePath = path.join(sourceRoot, 'pages-manage.tsx');
  const source = fs.readFileSync(sourcePath, 'utf8');
  const sourceFile = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const rowHeaders = [];

  function visit(node) {
    if (ts.isJsxElement(node) && ts.isIdentifier(node.openingElement.tagName)
      && node.openingElement.tagName.text === 'th'
      && stringAttribute(node.openingElement, 'scope') === 'row') rowHeaders.push(node.getText(sourceFile));
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  assert.equal(rowHeaders.filter((header) => header.includes('{lesson.title}')).length, 1);
  assert.equal(rowHeaders.filter((header) => header.includes('{quiz.title}')).length, 1);

  const styles = fs.readFileSync(path.resolve(sourceRoot, 'styles.css'), 'utf8');
  assert.match(styles, /\.analytics-table td, \.analytics-table tbody th\s*\{[^}]*padding:\s*13px 12px;[^}]*border-bottom:\s*1px solid var\(--line\);[^}]*vertical-align:\s*top;/);
  assert.match(styles, /\.analytics-table tbody th\s*\{[^}]*background:\s*transparent;[^}]*font-weight:\s*400;[^}]*text-align:\s*left;/);
  assert.match(styles, /\.analytics-table td strong, \.analytics-table tbody th strong/);
  assert.match(styles, /\.analytics-table td small, \.analytics-table tbody th small/);
});
