import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const pagePath = fileURLToPath(new URL('../../src/pages-auth.tsx', import.meta.url));
const source = fs.readFileSync(pagePath, 'utf8');
const sourceFile = ts.createSourceFile(pagePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function openingElement(element) {
  return ts.isJsxElement(element) ? element.openingElement : element;
}

function findAttribute(element, name) {
  return openingElement(element).attributes.properties.find((attribute) =>
    ts.isJsxAttribute(attribute) && attribute.name.getText(sourceFile) === name);
}

function attributeExpression(element, name) {
  const attribute = findAttribute(element, name);
  if (!attribute || !attribute.initializer) return undefined;
  return ts.isJsxExpression(attribute.initializer)
    ? attribute.initializer.expression?.getText(sourceFile)
    : attribute.initializer.getText(sourceFile);
}

function findComponent(name) {
  return sourceFile.statements.find((statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === name);
}

function findUsernameField(componentName) {
  const component = findComponent(componentName);
  assert.ok(component, `expected ${componentName} to exist`);
  let field;
  function visit(node) {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(sourceFile) === 'div'
      && attributeExpression(node, 'className') === '"form-stack-username-field"') field = node;
    ts.forEachChild(node, visit);
  }
  visit(component);
  assert.ok(field, `expected ${componentName} to render its username field`);

  const controls = field.children.filter((child) => ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child));
  const label = controls.find((child) => openingElement(child).tagName.getText(sourceFile) === 'label');
  const input = controls.find((child) => openingElement(child).tagName.getText(sourceFile) === 'input');
  const help = controls.find((child) => openingElement(child).tagName.getText(sourceFile) === 'small');
  assert.ok(label && input && help, `expected ${componentName} to include label, input, and help text`);
  return { label, input, help };
}

test('setup and registration username fields keep their help text out of the name and linked as a description', () => {
  for (const componentName of ['SetupPage', 'RegisterPage']) {
    const { label, input, help } = findUsernameField(componentName);
    const inputId = attributeExpression(input, 'id');
    const helpId = attributeExpression(help, 'id');

    assert.equal(attributeExpression(label, 'htmlFor'), inputId);
    assert.equal(attributeExpression(input, 'aria-describedby'), helpId);
    assert.equal(attributeExpression(input, 'pattern'), '"[A-Za-z0-9_.-]+"');
    assert.match(help.getText(sourceFile), /Letters, numbers, dots, underscores, and hyphens\./);
    assert.doesNotMatch(label.getText(sourceFile), /Letters, numbers, dots, underscores, and hyphens/);
  }
});
