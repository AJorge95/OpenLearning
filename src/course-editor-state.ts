export function isCourseCreationEditorState(state: unknown, courseId: string | undefined): boolean {
  if (!courseId || state === null || typeof state !== 'object' || !('createdCourseId' in state)) return false;
  return state.createdCourseId === courseId;
}
