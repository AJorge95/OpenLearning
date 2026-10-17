import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';

const sourcePath = path.resolve('src/pages-manage.tsx');
const source = fs.readFileSync(sourcePath, 'utf8');
const sourceFile = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function courseManagementPage() {
  const declaration = sourceFile.statements.find((statement) => ts.isFunctionDeclaration(statement)
    && statement.name?.text === 'CourseManagementPage');
  assert.ok(declaration?.body, 'Expected CourseManagementPage.');
  return declaration.body.getText(sourceFile);
}

test('filtered empty course searches can be cleared and reload the selected status from page one', () => {
  const page = courseManagementPage();

  assert.match(page, /const courseSearchInputRef = useRef<HTMLInputElement>\(null\)/);
  assert.match(page, /function clearCourseSearch\(\) \{\s*setQuery\(''\);\s*setAppliedQuery\(''\);\s*setPage\(1\);\s*void load\(1, \{ query: '', status \}\);\s*courseSearchInputRef\.current\?\.focus\(\);\s*\}/);
  assert.match(page, /<input ref=\{courseSearchInputRef\} type="search" value=\{query\}/);
  assert.match(page, /aria-label="Search courses" maxLength=\{120\}/);
  assert.match(page, /const emptyCourseAction = appliedQuery\s*\?\s*<Button type="button" variant="secondary" onClick=\{clearCourseSearch\}>Clear search<\/Button>/);
  assert.match(page, /<EmptyState title=\{emptyCourseState\.title\} detail=\{emptyCourseState\.detail\} action=\{emptyCourseAction\} \/>/);
});

test('changing course status applies the visible search draft', () => {
  const page = courseManagementPage();

  assert.match(page, /function changeCourseStatusFilter\(nextStatus: string\) \{[\s\S]*?const nextQuery = query\.trim\(\);[\s\S]*?const searchChanged = nextQuery !== appliedQuery;[\s\S]*?setQuery\(nextQuery\);[\s\S]*?setAppliedQuery\(nextQuery\);[\s\S]*?setPage\(1\);[\s\S]*?if \(status === nextStatus\) \{[\s\S]*?if \(searchChanged\) void load\(1, \{ query: nextQuery, status: nextStatus \}\);[\s\S]*?return;[\s\S]*?setStatus\(nextStatus\);/);
  assert.match(page, /onClick=\{\(\) => changeCourseStatusFilter\(tab\.value\)\}/);
});

test('the empty catalog action identifies the first course while the page action stays general', () => {
  const page = courseManagementPage();
  const compactPage = page.replace(/\s+/g, ' ');

  assert.match(compactPage, /const emptyCourseAction = appliedQuery \? <Button type="button" variant="secondary" onClick=\{clearCourseSearch\}>Clear search<\/Button> : status === 'all' && <Link className="button button-primary" to="\/manage\/courses\/new"><Plus size=\{17\} aria-hidden="true" \/>Create first course<\/Link>;/);
  assert.match(compactPage, /<PageHeading title="Courses" action=\{<div className="analytics-heading-actions">.*<Link className="button button-primary" to="\/manage\/courses\/new"><Plus size=\{18\} aria-hidden="true" \/>Create course<\/Link><\/div>\} \/>/);
});
