export type PathEditorValue = {
  title: string;
  description: string;
  status: 'draft' | 'published';
  selfEnrollment: boolean;
  courses: ReadonlyArray<{ courseId: string; requiresPrevious: boolean }>;
};

export function hasUnsavedPathChanges(current: PathEditorValue, initial: PathEditorValue) {
  if (current.title !== initial.title
    || current.description !== initial.description
    || current.status !== initial.status
    || current.selfEnrollment !== initial.selfEnrollment
    || current.courses.length !== initial.courses.length) return true;

  return current.courses.some((course, index) => {
    const initialCourse = initial.courses[index];
    return course.courseId !== initialCourse.courseId || course.requiresPrevious !== initialCourse.requiresPrevious;
  });
}
