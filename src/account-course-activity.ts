type AccountCourseAssignment = {
  visibility: 'public' | 'private';
  enrolledAt: string | null;
  grantedAt: string | null;
  learningPathEnrolled: boolean;
};

export function accountCourseAssignmentLabel(course: AccountCourseAssignment) {
  if (course.grantedAt) return 'Assigned';
  if (course.enrolledAt && course.visibility === 'public') return 'Enrolled';
  if (course.learningPathEnrolled) return 'Learning path';
  if (course.visibility === 'private') return 'Access revoked';
  if (course.enrolledAt) return 'Enrolled';
  return '—';
}
