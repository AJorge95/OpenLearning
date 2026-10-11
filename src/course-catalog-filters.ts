export type CourseCatalogFilters = { query: string; category: string; sort: string };
export type CourseCatalogCategoryOption = { value: string; label: string };

export function courseCatalogCategoryOptions(categories: readonly string[]): CourseCatalogCategoryOption[] {
  return [
    { value: '', label: 'All courses' },
    ...categories.map((category) => ({
      value: category,
      label: category === 'All courses' ? 'All courses (category)' : category,
    })),
  ];
}

export function courseCatalogParams(filters: CourseCatalogFilters, page: number): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.query) params.set('q', filters.query);
  if (filters.category) params.set('category', filters.category);
  if (filters.sort === 'title') params.set('sort', filters.sort);
  params.set('page', String(page));
  if (page > 1) params.set('includeCategories', '0');
  return params;
}

export function hasCourseCatalogFilters(filters: CourseCatalogFilters): boolean {
  return Boolean(filters.query || filters.category);
}
