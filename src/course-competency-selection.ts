export function updateCourseCompetencySelection(current: string[], competencyId: string, checked: boolean, limit: number) {
  if (!checked) return current.filter((id) => id !== competencyId);
  if (current.includes(competencyId) || current.length >= limit) return current;
  return [...current, competencyId];
}
