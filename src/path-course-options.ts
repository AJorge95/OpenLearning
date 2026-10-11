import type { Course } from './types';

export type PublishedCoursePage = { courses: Course[]; total: number; page: number; pageSize: number };

export function publishedCourseOptionsPageUrl(page: number) {
  const params = new URLSearchParams({ status: 'published', page: String(page) });
  return `/api/manage/courses?${params}`;
}

export function appendPublishedCourseOptions(current: Course[], incoming: Course[]) {
  const merged = new Map(current.map((course) => [course.id, course]));
  for (const course of incoming) merged.set(course.id, course);
  return [...merged.values()];
}

export function hasMorePublishedCourseOptions(page: number, pageSize: number, total: number) {
  return page > 0 && pageSize > 0 && page * pageSize < total;
}
