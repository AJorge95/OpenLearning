import { MAX_LEARNING_PATH_COURSES } from '../shared/learning-path-limits.js';

export type PathCourseSelectionItem = { courseId: string; requiresPrevious: boolean };

export function isPathCourseCheckboxDisabled(selectedCount: number, isSelected: boolean) {
  return !isSelected && selectedCount >= MAX_LEARNING_PATH_COURSES;
}

export function togglePathCourseSelection(current: PathCourseSelectionItem[], courseId: string, checked: boolean) {
  if (!checked) return current.filter((item) => item.courseId !== courseId);
  if (current.some((item) => item.courseId === courseId)
    || isPathCourseCheckboxDisabled(current.length, false)) return current;
  return [...current, { courseId, requiresPrevious: current.length > 0 }];
}
