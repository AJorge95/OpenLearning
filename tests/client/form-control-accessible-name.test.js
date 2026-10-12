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

function buttonExpressionHasName(expression) {
  if (ts.isStringLiteralLike(expression)) return Boolean(expression.text.trim());
  if (ts.isNumericLiteral(expression)) return true;
  if (ts.isIdentifier(expression) && expression.text === 'undefined') return false;
  if (expression.kind === ts.SyntaxKind.NullKeyword
    || expression.kind === ts.SyntaxKind.FalseKeyword
    || expression.kind === ts.SyntaxKind.TrueKeyword) return false;
  if (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) || ts.isNonNullExpression(expression)) {
    return buttonExpressionHasName(expression.expression);
  }
  if (ts.isConditionalExpression(expression)) {
    // Every rendered branch needs a name; loading states must not become icon-only buttons.
    return buttonExpressionHasName(expression.whenTrue) && buttonExpressionHasName(expression.whenFalse);
  }
  if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) return false;
  if (ts.isBinaryExpression(expression)
    && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(expression.operatorToken.kind)) {
    return buttonExpressionHasName(expression.left) && buttonExpressionHasName(expression.right);
  }
  return true;
}

function buttonChildrenHaveName(children) {
  return children.some((child) => {
    if (ts.isJsxText(child)) return Boolean(child.getText().trim());
    if (ts.isJsxExpression(child)) return Boolean(child.expression && buttonExpressionHasName(child.expression));
    if (ts.isJsxElement(child)) {
      if (jsxAttributeValue(child.openingElement, 'aria-hidden') === 'true') return false;
      if (jsxTagName(child.openingElement.tagName) === 'img') {
        return Boolean(jsxAttributeValue(child.openingElement, 'alt'));
      }
      return buttonChildrenHaveName(child.children);
    }
    if (ts.isJsxSelfClosingElement(child)) {
      if (jsxAttributeValue(child, 'aria-hidden') === 'true') return false;
      return jsxTagName(child.tagName) === 'img' && Boolean(jsxAttributeValue(child, 'alt'));
    }
    if (ts.isJsxFragment(child)) return buttonChildrenHaveName(child.children);
    return false;
  });
}

function collectButtonNameViolations(sourceFile) {
  const violations = [];
  const buttonTags = new Set(['button', 'Button']);

  function inspect(element, children) {
    const hasExplicitName = Boolean(jsxAttributeValue(element, 'aria-label', sourceFile)
      || jsxAttributeValue(element, 'aria-labelledby', sourceFile));
    if (hasExplicitName || buttonChildrenHaveName(children)) return;
    const { line } = sourceFile.getLineAndCharacterOfPosition(element.getStart(sourceFile));
    violations.push(`${sourceFile.fileName}:${line + 1}`);
  }

  function visit(node) {
    if (ts.isJsxElement(node)) {
      if (buttonTags.has(jsxTagName(node.openingElement.tagName))) inspect(node.openingElement, node.children);
      ts.forEachChild(node, visit);
      return;
    }
    if (ts.isJsxSelfClosingElement(node) && buttonTags.has(jsxTagName(node.tagName))) inspect(node, []);
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return violations;
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

test('the button label check detects icon-only controls and empty conditional branches', () => {
  const sourceFile = ts.createSourceFile(
    'fixture.tsx',
    'const iconOnly = <button><span aria-hidden="true"><Icon /></span></button>;\nconst visibleText = <button><Icon aria-hidden="true" />Continue</button>;\nconst changingText = <Button>{busy ? \'Saving…\' : \'Save\'}</Button>;\nconst ariaNamed = <button aria-label="Close"><Icon aria-hidden="true" /></button>;\nconst sometimesEmpty = <button>{busy ? \'Saving…\' : null}</button>;\nconst shortCircuitedText = <button>{busy && \'Saving…\'}</button>;',
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );

  assert.deepEqual(collectButtonNameViolations(sourceFile), ['fixture.tsx:1', 'fixture.tsx:5', 'fixture.tsx:6']);
});

test('all project buttons expose text or an explicit accessible name', () => {
  const violations = collectTsxFiles(sourceDirectory).flatMap((filePath) => {
    const source = fs.readFileSync(filePath, 'utf8');
    const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    return collectButtonNameViolations(sourceFile);
  });

  assert.deepEqual(violations, [], `Buttons need visible text or an explicit ARIA name:\n${violations.join('\n')}`);
});
