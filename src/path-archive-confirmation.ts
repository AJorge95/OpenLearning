export function pathArchiveConfirmation(pathTitle: string, discardEditorChanges = false) {
  const description = 'It will be removed from active learning path lists. Existing learner enrollments and course progress will be kept. You can restore it later as a draft.';
  return {
    title: `Archive “${pathTitle}”?`,
    description: discardEditorChanges ? `${description} Unsaved edits to this path will also be discarded.` : description,
  };
}
