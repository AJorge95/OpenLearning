import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const sourceDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src');
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
    if (ts.isJsxSelfClosingElement(node) && inResetForm
      && node.tagName.getText() === 'PasswordField'
      && stringAttribute(node, 'label') === 'New password') {
      passwordFields.push(node);
      return;
    }
    if (ts.isJsxElement(node)) {
      const isResetForm = node.openingElement.tagName.getText() === 'form'
        && stringAttribute(node, 'className') === 'form-stack account-password-form';
      if (isResetForm) {
        node.children.forEach((child) => visit(child, true));
        return;
      }
      node.children.forEach((child) => visit(child, inResetForm));
      return;
    }
    ts.forEachChild(node, (child) => visit(child, inResetForm));
  }

  visit(sourceFile);
  assert.equal(passwordFields.length, 1, 'expected one guided password field in the account reset form');

  const field = passwordFields[0];
  assert.equal(stringAttribute(field, 'hint'), 'Use at least 12 characters.');
  assert.equal(attributeExpression(field, 'id'), 'passwordInputId');
  assert.equal(attributeExpression(field, 'hintId'), 'passwordHintId');
  assert.equal(attributeExpression(field, 'minLength'), '12');
  assert.equal(attributeExpression(field, 'maxLength'), '256');
});

test('administrator password-reset dialog explains and announces the password length requirement', () => {
  const source = fs.readFileSync(pagePath, 'utf8');
  const sourceFile = ts.createSourceFile(pagePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const resetForms = [];

  function visit(node) {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText() === 'form'
      && stringAttribute(node, 'className') === 'form-stack'
      && attributeExpression(node, 'onSubmit') === 'resetPassword') {
      resetForms.push(node);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  assert.equal(resetForms.length, 1, 'expected one password-reset dialog form');

  const passwordField = resetForms[0].children.find((child) => ts.isJsxSelfClosingElement(child)
    && jsxTagName(child) === 'PasswordField'
    && stringAttribute(child, 'label') === 'New password');
  assert.ok(passwordField, 'expected a labeled new-password field');
  assert.equal(stringAttribute(passwordField, 'hint'), 'Use at least 12 characters.');
  assert.equal(attributeExpression(passwordField, 'hintId'), 'resetPasswordHintId');
  assert.equal(attributeExpression(passwordField, 'minLength'), '12');
  assert.equal(attributeExpression(passwordField, 'maxLength'), '256');
  assert.ok(jsxAttribute(passwordField, 'autoFocus'));
});
