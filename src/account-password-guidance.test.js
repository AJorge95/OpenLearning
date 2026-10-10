import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
const pagePath = path.join(sourceDirectory, 'pages-manage.tsx');

function jsxAttribute(element, name) {
  const openingElement = ts.isJsxElement(element) ? element.openingElement : element;
  return openingElement.attributes.properties.find((attribute) =>
    ts.isJsxAttribute(attribute) && attribute.name.getText() === name);
}

function jsxTagName(element) {
  return (ts.isJsxElement(element) ? element.openingElement.tagName : element.tagName).getText();
}

function stringAttribute(element, name) {
  const initializer = jsxAttribute(element, name)?.initializer;
  return initializer && ts.isStringLiteral(initializer) ? initializer.text : null;
}

function attributeExpression(element, name) {
  const initializer = jsxAttribute(element, name)?.initializer;
  if (!initializer) return null;
  if (ts.isJsxExpression(initializer)) return initializer.expression?.getText() ?? null;
  return initializer.getText();
}

test('account password reset explains and announces the password length requirement', () => {
  const source = fs.readFileSync(pagePath, 'utf8');
  const sourceFile = ts.createSourceFile(pagePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const passwordFields = [];

  function visit(node, inResetForm = false) {
    if (ts.isJsxElement(node)) {
      const isResetForm = node.openingElement.tagName.getText() === 'form'
        && stringAttribute(node, 'className') === 'form-stack account-password-form';
      if (isResetForm) {
        node.children.forEach((child) => visit(child, true));
        return;
      }
      if (inResetForm && node.openingElement.tagName.getText() === 'div'
        && stringAttribute(node, 'className') === 'account-password-field') {
        passwordFields.push(node);
      }
      node.children.forEach((child) => visit(child, inResetForm));
      return;
    }
    ts.forEachChild(node, (child) => visit(child, inResetForm));
  }

  visit(sourceFile);
  assert.equal(passwordFields.length, 1, 'expected one guided password field in the account reset form');

  const field = passwordFields[0];
  const children = field.children.filter((child) => ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child));
  const label = children.find((child) => jsxTagName(child) === 'label');
  const input = children.find((child) => jsxTagName(child) === 'input');
  const hint = children.find((child) => jsxTagName(child) === 'small');
  assert.ok(label && input && hint, 'expected a label, input, and visible requirement hint');

  const passwordId = attributeExpression(input, 'id');
  const labelFor = attributeExpression(label, 'htmlFor');
  const describedBy = attributeExpression(input, 'aria-describedby');
  const hintId = attributeExpression(hint, 'id');
  assert.equal(labelFor, passwordId);
  assert.equal(describedBy, hintId);
  assert.equal(hint.getText(sourceFile).replace(/<[^>]+>/g, '').trim(), 'Use at least 12 characters.');
  assert.equal(attributeExpression(input, 'minLength'), '12');
  assert.equal(attributeExpression(input, 'maxLength'), '256');
});
