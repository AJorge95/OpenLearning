import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const sourceDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src');
// Labels activate their form field; keep independent actions and custom buttons outside them.
const interactiveTagsInsideLabels = new Set(['a', 'button', 'AppSelect', 'Button', 'Link']);

function jsxTagName(tag) {
  return ts.isIdentifier(tag) ? tag.text : '';
}

function collectLabelInteractionViolations(sourceFile) {
  const violations = [];

  function visit(node, insideLabel = false) {
    if (ts.isJsxElement(node)) {
      const tagName = jsxTagName(node.openingElement.tagName);
      if (insideLabel && interactiveTagsInsideLabels.has(tagName)) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        violations.push(`${sourceFile.fileName}:${line + 1} <${tagName}> inside <label>`);
      }
      node.children.forEach((child) => visit(child, insideLabel || tagName === 'label'));
      return;
    }

    if (ts.isJsxSelfClosingElement(node)) {
      const tagName = jsxTagName(node.tagName);
      if (insideLabel && interactiveTagsInsideLabels.has(tagName)) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        violations.push(`${sourceFile.fileName}:${line + 1} <${tagName}/> inside <label>`);
      }
      return;
    }

    ts.forEachChild(node, (child) => visit(child, insideLabel));
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

test('detects interactive controls nested inside a label while allowing its form field', () => {
  const sourceFile = ts.createSourceFile(
    'fixture.tsx',
    'const button = <label>Actions<Button>Save</Button></label>;\nconst link = <label>Navigation<a href="/courses">Courses</a></label>;\nconst select = <label>Role<AppSelect ariaLabel="Role" /></label>;\nconst field = <label>Name<input /></label>;',
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );

  assert.deepEqual(collectLabelInteractionViolations(sourceFile), [
    'fixture.tsx:1 <Button> inside <label>',
    'fixture.tsx:2 <a> inside <label>',
    'fixture.tsx:3 <AppSelect/> inside <label>',
  ]);
});

test('project labels do not wrap buttons, links, or custom selectors', () => {
  const violations = collectTsxFiles(sourceDirectory).flatMap((filePath) => {
    const source = fs.readFileSync(filePath, 'utf8');
    const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    return collectLabelInteractionViolations(sourceFile);
  });

  assert.deepEqual(violations, [], `Interactive controls must stay outside labels to avoid forwarded clicks:\n${violations.join('\n')}`);
});
