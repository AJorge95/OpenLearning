export function updateCourseCompetencySelection(current: string[], competencyId: string, checked: boolean, limit: number) {
  if (!checked) return current.filter((id) => id !== competencyId);
  if (current.includes(competencyId) || current.length >= limit) return current;
  return [...current, competencyId];
}

function normalizedCompetencySearch(value: string) {
  return value.normalize('NFC').toLowerCase().normalize('NFC');
}

export function filterCourseCompetencies<T extends { title: string }>(competencies: readonly T[], query: string): readonly T[] {
  const normalizedQuery = normalizedCompetencySearch(query.trim());
  if (!normalizedQuery) return competencies;
  return competencies.filter((competency) => normalizedCompetencySearch(competency.title).includes(normalizedQuery));
}
