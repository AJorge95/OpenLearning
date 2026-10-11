import assert from 'node:assert/strict';
import test from 'node:test';
import { hasUnsavedPathChanges } from '../../src/path-editor-dirty.ts';

const initial = {
  title: 'Safety essentials',
  description: 'Required onboarding courses.',
  status: 'draft',
  selfEnrollment: false,
  courses: [
    { courseId: 'course-a', requiresPrevious: false },
    { courseId: 'course-b', requiresPrevious: true },
  ],
};

test('path editor recognizes an unchanged create or edit form', () => {
  assert.equal(hasUnsavedPathChanges(initial, initial), false);
});

test('path editor detects changes to every scalar setting', () => {
  const changes = [
    { title: 'Safety essentials updated' },
    { description: 'Updated onboarding courses.' },
    { status: 'published' },
    { selfEnrollment: true },
  ];

  for (const change of changes) {
    assert.equal(hasUnsavedPathChanges({ ...initial, ...change }, initial), true);
  }
});

test('path editor detects course order, membership, and prerequisite changes', () => {
  const changedCourseLists = [
    [...initial.courses].reverse(),
    [initial.courses[0]],
    [...initial.courses, { courseId: 'course-c', requiresPrevious: true }],
    [initial.courses[0], { ...initial.courses[1], requiresPrevious: false }],
  ];

  for (const courses of changedCourseLists) {
    assert.equal(hasUnsavedPathChanges({ ...initial, courses }, initial), true);
  }
});
