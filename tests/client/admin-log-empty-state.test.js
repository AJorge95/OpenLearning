import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';

const sourcePath = path.resolve('src/pages-manage.tsx');
const source = fs.readFileSync(sourcePath, 'utf8');
const sourceFile = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function functionBody(name) {
  const declaration = sourceFile.statements.find((statement) => ts.isFunctionDeclaration(statement)
    && statement.name?.text === name);
  assert.ok(declaration?.body, `Expected function ${name}.`);
  return declaration.body.getText(sourceFile);
}

test('audit-log empty results can clear the applied search and action filters', () => {
  const page = functionBody('AdminAuditLogPage');

  assert.match(page, /const hasAppliedFilters = Boolean\(appliedQuery \|\| action\)/);
  assert.match(page, /function clearFilters\(\) \{\s*setQuery\(''\);\s*setAppliedQuery\(''\);\s*setAction\(''\);\s*setPage\(1\);\s*\}/);
  assert.match(page, /<LogEmptyState message=\{emptyMessage\} hasFilters=\{hasAppliedFilters\} onClear=\{clearFilters\} \/>/);
});

test('system-log empty results can clear the applied search and severity filters', () => {
  const page = functionBody('AdminSystemLogPage');

  assert.match(page, /const hasAppliedFilters = Boolean\(appliedQuery \|\| level !== 'all'\)/);
  assert.match(page, /function clearFilters\(\) \{\s*setQuery\(''\);\s*setAppliedQuery\(''\);\s*setLevel\('all'\);\s*setPage\(1\);\s*\}/);
  assert.match(page, /<LogEmptyState message=\{emptyMessage\} hasFilters=\{hasAppliedFilters\} onClear=\{clearFilters\} \/>/);
});

test('audit action changes apply the visible search draft', () => {
  const page = functionBody('AdminAuditLogPage');

  assert.match(page, /function applyAuditFilterChange\(nextAction: string\) \{[\s\S]*?const nextQuery = query\.trim\(\);[\s\S]*?setQuery\(nextQuery\);[\s\S]*?setAppliedQuery\(nextQuery\);[\s\S]*?setAction\(nextAction\);[\s\S]*?setPage\(1\);/);
  assert.match(page, /ariaLabel="Filter by action"[^\n]*onChange=\{applyAuditFilterChange\}/);
});

test('system severity changes apply the visible search draft', () => {
  const page = functionBody('AdminSystemLogPage');

  assert.match(page, /function applySystemFilterChange\(nextLevel: string\) \{[\s\S]*?const nextQuery = query\.trim\(\);[\s\S]*?setQuery\(nextQuery\);[\s\S]*?setAppliedQuery\(nextQuery\);[\s\S]*?setLevel\(nextLevel\);[\s\S]*?setPage\(1\);/);
  assert.match(page, /ariaLabel="Filter by severity"[^\n]*onChange=\{applySystemFilterChange\}/);
});

test('log empty-state recovery stays conditional on active filters', () => {
  const emptyState = functionBody('LogEmptyState');

  assert.match(emptyState, /<p>\{message\}<\/p>/);
  assert.match(emptyState, /hasFilters && <Button type="button" variant="secondary" onClick=\{onClear\}>Clear filters<\/Button>/);
});
