import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { courseDeletionConfirmation } from '../../src/course-deletion-confirmation.ts';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const manageSource = fs.readFileSync(path.join(repositoryRoot, 'src/pages-manage.tsx'), 'utf8');
const courseEditorStart = manageSource.indexOf('export function CourseEditorPage()');
const courseEditorEnd = manageSource.indexOf('\nexport function CourseAccessPage()', courseEditorStart);
const courseEditorSource = manageSource.slice(courseEditorStart, courseEditorEnd);

test('course deletion confirmation names the course and explains irreversible media removal', () => {
  assert.deepEqual(courseDeletionConfirmation('Course one'), {
    title: 'Permanently delete “Course one”?',
    description: 'The course and its uploaded media will be removed. This action cannot be undone.',
  });
});

test('course list stages permanent deletion until the in-app confirmation is accepted', () => {
  const deleteStart = manageSource.indexOf('async function deleteCourse(course: Course, confirmed = false)');
  const deleteEnd = manageSource.indexOf('\n  const tabs =', deleteStart);
  const deleteSource = manageSource.slice(deleteStart, deleteEnd);

  assert.match(deleteSource, /if \(!confirmed\) \{ setPendingDeleteCourse\(course\); return; \}/);
  assert.ok(deleteSource.indexOf('setPendingDeleteCourse(course)') < deleteSource.indexOf('api.delete'));
  assert.match(manageSource, /onConfirm=\{\(\) => \{ const courseToDelete = pendingDeleteCourse; setPendingDeleteCourse\(null\); if \(courseToDelete\) void deleteCourse\(courseToDelete, true\); \}\}/);
});

test('archived course details stage deletion and discard pending confirmation when the route changes', () => {
  const deleteStart = courseEditorSource.indexOf('async function deleteArchivedCourse(confirmed = false)');
  const deleteEnd = courseEditorSource.indexOf('\n  async function addModule', deleteStart);
  const deleteSource = courseEditorSource.slice(deleteStart, deleteEnd);

  assert.match(deleteSource, /if \(!confirmed\) \{ setPendingDeleteCourseId\(course\.id\); return; \}/);
  assert.ok(deleteSource.indexOf('setPendingDeleteCourseId(course.id)') < deleteSource.indexOf('api.delete'));
  assert.match(courseEditorSource, /setPendingDeleteCourseId\(null\);[\s\S]*?\}, \[route\.courseId\]\);/);
  assert.match(courseEditorSource, /pendingDeleteCourseId === course\.id && routeCourseIdRef\.current === course\.id/);
  assert.match(courseEditorSource, /requestedCourseId === course\.id && routeCourseIdRef\.current === course\.id\) void deleteArchivedCourse\(true\)/);
});
