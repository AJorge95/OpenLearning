import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
import { MAX_BRAND_ICON_DIMENSION } from '../../src/branding.ts';

const sourcePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/components.tsx');
const source = fs.readFileSync(sourcePath, 'utf8');
const sourceFile = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function jsxAttribute(element, name) {
  return element.attributes.properties.find((attribute) => (
    ts.isJsxAttribute(attribute) && attribute.name.text === name
  ));
}

function identifierExpression(attribute) {
  if (!attribute?.initializer || !ts.isJsxExpression(attribute.initializer)) return '';
  return attribute.initializer.expression && ts.isIdentifier(attribute.initializer.expression)
    ? attribute.initializer.expression.text : '';
}

function iconHintBinding(component) {
  let hintId = '';
  let hintText = '';
  let inputDescription = '';
  function visit(node) {
    if (ts.isJsxElement(node)) {
      const className = jsxAttribute(node.openingElement, 'className');
      const classValue = className?.initializer && ts.isStringLiteral(className.initializer) ? className.initializer.text : '';
      if (classValue === 'muted' && node.children.some((child) => ts.isJsxText(child) && child.text.includes('512 KB'))) {
        hintId = identifierExpression(jsxAttribute(node.openingElement, 'id'));
        hintText = node.children.map((child) => {
          if (ts.isJsxText(child)) return child.text;
          if (ts.isJsxExpression(child) && child.expression && ts.isIdentifier(child.expression)
            && child.expression.text === 'MAX_BRAND_ICON_DIMENSION') return String(MAX_BRAND_ICON_DIMENSION);
          return '';
        }).join('').trim();
      }
      node.children.forEach(visit);
      return;
    }
    if (ts.isJsxSelfClosingElement(node) && ts.isIdentifier(node.tagName) && node.tagName.text === 'input') {
      const type = jsxAttribute(node, 'type');
      if (type?.initializer && ts.isStringLiteral(type.initializer) && type.initializer.text === 'file') {
        inputDescription = identifierExpression(jsxAttribute(node, 'aria-describedby'));
      }
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(component);
  return { hintId, hintText, inputDescription };
}

test('platform icon file input exposes its format and size guidance as a description', () => {
  const component = sourceFile.statements.find((statement) => ts.isFunctionDeclaration(statement)
    && statement.name?.text === 'PlatformIconPicker');
  assert.ok(component, 'PlatformIconPicker should exist');
  const binding = iconHintBinding(component);
  assert.ok(binding.hintId, 'the visible icon hint should have an id');
  assert.equal(binding.hintText, 'PNG, JPG, or WebP · up to 512 KB · 1024 × 1024 px max');
  assert.equal(binding.inputDescription, binding.hintId);
});

test('platform icon picker validates decoded dimensions before staging the data URL', () => {
  const dimensionCheck = source.indexOf('isBrandIconDimensionAllowed(image.naturalWidth, image.naturalHeight)');
  const stageIcon = source.indexOf('onChange(reader.result as string)', dimensionCheck);

  assert.equal(MAX_BRAND_ICON_DIMENSION, 1024);
  assert.notEqual(dimensionCheck, -1, 'the decoded image dimensions should be checked');
  assert.ok(stageIcon > dimensionCheck, 'an oversized image should not be staged before dimension validation');
  assert.match(source, /The icon must be \$\{MAX_BRAND_ICON_DIMENSION\} × \$\{MAX_BRAND_ICON_DIMENSION\} pixels or smaller\./);
});
