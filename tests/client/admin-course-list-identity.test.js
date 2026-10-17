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

test('admin course identities are row headers in the course table', () => {
  const sourcePath = path.join(sourceRoot, 'pages-manage.tsx');
  const source = fs.readFileSync(sourcePath, 'utf8');
  const sourceFile = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let identityRowHeader;

  function visit(node) {
    if (ts.isJsxElement(node) && ts.isIdentifier(node.openingElement.tagName)
      && node.openingElement.tagName.text === 'th'
      && stringAttribute(node.openingElement, 'scope') === 'row'
      && node.getText(sourceFile).includes('className="table-course"')) {
      identityRowHeader = node;
      return;
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  assert.ok(identityRowHeader, 'each course title should label its row for table navigation');
  assert.match(identityRowHeader.getText(sourceFile), /<Link to=\{`\/manage\/courses\/\$\{course\.id\}\/edit`\}>\{course\.title\}<\/Link>/);

  const styles = fs.readFileSync(path.resolve(sourceRoot, 'styles.css'), 'utf8');
  assert.match(styles, /\.course-table tbody th\s*\{[^}]*height:\s*78px;[^}]*padding:\s*10px 16px;[^}]*background:\s*transparent;[^}]*text-align:\s*left;/);
  assert.match(styles, /\.course-table tbody tr:last-child td, \.course-table tbody tr:last-child th[^\{]*\{ border-bottom: 0; \}/);
  assert.match(styles, /@media \(max-width: 940px\) \{[\s\S]*?\.course-table th, \.course-table td[^\{]*\{ padding-right: 11px; padding-left: 11px; \}/);
});
