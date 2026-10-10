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

test('admin user search results show the matched account email under its username', () => {
  const sourcePath = path.join(sourceRoot, 'pages-manage.tsx');
  const source = fs.readFileSync(sourcePath, 'utf8');
  const sourceFile = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let userIdentityLink;

  function visit(node) {
    if (ts.isJsxElement(node) && ts.isIdentifier(node.openingElement.tagName)
      && node.openingElement.tagName.text === 'Link'
      && stringAttribute(node.openingElement, 'className') === 'owner-cell user-detail-link') {
      userIdentityLink = node;
      return;
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  assert.ok(userIdentityLink, 'the administrator user row should have a details link');

  let emailIsSecondaryText = false;
  function visitIdentity(node) {
    if (ts.isJsxElement(node) && ts.isIdentifier(node.openingElement.tagName)
      && node.openingElement.tagName.text === 'small'
      && node.getText(sourceFile).includes('user.email')) {
      emailIsSecondaryText = true;
    }
    ts.forEachChild(node, visitIdentity);
  }

  visitIdentity(userIdentityLink);
  assert.ok(emailIsSecondaryText, 'the matching email should appear as secondary text in the result row');
});

test('admin user-list emails are visually capped and truncated', () => {
  const css = fs.readFileSync(path.resolve(sourceRoot, 'styles.css'), 'utf8');
  assert.match(css, /\.user-detail-link-copy small\s*\{[^}]*max-width:\s*220px;[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;/);
});
