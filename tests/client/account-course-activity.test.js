import assert from 'node:assert/strict';
import test from 'node:test';
import { accountCourseAssignmentLabel } from '../../src/account-course-activity.ts';

const baseCourse = { visibility: 'public', enrolledAt: null, grantedAt: null, learningPathEnrolled: false };

test('labels direct grants and public enrollments before path membership', () => {
  assert.equal(accountCourseAssignmentLabel({ ...baseCourse, grantedAt: '2026-10-01' }), 'Assigned');
  assert.equal(accountCourseAssignmentLabel({ ...baseCourse, enrolledAt: '2026-10-01', learningPathEnrolled: true }), 'Enrolled');
});

test('labels path-only courses and does not call locked private enrollments revoked', () => {
  assert.equal(accountCourseAssignmentLabel({ ...baseCourse, visibility: 'private', learningPathEnrolled: true }), 'Learning path');
  assert.equal(accountCourseAssignmentLabel({ ...baseCourse, visibility: 'private', enrolledAt: '2026-10-01', learningPathEnrolled: true }), 'Learning path');
});

test('preserves revoked private access and the public no-assignment fallback', () => {
  assert.equal(accountCourseAssignmentLabel({ ...baseCourse, visibility: 'private', enrolledAt: '2026-10-01' }), 'Access revoked');
  assert.equal(accountCourseAssignmentLabel(baseCourse), '—');
});
