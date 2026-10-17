import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const sourcePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/pages-manage.tsx');
const source = fs.readFileSync(sourcePath, 'utf8');
const sourceFile = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function jsxAttribute(element, name) {
  return element.attributes.properties.find((attribute) => (
    ts.isJsxAttribute(attribute) && attribute.name.text === name
  ));
}

function expressionAttribute(element, name) {
  const initializer = jsxAttribute(element, name)?.initializer;
  return initializer && ts.isJsxExpression(initializer) ? initializer.expression?.getText() ?? null : null;
}

test('lesson document input announces its visible accepted-format guidance', () => {
  const component = sourceFile.statements.find((statement) => ts.isFunctionDeclaration(statement)
    && statement.name?.text === 'LessonDetailsEditor');
  assert.ok(component, 'LessonDetailsEditor should exist');

  const helpTexts = [];
  const documentInputs = [];
  function visit(node) {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText() === 'span'
      && node.getText(sourceFile).includes('PDF, TXT, Markdown, RTF, Word, PowerPoint, Excel, CSV/TSV, or OpenDocument.')) {
      helpTexts.push(node.openingElement);
    }
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText() === 'input'
      && jsxAttribute(node, 'type')?.initializer?.getText() === '"file"'
      && jsxAttribute(node, 'accept')?.initializer?.getText().startsWith('".pdf,') ) {
      documentInputs.push(node);
    }
    ts.forEachChild(node, visit);
  }
  visit(component);

  assert.equal(helpTexts.length, 1, 'expected one visible lesson document format hint');
  assert.equal(documentInputs.length, 1, 'expected one lesson document input');
  const hintId = expressionAttribute(helpTexts[0], 'id');
  assert.ok(hintId, 'the document format hint should have an id');
  assert.equal(expressionAttribute(documentInputs[0], 'aria-describedby'), hintId);
  assert.equal(jsxAttribute(documentInputs[0], 'accept')?.initializer?.getText(), '".pdf,.txt,.md,.rtf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.csv,.tsv,.odt,.odp,.ods"');
});
