import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const sourceDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src');

function collectTsxFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectTsxFiles(entryPath);
    return entry.isFile() && entry.name.endsWith('.tsx') ? [entryPath] : [];
  });
}

function tagName(node) {
  return ts.isIdentifier(node.tagName) ? node.tagName.text : '';
}

function hasAltAttribute(node) {
  return node.attributes.properties.some((attribute) => (
    ts.isJsxAttribute(attribute) && ts.isIdentifier(attribute.name) && attribute.name.text === 'alt'
  ));
}

test('ImageWithFallback requires an explicit alt decision', () => {
  const sourcePath = path.join(sourceDirectory, 'components.tsx');
  const source = fs.readFileSync(sourcePath, 'utf8');
  const sourceFile = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let altIsRequired = false;

  function visit(node) {
    if (ts.isTypeAliasDeclaration(node) && node.name.text === 'ImageWithFallbackProps' && ts.isTypeLiteralNode(node.type)) {
      const altProperty = node.type.members.find((member) => ts.isPropertySignature(member)
        && ts.isIdentifier(member.name) && member.name.text === 'alt');
      altIsRequired = Boolean(altProperty && !altProperty.questionToken);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  assert.ok(altIsRequired, 'ImageWithFallbackProps should require alt');
});

test('ImageWithFallback resets failed state on source changes and names both visual fallbacks', () => {
  const source = fs.readFileSync(path.join(sourceDirectory, 'components.tsx'), 'utf8');
  const wrapperStart = source.indexOf('export function ImageWithFallback');
  const wrapperEnd = source.indexOf('\nfunction ImageWithFallbackImage', wrapperStart);
  const wrapper = source.slice(wrapperStart, wrapperEnd);
  const imageImplementationStart = wrapperEnd + 1;
  const imageImplementationEnd = source.indexOf('\nexport function PalettePicker', imageImplementationStart);
  const imageImplementation = source.slice(imageImplementationStart, imageImplementationEnd);

  assert.match(wrapper, /<ImageWithFallbackImage key=\{props\.src\}/);
  assert.match(wrapper, /if \(!props\.src\) return imageFallback\(props\.fallback, props\.alt\);/);
  assert.match(imageImplementation, /const \[failed, setFailed\] = useState\(false\);[\s\S]*?if \(failed\) return imageFallback\(fallback, alt\);/);
  assert.match(source, /function imageFallback\(fallback: React\.ReactNode, alt: string\) \{\s*\/\/ Keep meaningful image context available when a preview has no source or cannot load\.\s*return <>\{fallback\}\{alt && <span className="sr-only" role="img" aria-label=\{alt\} \/>}<\/>;/);
  assert.match(imageImplementation, /onError=\{\(\) => \{ setFailed\(true\); onError\?\.\(\); \}\}/);
});

test('all ImageWithFallback JSX call sites state their alt intent', () => {
  const missingAlt = [];

  for (const sourcePath of collectTsxFiles(sourceDirectory)) {
    const source = fs.readFileSync(sourcePath, 'utf8');
    const sourceFile = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

    function visit(node) {
      if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node))
        && tagName(node) === 'ImageWithFallback' && !hasAltAttribute(node)) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        missingAlt.push(`${path.relative(sourceDirectory, sourcePath)}:${line + 1}`);
      }
      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
  }

  assert.deepEqual(missingAlt, []);
});
