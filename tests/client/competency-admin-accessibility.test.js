import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';

const pagePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/pages-programs.tsx');

function jsxAttribute(element, name) {
  return element.openingElement.attributes.properties.find((attribute) =>
    ts.isJsxAttribute(attribute) && attribute.name.getText() === name);
}

function expressionAttribute(element, name) {
  const initializer = jsxAttribute(element, name)?.initializer;
  return initializer && ts.isJsxExpression(initializer) ? initializer.expression?.getText() : null;
}

test('competency status buttons name the competency and current action', () => {
  const source = fs.readFileSync(pagePath, 'utf8');
  const sourceFile = ts.createSourceFile(pagePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const toggleButtons = [];

  function visit(node) {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText() === 'Button'
      && expressionAttribute(node, 'onClick')?.includes('toggle(item)')) {
      toggleButtons.push(node);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  assert.equal(toggleButtons.length, 1, 'expected one competency status action button');
  assert.equal(
    expressionAttribute(toggleButtons[0], 'aria-label'),
    "savingId === item.id ? `Saving ${item.title}` : `${item.active ? 'Deactivate' : 'Reactivate'} ${item.title}`",
  );
});

test('admin competency search is named and keeps its filter through paging and status updates', () => {
  const source = fs.readFileSync(pagePath, 'utf8');

  assert.ok(source.includes('<form role="search" className="management-search competency-search"'), 'search form should expose a search landmark');
  assert.ok(source.includes('type="search"') && source.includes('aria-label="Search competency names and descriptions"'), 'search field should describe what it matches');
  assert.ok(source.includes('maxLength={100}'), 'search field should match the server query limit');
  assert.ok(source.includes('async function load(requestedPage = page, requestedQuery = appliedQuery)'), 'page loads should retain the applied query');
  assert.ok(source.includes("params.set('q', requestedQuery)"), 'list requests should send the applied query');
  assert.ok(source.includes('${item.id}${queryString}`'), 'status updates should preserve the applied query');
  assert.ok(source.includes('void load(nextPage)'), 'pagination should load the requested page with the current query');
  assert.ok(source.includes('onClick={clearSearch}>Clear search'), 'the filtered empty state should let administrators clear the query');
});

test('successful competency creation restores focus to the cleared name field', () => {
  const source = fs.readFileSync(pagePath, 'utf8');

  assert.match(source, /const competencyTitleInputRef = useRef<HTMLInputElement>\(null\);/);
  assert.match(source, /<label><span className="form-label-row"><span>Name<\/span><small className="form-required-indicator" aria-hidden="true">Required<\/small><\/span><input ref=\{competencyTitleInputRef\}/);
  assert.match(source, /let created = false;[\s\S]*?created = true;[\s\S]*?setTitle\(''\);/);
  assert.match(source, /finally \{\s*setSaving\(false\);\s*if \(created\) window\.requestAnimationFrame\(\(\) => \{\s*const input = competencyTitleInputRef\.current;\s*if \(input\?\.isConnected\) input\.focus\(\);/);
});
