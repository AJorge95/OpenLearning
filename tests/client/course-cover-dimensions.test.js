import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
import { isCourseCoverDimensionAllowed, MAX_COURSE_COVER_DIMENSION } from '../../src/course-cover-validation.ts';

const sourcePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/pages-manage.tsx');
const source = fs.readFileSync(sourcePath, 'utf8');
const sourceFile = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const mediaRoutesSource = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../server/routes-media.js'), 'utf8');

function findFunction(node, name) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === name) return node;
  let found = null;
  ts.forEachChild(node, (child) => {
    found ??= findFunction(child, name);
  });
  return found;
}

test('course covers accept the configured boundary and reject either oversized dimension', () => {
  assert.equal(MAX_COURSE_COVER_DIMENSION, 4096);
  assert.equal(isCourseCoverDimensionAllowed(4096, 4096), true);
  assert.equal(isCourseCoverDimensionAllowed(4097, 1), false);
  assert.equal(isCourseCoverDimensionAllowed(1, 4097), false);
  assert.equal(isCourseCoverDimensionAllowed(0, 1), false);
  assert.match(mediaRoutesSource, new RegExp(`const maxCourseCoverDimension = ${MAX_COURSE_COVER_DIMENSION};`));
});

test('course cover dimensions are checked before saving details or uploading the file', () => {
  const uploadCover = findFunction(sourceFile, 'uploadCover');
  assert.ok(uploadCover, 'CourseEditorPage should define uploadCover');
  const body = uploadCover.getText(sourceFile);
  const decode = body.indexOf('await readImageDimensions(file)');
  const check = body.indexOf('isCourseCoverDimensionAllowed(dimensions.width, dimensions.height)');
  const invalidReturn = body.indexOf('return;', check);
  const saveDetails = body.indexOf('await saveCourseDetailsIfChanged()');
  const upload = body.indexOf('await api.upload(');

  assert.ok(decode >= 0, 'the selected cover should be decoded');
  assert.ok(check > decode, 'decoded dimensions should be validated');
  assert.ok(invalidReturn > check && invalidReturn < saveDetails, 'oversized covers should return before saving course details');
  assert.ok(saveDetails > check && saveDetails < upload, 'course details should be saved before a valid cover upload');
  assert.match(body, /Course cover could not be displayed\. Choose a different image\./);
  assert.match(source, /disabled=\{coverValidating \|\| coverProgress !== null \|\| saving\}/);
  assert.match(source, /Checking cover dimensions…/);
});
