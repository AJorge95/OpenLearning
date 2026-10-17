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

test('audit-log filters can be cleared with or without matching rows', () => {
  const page = functionBody('AdminAuditLogPage');

  assert.match(page, /const hasAppliedFilters = Boolean\(appliedQuery \|\| action\)/);
  assert.match(page, /const searchInputRef = useRef<HTMLInputElement>\(null\)/);
  assert.match(page, /function clearFilters\(\) \{\s*setQuery\(''\);\s*setAppliedQuery\(''\);\s*setAction\(''\);\s*setPage\(1\);[\s\S]*?searchInputRef\.current\?\.focus\(\);\s*\}/);
  assert.match(page, /\{hasAppliedFilters && <Button type="button" variant="secondary" onClick=\{clearFilters\}>Clear filters<\/Button>\}/);
  assert.match(page, /<LogEmptyState message=\{emptyMessage\} \/>/);
});

test('system-log filters can be cleared with or without matching rows', () => {
  const page = functionBody('AdminSystemLogPage');

  assert.match(page, /const hasAppliedFilters = Boolean\(appliedQuery \|\| level !== 'all'\)/);
  assert.match(page, /const searchInputRef = useRef<HTMLInputElement>\(null\)/);
  assert.match(page, /function clearFilters\(\) \{\s*setQuery\(''\);\s*setAppliedQuery\(''\);\s*setLevel\('all'\);\s*setPage\(1\);[\s\S]*?searchInputRef\.current\?\.focus\(\);\s*\}/);
  assert.match(page, /\{hasAppliedFilters && <Button type="button" variant="secondary" onClick=\{clearFilters\}>Clear filters<\/Button>\}/);
  assert.match(page, /<LogEmptyState message=\{emptyMessage\} \/>/);
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

test('audit change summaries and system event messages provide log row context', () => {
  const auditPage = functionBody('AdminAuditLogPage');
  const systemPage = functionBody('AdminSystemLogPage');
  const styles = fs.readFileSync(path.resolve('src/styles.css'), 'utf8');

  assert.match(auditPage, /<th scope="row"><strong>\{entry\.summary\}<\/strong><small>\{entry\.entityType\}/);
  assert.match(systemPage, /<th scope="row"><strong>\{entry\.message\}<\/strong><\/th>/);
  assert.match(styles, /\.log-table tbody th\s*\{[^}]*height:\s*auto;[^}]*padding:\s*15px;[^}]*background:\s*transparent;[^}]*font-weight:\s*400;[^}]*text-align:\s*left;[^}]*vertical-align:\s*top;/);
  assert.match(styles, /\.log-table tbody tr:last-child td, \.log-table tbody tr:last-child th\s*\{\s*border-bottom:\s*0;\s*\}/);
  assert.match(styles, /\.log-table td strong, \.log-table tbody th strong/);
  assert.match(styles, /\.log-table td small, \.log-table tbody th small/);
});

test('log empty states describe no matches while active filters have a persistent reset', () => {
  const emptyState = functionBody('LogEmptyState');

  assert.match(emptyState, /<p>\{message\}<\/p>/);
  assert.doesNotMatch(emptyState, /Clear filters/);
  const styles = fs.readFileSync(path.resolve('src/styles.css'), 'utf8');
  assert.match(styles, /\.log-filters \{ display: grid; grid-template-columns: minmax\(260px, 1fr\) minmax\(180px, 260px\) auto;/);
  assert.match(styles, /\.log-filters \{ grid-template-columns: 1fr; \}/);
});
