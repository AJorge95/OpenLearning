import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
const pagePath = path.join(sourceDirectory, 'pages-manage.tsx');

function jsxAttribute(element, name) {
  return element.openingElement.attributes.properties.find((attribute) =>
    ts.isJsxAttribute(attribute) && attribute.name.getText() === name);
}

test('certificate-name save is disabled when normalized names are unchanged', () => {
  const source = fs.readFileSync(pagePath, 'utf8');
  const sourceFile = ts.createSourceFile(pagePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const profileForms = [];
  const saveButtons = [];

  function visit(node, insideProfileForm = false) {
    if (ts.isJsxElement(node)) {
      const tagName = node.openingElement.tagName.getText();
      const formClass = jsxAttribute(node, 'className')?.initializer;
      const isProfileForm = tagName === 'form' && ts.isStringLiteral(formClass)
        && formClass.text === 'account-profile-form form-stack';
      const submitType = jsxAttribute(node, 'type')?.initializer;
      const isProfileButton = tagName === 'Button' && insideProfileForm
        && ts.isStringLiteral(submitType) && submitType.text === 'submit';
      if (isProfileForm) profileForms.push(node);
      if (isProfileButton) saveButtons.push(node);
      node.children.forEach((child) => visit(child, insideProfileForm || isProfileForm));
      return;
    }
    ts.forEachChild(node, (child) => visit(child, insideProfileForm));
  }

  visit(sourceFile);
  assert.equal(profileForms.length, 1, 'expected one certificate-name form');
  assert.equal(saveButtons.length, 1, 'expected one certificate-name submit button');
  assert.equal(jsxAttribute(saveButtons[0], 'disabled')?.initializer?.expression?.getText(sourceFile),
    'saving || !certificateNameChanged');
  assert.match(saveButtons[0].getText(sourceFile), /certificateNameChanged \? 'Save certificate name' : 'No changes'/);
  assert.match(source, /normalizeAccountNameDraft\(profileFirstName\).*user\.firstName/);
  assert.match(source, /normalizeAccountNameDraft\(profileLastName\).*user\.lastName/);
});
