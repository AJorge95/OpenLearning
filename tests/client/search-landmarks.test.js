import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const sourceDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src');
const pageFiles = ['pages-manage.tsx', 'pages-learner.tsx', 'pages-programs.tsx'];

function jsxStringAttribute(openingElement, attributeName, sourceFile) {
  const attribute = openingElement.attributes.properties.find((property) =>
    ts.isJsxAttribute(property) && property.name.getText(sourceFile) === attributeName);
  return attribute && ts.isStringLiteral(attribute.initializer) ? attribute.initializer.text : null;
}

function courseAndManagementSearchForms() {
  const forms = [];
  for (const fileName of pageFiles) {
    const filePath = path.join(sourceDirectory, fileName);
    const source = fs.readFileSync(filePath, 'utf8');
    const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

    function visit(node) {
      if (ts.isJsxElement(node) && node.openingElement.tagName.getText(sourceFile) === 'form') {
        const openingElement = node.openingElement;
        const className = jsxStringAttribute(openingElement, 'className', sourceFile) || '';
        const role = jsxStringAttribute(openingElement, 'role', sourceFile);
        if (role === 'search' || /\b(?:management-search|search-field)\b/.test(className)) {
          const searchIcons = [];
          function collectSearchIcons(child) {
            if (ts.isJsxSelfClosingElement(child) && child.tagName.getText(sourceFile) === 'Search') {
              searchIcons.push(jsxStringAttribute(child, 'aria-hidden', sourceFile));
            }
            ts.forEachChild(child, collectSearchIcons);
          }
          node.children.forEach(collectSearchIcons);
          forms.push({
            fileName,
            className,
            role,
            label: jsxStringAttribute(openingElement, 'aria-label', sourceFile),
            searchIcons,
          });
        }
      }
      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
  }
  return forms;
}

test('course and management search forms are named search landmarks', () => {
  const forms = courseAndManagementSearchForms();

  assert.equal(forms.length, 10, 'expected to review every course and management search form');
  for (const form of forms) {
    assert.equal(form.role, 'search', `${form.fileName} ${form.className} should expose the search landmark`);
    assert.ok(form.label?.trim(), `${form.fileName} ${form.className} should name its search landmark`);
  }
});

test('course and management search landmarks use native search inputs', () => {
  for (const fileName of pageFiles) {
    const filePath = path.join(sourceDirectory, fileName);
    const source = fs.readFileSync(filePath, 'utf8');
    const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

    function findSearchInput(node) {
      if (ts.isJsxSelfClosingElement(node)
        && node.tagName.getText(sourceFile) === 'input'
        && jsxStringAttribute(node, 'type', sourceFile) === 'search') {
        return node;
      }
      let result = null;
      ts.forEachChild(node, (child) => {
        if (!result) result = findSearchInput(child);
      });
      return result;
    }

    function visit(node) {
      if (ts.isJsxElement(node) && node.openingElement.tagName.getText(sourceFile) === 'form') {
        const className = jsxStringAttribute(node.openingElement, 'className', sourceFile) || '';
        const role = jsxStringAttribute(node.openingElement, 'role', sourceFile);
        if (role === 'search' || /\b(?:management-search|search-field)\b/.test(className)) {
          const input = findSearchInput(node);
          assert.ok(input, `${fileName} ${className} should contain a search input`);
          assert.equal(jsxStringAttribute(input, 'type', sourceFile), 'search', `${fileName} ${className} should use type=search`);
        }
      }
      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
  }
});

test('course and management search landmarks hide decorative icons', () => {
  const forms = courseAndManagementSearchForms();

  for (const form of forms) {
    const expectedIconCount = form.className.includes('course-group-search') ? 2 : 1;
    assert.equal(form.searchIcons.length, expectedIconCount, `${form.fileName} ${form.className} should contain its decorative Search icons`);
    assert.ok(form.searchIcons.every((value) => value === 'true'), `${form.fileName} ${form.className} should hide its decorative Search icons`);
  }
});
