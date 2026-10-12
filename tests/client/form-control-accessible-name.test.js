import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const sourceDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src');

function jsxTagName(tagName) {
  return ts.isIdentifier(tagName) ? tagName.text : '';
}

function jsxAttributeValue(element, name, sourceFile) {
  const attribute = element.attributes.properties.find((property) => (
    ts.isJsxAttribute(property) && property.name.text === name
  ));
  if (!attribute?.initializer) return '';
  if (ts.isStringLiteralLike(attribute.initializer)) return attribute.initializer.text;
  if (!ts.isJsxExpression(attribute.initializer) || !attribute.initializer.expression) return '';
  const expression = attribute.initializer.expression;
  return ts.isStringLiteralLike(expression) ? expression.text : expression.getText(sourceFile);
}

function collectControlNameViolations(sourceFile, expectedTag, shouldInspect = () => true, hasNativeName = () => false) {
  const labelTargets = new Set();
  const violations = [];

  function collectLabels(node) {
    if (ts.isJsxElement(node) && jsxTagName(node.openingElement.tagName) === 'label') {
      const target = jsxAttributeValue(node.openingElement, 'htmlFor', sourceFile);
      if (target) labelTargets.add(target);
    }
    ts.forEachChild(node, collectLabels);
  }

  function visit(node, insideLabel = false) {
    if (ts.isJsxElement(node)) {
      const tagName = jsxTagName(node.openingElement.tagName);
      if (tagName === expectedTag && shouldInspect(node.openingElement)) inspect(node.openingElement, insideLabel);
      node.children.forEach((child) => visit(child, insideLabel || tagName === 'label'));
      return;
    }
    if (ts.isJsxSelfClosingElement(node)) {
      if (jsxTagName(node.tagName) === expectedTag && shouldInspect(node)) inspect(node, insideLabel);
      return;
    }
    ts.forEachChild(node, (child) => visit(child, insideLabel));
  }

  function inspect(element, insideLabel) {
    const id = jsxAttributeValue(element, 'id', sourceFile);
    const hasAccessibleName = insideLabel
      || Boolean(jsxAttributeValue(element, 'aria-label', sourceFile))
      || Boolean(jsxAttributeValue(element, 'aria-labelledby', sourceFile))
      || Boolean(id && labelTargets.has(id))
      || hasNativeName(element);
    if (!hasAccessibleName) {
      const { line } = sourceFile.getLineAndCharacterOfPosition(element.getStart(sourceFile));
      violations.push(`${sourceFile.fileName}:${line + 1}`);
    }
  }

  collectLabels(sourceFile);
  visit(sourceFile);
  return violations;
}

function collectTextareaNameViolations(sourceFile) {
  return collectControlNameViolations(sourceFile, 'textarea');
}

function collectInputNameViolations(sourceFile) {
  return collectControlNameViolations(sourceFile, 'input', (element) => {
    const type = jsxAttributeValue(element, 'type', sourceFile).toLowerCase();
    // Hidden inputs have no control in the accessibility tree; other input types still need a name.
    return type !== 'hidden';
  }, (element) => {
    const type = jsxAttributeValue(element, 'type', sourceFile).toLowerCase();
    const value = jsxAttributeValue(element, 'value', sourceFile);
    const alt = jsxAttributeValue(element, 'alt', sourceFile);
    const hasValueAttribute = element.attributes.properties.some((property) => (
      ts.isJsxAttribute(property) && property.name.text === 'value'
    ));

    if (type === 'image') return Boolean(alt);
    if (type === 'button') return Boolean(value);
    // Browsers provide default names for submit/reset inputs unless an empty value replaces them.
    if (type === 'submit' || type === 'reset') return !hasValueAttribute || Boolean(value);
    return false;
  });
}

function collectTsxFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectTsxFiles(entryPath);
    return entry.isFile() && entry.name.endsWith('.tsx') ? [entryPath] : [];
  });
}

test('the textarea label check detects a field without an accessible name', () => {
  const sourceFile = ts.createSourceFile(
    'fixture.tsx',
    'const field = <textarea placeholder="Describe this" />;',
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );

  assert.deepEqual(collectTextareaNameViolations(sourceFile), ['fixture.tsx:1']);
});

test('all project textareas have an implicit or explicit accessible name', () => {
  const violations = collectTsxFiles(sourceDirectory).flatMap((filePath) => {
    const source = fs.readFileSync(filePath, 'utf8');
    const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    return collectTextareaNameViolations(sourceFile);
  });

  assert.deepEqual(violations, [], `Textareas need a wrapping label, matching htmlFor/id, aria-label, or aria-labelledby:\n${violations.join('\n')}`);
});

test('the input label check detects an unnamed control and accepts a wrapped label', () => {
  const sourceFile = ts.createSourceFile(
    'fixture.tsx',
    'const choice = <label>Subscribe<input type="checkbox" /></label>;\nconst hidden = <input type="hidden" />;\nconst submit = <input type="submit" />;\nconst action = <input type="button" value="Continue" />;\nconst image = <input type="image" alt="Save" />;\nconst unnamedImage = <input type="image" />;\nconst search = <input type="search" placeholder="Search" />;',
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );

  assert.deepEqual(collectInputNameViolations(sourceFile), ['fixture.tsx:6', 'fixture.tsx:7']);
});

test('all project inputs with an accessible-name requirement have a label or ARIA name', () => {
  const violations = collectTsxFiles(sourceDirectory).flatMap((filePath) => {
    const source = fs.readFileSync(filePath, 'utf8');
    const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    return collectInputNameViolations(sourceFile);
  });

  assert.deepEqual(violations, [], `Inputs need a wrapping or matching label or an explicit ARIA name:\n${violations.join('\n')}`);
});
